import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
import { migrate, pool } from "./db.js";

migrate()
  .then(() => {
    console.log("migration complete");
    return pool.end();
  })
  .catch((err) => {
    console.error("migration failed:", err);
    process.exit(1);
  });
