import { config } from "./config.js";
import { listUnresolvedLaunches, markResolved } from "./db.js";
import { checkSession, cleanupSession, type SessionState } from "./cao.js";
import { getTask, patchTask, postUpdate } from "./taskforge.js";

// CAO's own status detector admits (status_monitor.py) that terminal status
// "flap[s] rapidly between IDLE/COMPLETED and PROCESSING" — confirmed the hard
// way: a reviewer session got read as terminal, killed, and torn down mid-task
// (still running `tsc`, no verdict posted) on a single poll that happened to
// land on a flap. Require the same non-running state twice in a row, one
// sweep interval apart, before acting on it — a real completion stays
// completed across two reads; a flap doesn't.
const CONFIRMATIONS_REQUIRED = 2;
const pendingConfirmations = new Map<string, { state: SessionState; count: number }>();

// The only place any CAO session's completion is ever checked. Runs on an
// interval, not per-request — the webhook handler never blocks on this.
export async function sweepOnce(log: { info: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void }) {
  for (const launch of listUnresolvedLaunches()) {
    let check;
    try {
      check = await checkSession(launch.sessionName);
    } catch (error) {
      log.error({ launch, error }, "failed to check session status");
      continue;
    }

    if (check.state === "running") {
      pendingConfirmations.delete(launch.id);
      continue;
    }

    const pending = pendingConfirmations.get(launch.id);
    if (!pending || pending.state !== check.state) {
      pendingConfirmations.set(launch.id, { state: check.state, count: 1 });
      continue;
    }
    pending.count += 1;
    if (pending.count < CONFIRMATIONS_REQUIRED) continue;
    pendingConfirmations.delete(launch.id);

    if (check.state === "error") {
      log.error({ launch }, "CAO session ended in error/stuck state");
      markResolved(launch.id);
      await cleanupSession(launch.sessionName);
      continue;
    }

    // completed — read the task back from task-forge, not CAO's captured
    // output, since that's the source of truth the rest of the pipeline acts on.
    const task = await getTask(launch.taskId);

    // The one branch that needs bridge-owned logic: automation can't express
    // "< 3 reviews" (see design doc), so this hop isn't automation-driven at all.
    if (launch.persona === config.bots.reviewBot.profile && task.status === "CHANGES_REQUESTED") {
      const reviewRounds = task.reviewRounds + 1;
      if (reviewRounds < config.maxReviewRounds) {
        await patchTask(launch.taskId, { reviewRounds, assigneeId: config.bots.devBot.userId });
      } else {
        await patchTask(launch.taskId, { reviewRounds, status: "ESCALATED" });
        await postUpdate(launch.taskId, `Escalated after ${reviewRounds} review rounds — needs human attention.`);
      }
    }

    log.info({ launch, finalStatus: task.status }, "session resolved");
    markResolved(launch.id);
    await cleanupSession(launch.sessionName);
  }
}

export function startSweep(log: { info: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void }) {
  const timer = setInterval(() => {
    sweepOnce(log).catch((error) => log.error({ error }, "sweep failed"));
  }, config.sweepIntervalMs);
  timer.unref();
  return timer;
}
