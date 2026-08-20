import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const config = {
  port: Number(process.env.BRIDGE_PORT ?? 4100),
  host: process.env.BRIDGE_HOST ?? "127.0.0.1",
  databasePath: path.resolve(repoRoot, process.env.BRIDGE_DATABASE_PATH ?? "data/bridge.db"),

  // The shared secret task-forge's webhook calls must present. task-forge's
  // own webhook dispatch has no HMAC (lib/webhook.ts) — this header is the
  // only thing standing between /webhook and anyone who can reach this port.
  sharedSecret: requireEnv("BRIDGE_SHARED_SECRET"),

  taskforgeBaseUrl: process.env.TASKFORGE_BASE_URL ?? "http://127.0.0.1:4000",

  // The bridge's own token for its direct actions (sweep escalation: bump
  // reviewRounds, reassign to dev-bot or escalate). Separate from the three
  // bot tokens below — those are scoped task:read/update:status/notes only
  // (Unit 3's least-privilege design), neither covers task:update:meta,
  // which reviewRounds and assigneeId both require.
  bridgeToken: requireEnv("BRIDGE_TASKFORGE_TOKEN"),

  // Long-lived, scoped tokens minted once per bot (see apps/bridge/README.md
  // for the mint commands) — not per-launch. Keyed by the bot's task-forge
  // user id so the webhook payload's assigneeId resolves directly.
  bots: {
    pmBot: { userId: requireEnv("PM_BOT_USER_ID"), token: requireEnv("PM_BOT_TOKEN"), profile: "tf-product-manager" },
    devBot: { userId: requireEnv("DEV_BOT_USER_ID"), token: requireEnv("DEV_BOT_TOKEN"), profile: "tf-developer" },
    reviewBot: { userId: requireEnv("REVIEW_BOT_USER_ID"), token: requireEnv("REVIEW_BOT_TOKEN"), profile: "tf-reviewer" },
  },

  caoBin: process.env.CAO_BIN ?? "cao",
  caoProvider: process.env.CAO_PROVIDER, // omit to use each profile's own pinned provider
  // No global working-directory fallback, deliberately: launchSession()
  // requires the caller to pass one explicitly, sourced from the task's own
  // project.repoPath (task-forge). See cao.ts for why.

  sweepIntervalMs: Number(process.env.BRIDGE_SWEEP_INTERVAL_MS ?? 20_000),
  maxReviewRounds: Number(process.env.BRIDGE_MAX_REVIEW_ROUNDS ?? 3),
};
