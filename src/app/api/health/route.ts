import { NextResponse } from "next/server";
import { rawClient } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const url = process.env.DATABASE_URL;
  let target = "DATABASE_URL is NOT set";
  if (url) {
    try {
      const u = new URL(url);
      target = `${u.username}@${u.hostname}:${u.port || "5432"}${u.pathname}`;
    } catch {
      target = "DATABASE_URL is set but is not a valid address";
    }
  }

  const result: Record<string, unknown> = {
    database: target,
    vercelRegion: process.env.VERCEL_REGION ?? "local",
  };

  const withTimeout = <T,>(p: Promise<T>, ms: number) =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`No answer from the database after ${ms / 1000}s`)), ms),
      ),
    ]);

  const t0 = Date.now();
  try {
    await withTimeout(rawClient`select 1`, 20000);
    result.connected = true;
    result.queryMs = Date.now() - t0;
    const tables = await withTimeout(
      rawClient<{ table_name: string }[]>`
        select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`,
      10000,
    );
    result.tables = tables.map((t) => t.table_name);
    if ((result.tables as string[]).length === 0) {
      result.hint = "Connected, but no tables found — run drizzle/0000_init.sql in Supabase SQL Editor.";
    }
  } catch (err) {
    result.connected = false;
    result.afterMs = Date.now() - t0;
    result.error = err instanceof Error ? err.message : String(err);
  }
  return NextResponse.json(result, { status: result.connected ? 200 : 500 });
}