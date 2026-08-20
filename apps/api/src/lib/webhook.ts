import type { RequestContext } from "../application/context.js";
import type { TaskEntity } from "../application/models.js";
import type { RepositorySet } from "../application/repositories.js";

/** Fire-and-forget HTTP POST to a webhook URL. Errors are silently discarded. */
export function dispatchWebhook(url: string, payload: unknown): void {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .then(() => clearTimeout(timeout))
    .catch(() => clearTimeout(timeout));
}

/**
 * Fires a webhook for an agent assignee — "task.assigned" by default, shared
 * by direct PATCH requests (TaskApplicationService.update) and
 * automation-rule reassignments (AutomationEngine.apply; it writes through
 * the repository layer directly, bypassing the service layer, so it needs
 * its own call to this rather than inheriting one from the PATCH path).
 *
 * Also used for "task.note_added" (a human replying to a NEEDS_INFO
 * question) via the `event`/`extra` params — same payload shape, same
 * assignee-must-be-an-agent-with-a-webhookUrl gate, just a different event
 * name and, for note_added, the note's own id so the receiver can dedupe on
 * something other than (status, reviewRounds), which won't have changed.
 */
export async function dispatchTaskAssignedWebhook(repositories: RepositorySet, task: TaskEntity, context: RequestContext, event: string = "task.assigned", extra?: Record<string, unknown>): Promise<void> {
  if (!task.assigneeId) return;
  const assignee = await repositories.users.findById(task.assigneeId);
  if (!assignee || assignee.kind !== "AGENT" || !assignee.webhookUrl) return;
  const project = await repositories.projects.findById(task.projectId);
  dispatchWebhook(assignee.webhookUrl, {
    event,
    task: {
      id: task.id, number: task.number, title: task.title,
      description: task.description, definitionOfDone: task.definitionOfDone,
      status: task.status, priority: task.priority, type: task.type,
      branch: task.branch, projectId: task.projectId,
      projectKey: project?.key, projectName: project?.name,
      assigneeId: task.assigneeId,
    },
    assignedBy: { id: context.actor.userId, name: context.actor.name },
    timestamp: new Date().toISOString(),
    ...extra,
  });
}
