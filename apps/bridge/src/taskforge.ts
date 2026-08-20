import type { Project, Task, TaskStatus } from "@taskforge/contracts";
import { config } from "./config.js";

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.taskforgeBaseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers },
  });
  if (!response.ok) throw new Error(`task-forge ${init?.method ?? "GET"} ${path} -> ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

export function getTask(taskId: string, token = config.bridgeToken): Promise<Task> {
  return request<{ task: Task }>(`/api/tasks/${taskId}`, token).then((r) => r.task);
}

export function getProject(projectId: string, token = config.bridgeToken): Promise<Project> {
  return request<{ project: Project }>(`/api/projects/${projectId}`, token).then((r) => r.project);
}

export function patchTask(taskId: string, fields: Partial<{ status: TaskStatus; assigneeId: string | null; reviewRounds: number }>, token = config.bridgeToken): Promise<Task> {
  return request<{ task: Task }>(`/api/tasks/${taskId}`, token, { method: "PATCH", body: JSON.stringify(fields) }).then((r) => r.task);
}

export function postUpdate(taskId: string, body: string, token = config.bridgeToken): Promise<void> {
  return request(`/api/tasks/${taskId}/updates`, token, { method: "POST", body: JSON.stringify({ body }) }).then(() => undefined);
}
