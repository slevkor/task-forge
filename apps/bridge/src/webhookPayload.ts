// Mirrors the payloads built in task-forge's dispatchTaskAssignedWebhook
// (apps/api/src/lib/webhook.ts) — not derived from a shared schema since
// task-forge doesn't export one for its webhook payloads.
interface WebhookTask {
  id: string;
  number: number;
  title: string;
  description: string;
  definitionOfDone: string;
  status: string;
  priority: string;
  type: string;
  branch: string | null;
  projectId: string;
  projectKey?: string;
  projectName?: string;
  assigneeId: string;
}

export interface TaskAssignedWebhookPayload {
  event: "task.assigned";
  task: WebhookTask;
  assignedBy: { id: string; name?: string };
  timestamp: string;
}

// Fired when a human replies to a NEEDS_INFO question — the one status that
// doesn't reassign the task, so nothing else would ever re-trigger this bot.
export interface TaskNoteAddedWebhookPayload {
  event: "task.note_added";
  task: WebhookTask;
  assignedBy: { id: string; name?: string }; // the note's author, despite the field name — shared payload shape
  timestamp: string;
  noteId: string;
}

export type WebhookPayload = TaskAssignedWebhookPayload | TaskNoteAddedWebhookPayload;

function hasTask(value: unknown): value is { task: unknown } {
  return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).task === "object" && (value as Record<string, unknown>).task !== null;
}

export function isTaskAssignedPayload(value: unknown): value is TaskAssignedWebhookPayload {
  return hasTask(value) && (value as Record<string, unknown>).event === "task.assigned";
}

export function isTaskNoteAddedPayload(value: unknown): value is TaskNoteAddedWebhookPayload {
  return hasTask(value) && (value as Record<string, unknown>).event === "task.note_added" && typeof (value as Record<string, unknown>).noteId === "string";
}
