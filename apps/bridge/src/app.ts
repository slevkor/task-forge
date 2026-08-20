import Fastify from "fastify";
import { config } from "./config.js";
import { findExistingLaunch, findExistingLaunchByNote, recordLaunch } from "./db.js";
import { launchSession } from "./cao.js";
import { getProject, getTask } from "./taskforge.js";
import { resolvePersona } from "./personas.js";
import { isTaskAssignedPayload, isTaskNoteAddedPayload } from "./webhookPayload.js";

interface PlannedLaunch {
  profile: string;
  token: string;
  verb: string;
  noteId: string | null; // non-null only for task.note_added — the dedupe key
}

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  app.post("/webhook", async (request, reply) => {
    // task-forge's dispatchWebhook() (apps/api/src/lib/webhook.ts) only ever
    // sends Content-Type: application/json — it has no mechanism to add a
    // custom header. The secret has to travel in the URL itself (the
    // webhookUrl configured on each bot), which fetch() preserves as-is.
    const query = request.query as Record<string, unknown>;
    if (query.secret !== config.sharedSecret) return reply.code(401).send({ error: "bad secret" });

    const payload = request.body;
    let planned: PlannedLaunch;
    let taskId: string;
    let projectKeyHint: string | undefined;

    if (isTaskAssignedPayload(payload)) {
      const persona = resolvePersona(payload.task.assigneeId);
      if (!persona) return reply.code(200).send({ ignored: "assignee is not a pipeline bot" });
      taskId = payload.task.id;
      projectKeyHint = payload.task.projectKey;
      planned = { profile: persona.profile, token: persona.token, verb: persona.verb, noteId: null };
    } else if (isTaskNoteAddedPayload(payload)) {
      // Always pm-bot — this event only fires for a human reply on a
      // NEEDS_INFO ticket, and NEEDS_INFO only ever belongs to pm-bot.
      taskId = payload.task.id;
      projectKeyHint = payload.task.projectKey;
      planned = { profile: config.bots.pmBot.profile, token: config.bots.pmBot.token, verb: "has a new reply to review", noteId: payload.noteId };
    } else {
      return reply.code(200).send({ ignored: "unrecognized event" });
    }

    // Re-read rather than trust the payload: it has no reviewRounds field
    // (dedupe needs it), and a fresh read protects against acting on a stale
    // snapshot if multiple changes landed in quick succession.
    const task = await getTask(taskId);

    const existing = planned.noteId
      ? findExistingLaunchByNote(task.id, planned.noteId)
      : findExistingLaunch(task.id, task.status, task.reviewRounds);
    if (existing) return reply.code(200).send({ ignored: "already launched for this dedupe key", launchId: existing.id });

    // Fail closed, not fall back: a project with no repoPath configured gets
    // no launch at all, rather than defaulting to some directory that might
    // be a real, live checkout. Direct fix for the incident where a test run
    // pushed a real commit and opened a real PR against this project's own
    // GitHub fork.
    const project = await getProject(task.projectId);
    if (!project.repoPath) {
      request.log.error({ taskId: task.id, projectId: task.projectId }, "project has no repoPath configured — refusing to launch");
      return reply.code(200).send({ ignored: "project has no repoPath configured" });
    }

    const key = projectKeyHint ?? task.projectId;
    const message = `Ticket ${key}-${task.number} ${planned.verb}.`;

    const sessionName = await launchSession({
      profile: planned.profile,
      message,
      env: { TASKFORGE_BASE_URL: config.taskforgeBaseUrl, TASKFORGE_TOKEN: planned.token },
      workingDirectory: project.repoPath,
    });

    const launch = recordLaunch({ taskId: task.id, status: task.status, reviewRounds: task.reviewRounds, noteId: planned.noteId, persona: planned.profile, sessionName });
    request.log.info({ launch }, "launched CAO session");

    return reply.code(202).send({ launched: launch.id, sessionName });
  });

  return app;
}
