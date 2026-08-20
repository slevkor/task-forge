import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS launches (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    status TEXT NOT NULL,
    review_rounds INTEGER NOT NULL,
    note_id TEXT,
    persona TEXT NOT NULL,
    session_name TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    launched_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_launches_dedupe ON launches(task_id, status, review_rounds);
  CREATE INDEX IF NOT EXISTS idx_launches_unresolved ON launches(resolved);
`);

// CREATE TABLE IF NOT EXISTS above is a no-op against a database that
// already exists from before this column existed (same lesson as task-forge's
// own status-enum migration, Unit 1) — retrofit it explicitly.
const launchColumns = new Set((db.prepare("PRAGMA table_info(launches)").all() as { name: string }[]).map((c) => c.name));
if (!launchColumns.has("note_id")) db.exec("ALTER TABLE launches ADD COLUMN note_id TEXT");
db.exec("CREATE INDEX IF NOT EXISTS idx_launches_note_dedupe ON launches(task_id, note_id)");

export interface Launch {
  id: string;
  taskId: string;
  status: string;
  reviewRounds: number;
  noteId: string | null;
  persona: string;
  sessionName: string;
  resolved: boolean;
  launchedAt: string;
  resolvedAt: string | null;
}

function toLaunch(row: Record<string, unknown>): Launch {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    status: String(row.status),
    reviewRounds: Number(row.review_rounds),
    noteId: row.note_id === null || row.note_id === undefined ? null : String(row.note_id),
    persona: String(row.persona),
    sessionName: String(row.session_name),
    resolved: Boolean(row.resolved),
    launchedAt: String(row.launched_at),
    resolvedAt: row.resolved_at === null ? null : String(row.resolved_at),
  };
}

// Dedupe key is (taskId, status, reviewRounds) regardless of resolved state:
// a duplicate webhook for a combination we already launched — in flight or
// already resolved — should never spawn a second session for the same hop.
export function findExistingLaunch(taskId: string, status: string, reviewRounds: number): Launch | null {
  const row = db.prepare("SELECT * FROM launches WHERE task_id = ? AND status = ? AND review_rounds = ?").get(taskId, status, reviewRounds) as Record<string, unknown> | undefined;
  return row ? toLaunch(row) : null;
}

// Separate dedupe key for task.note_added launches: (status, reviewRounds)
// is unchanged from the launch that originally set NEEDS_INFO, so it can't
// distinguish "the original launch" from "a human just replied" — the
// note's own id is the only thing that's actually different between them.
export function findExistingLaunchByNote(taskId: string, noteId: string): Launch | null {
  const row = db.prepare("SELECT * FROM launches WHERE task_id = ? AND note_id = ?").get(taskId, noteId) as Record<string, unknown> | undefined;
  return row ? toLaunch(row) : null;
}

export function recordLaunch(input: { taskId: string; status: string; reviewRounds: number; noteId?: string | null; persona: string; sessionName: string }): Launch {
  const launch: Launch = { id: randomUUID(), resolved: false, resolvedAt: null, launchedAt: new Date().toISOString(), noteId: input.noteId ?? null, ...input };
  db.prepare("INSERT INTO launches (id, task_id, status, review_rounds, note_id, persona, session_name, resolved, launched_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)")
    .run(launch.id, launch.taskId, launch.status, launch.reviewRounds, launch.noteId, launch.persona, launch.sessionName, launch.launchedAt);
  return launch;
}

export function listUnresolvedLaunches(): Launch[] {
  return (db.prepare("SELECT * FROM launches WHERE resolved = 0 ORDER BY launched_at").all() as Record<string, unknown>[]).map(toLaunch);
}

export function markResolved(id: string): void {
  db.prepare("UPDATE launches SET resolved = 1, resolved_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}
