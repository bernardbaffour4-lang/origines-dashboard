import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export const SETTINGS = {
  autoRelist: "auto_relist_enabled",
  relistLock: "relist_lock",
  lastRelistRun: "last_relist_run",
} as const;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key));
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
}

/**
 * Take a named lock so two runs (cron + button) can't overlap.
 * A lock older than `staleMinutes` is assumed abandoned and taken over.
 */
export async function acquireLock(key: string, staleMinutes = 15): Promise<boolean> {
  const rows = await db.execute(sql`
    insert into app_settings (key, value, updated_at)
    values (${key}, ${JSON.stringify({ at: new Date().toISOString() })}::jsonb, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
    where app_settings.value is null
       or (app_settings.value->>'at')::timestamptz < now() - (${staleMinutes} || ' minutes')::interval
    returning key`);
  return rows.length > 0;
}

export async function releaseLock(key: string) {
  await db
    .update(schema.appSettings)
    .set({ value: null })
    .where(eq(schema.appSettings.key, key));
}
