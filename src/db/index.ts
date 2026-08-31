import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __mctb_sql: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __mctb_db: PostgresJsDatabase<typeof schema> | undefined;
}

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // prepare:false is required for Supabase's transaction pooler (pgbouncer).
  return postgres(url, { max: 1, prepare: false });
}

function getDb(): PostgresJsDatabase<typeof schema> {
  if (!globalThis.__mctb_db) {
    globalThis.__mctb_sql = globalThis.__mctb_sql ?? connect();
    globalThis.__mctb_db = drizzle(globalThis.__mctb_sql, { schema });
  }
  return globalThis.__mctb_db;
}

/**
 * Lazily-connected database handle.
 *
 * The proxy matters: `next build` evaluates every route module while collecting
 * page data, and a connection created at import time would make the build
 * require DATABASE_URL (and, on a cold lambda, connect before it is needed).
 * Nothing touches Postgres until the first query.
 */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const instance = getDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/** Close the pool. Only scripts need this; serverless handlers must not call it. */
export async function closeDb() {
  if (globalThis.__mctb_sql) {
    await globalThis.__mctb_sql.end();
    globalThis.__mctb_sql = undefined;
    globalThis.__mctb_db = undefined;
  }
}

export { schema };
