import { config } from "./config.js";

interface PersonaEntry {
  key: "pmBot" | "devBot" | "reviewBot";
  profile: string;
  token: string;
  verb: string;
}

const byUserId = new Map<string, PersonaEntry>([
  [config.bots.pmBot.userId, { key: "pmBot", profile: config.bots.pmBot.profile, token: config.bots.pmBot.token, verb: "needs refining" }],
  [config.bots.devBot.userId, { key: "devBot", profile: config.bots.devBot.profile, token: config.bots.devBot.token, verb: "is ready to implement" }],
  [config.bots.reviewBot.userId, { key: "reviewBot", profile: config.bots.reviewBot.profile, token: config.bots.reviewBot.token, verb: "needs review" }],
]);

export function resolvePersona(assigneeId: string | null | undefined): PersonaEntry | null {
  if (!assigneeId) return null;
  return byUserId.get(assigneeId) ?? null;
}
