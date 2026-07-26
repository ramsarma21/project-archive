import { requiredEnv } from "./config.js";
import crypto from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Pool } = pg;

function poolConfig(): pg.PoolConfig {
  const production = process.env.NODE_ENV === "production";
  // TLS is on by default in production and must be turned off deliberately.
  // The image ships the RDS trust bundle, so the secure path is the one that
  // works without configuration.
  const sslRequested = production
    ? process.env.DB_SSL !== "false"
    : process.env.DB_SSL === "true";
  const ssl = sslRequested
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" }
    : undefined;
  const shared = {
    ssl,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };

  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ...shared };
  }

  // Production is configured explicitly or it does not start. The development
  // defaults below would otherwise let a deployed task come up healthy while
  // pointed at a database nobody is watching, or fail to connect for a reason
  // that reads as a network problem rather than as missing configuration.
  if (production) {
    return {
      host: requiredEnv("DB_HOST"),
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? "project_archive",
      user: requiredEnv("DB_USER"),
      password: requiredEnv("DB_PASSWORD"),
      ...shared,
    };
  }

  // Local development against docker-compose (container 5432 -> host 55432).
  return {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 55432),
    database: process.env.DB_NAME ?? "project_archive",
    user: process.env.DB_USER ?? "project_archive",
    password: process.env.DB_PASSWORD ?? "project_archive",
    ...shared,
  };
}

export const pool = new Pool(poolConfig());

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const value = await fn(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

interface AppliedMigration {
  version: string;
  checksum: string;
}

// Migrations are serialized across API tasks and checksummed so an applied
// migration can never be silently rewritten.
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext('project_archive_migrations'))");
    await client.query(`
      create table if not exists schema_migrations (
        version text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);
    const here = dirname(fileURLToPath(import.meta.url));
    const directory = join(here, "migrations");
    const files = readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();
    const applied = await client.query<AppliedMigration>(
      "select version, checksum from schema_migrations",
    );
    const byVersion = new Map(applied.rows.map((row) => [row.version, row.checksum]));

    for (const file of files) {
      const sql = readFileSync(join(directory, file), "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      const existing = byVersion.get(file);
      if (existing) {
        if (existing !== checksum) {
          throw new Error(`Migration checksum mismatch for ${file}`);
        }
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into schema_migrations(version, checksum) values ($1,$2)",
          [file, checksum],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext('project_archive_migrations'))");
    } finally {
      client.release();
    }
  }
}
