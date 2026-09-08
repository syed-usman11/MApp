import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.js";

export { schema };

/**
 * Both drivers expose the same query-builder surface, so the app is typed
 * against the PGlite flavour and the postgres-js instance is cast to it.
 */
export type Db = ReturnType<typeof drizzlePglite<typeof schema>>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

export interface ConnectOptions {
  /** postgres:// URL. When absent, an embedded PGlite instance is used. */
  url?: string;
  /** Directory for PGlite persistence. Omit for an in-memory database (tests). */
  pgliteDir?: string;
  migrate?: boolean;
}

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function connectDb(opts: ConnectOptions = {}): Promise<DbHandle> {
  if (opts.url) {
    const client = postgres(opts.url, { max: 10 });
    const db = drizzlePg(client, { schema }) as unknown as Db;
    if (opts.migrate !== false) await migratePg(db as never, { migrationsFolder });
    return { db, close: () => client.end() };
  }
  if (opts.pgliteDir) mkdirSync(opts.pgliteDir, { recursive: true });
  const client = opts.pgliteDir ? new PGlite(opts.pgliteDir) : new PGlite();
  const db = drizzlePglite(client, { schema });
  if (opts.migrate !== false) await migratePglite(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
