import { buildApp } from "./app.js";
import { config } from "./config.js";
import { startSweep } from "./sweep.js";

const app = buildApp();

try {
  await app.listen({ port: config.port, host: config.host });
  startSweep(app.log);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
