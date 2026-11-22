import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };

function client() {
  // postgres.js connects lazily, so a missing URL only fails on the first query
  const url = process.env.DATABASE_URL ?? "postgres://localhost:5432/origines";
  // prepare:false keeps it compatible with Supabase/Neon connection poolers
  return postgres(url, { prepare: false, max: Number(process.env.DB_POOL_MAX ?? 5) });
}

const pg = globalForDb.pg ?? client();
if (process.env.NODE_ENV !== "production") globalForDb.pg = pg;

export const db = drizzle(pg, { schema });
export { schema };
