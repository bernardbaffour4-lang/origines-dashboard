import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };

function client() {
  // postgres.js connects lazily, so a missing URL only fails on the first query
  const url = process.env.DATABASE_URL ?? "postgres://localhost:5432/origines";
  return postgres(url, {
    prepare: false, // required for Supabase's transaction pooler (port 6543)
    max: Number(process.env.DB_POOL_MAX ?? 3),
    connect_timeout: 10, // give up connecting after 10s instead of hanging
    idle_timeout: 20, // release idle connections quickly (important on Vercel)
    max_lifetime: 60 * 5,
    connection: { statement_timeout: 15000 }, // no single query may run over 15s
  });
}

const pg = globalForDb.pg ?? client();
if (process.env.NODE_ENV !== "production") globalForDb.pg = pg;

export const db = drizzle(pg, { schema });
export const rawClient = pg;
export { schema };
