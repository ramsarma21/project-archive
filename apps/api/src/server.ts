import "./config.js";
import { buildApp } from "./app.js";
import { pool } from "./db.js";

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? "127.0.0.1";

async function main(): Promise<void> {
  const app = await buildApp();
  const stop = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGTERM", () => void stop("SIGTERM"));
  process.once("SIGINT", () => void stop("SIGINT"));
  await app.listen({ port, host });
  app.log.info({ port, host }, "API listening");
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
