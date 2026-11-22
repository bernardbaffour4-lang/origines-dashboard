import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't read .env.local by itself (Next.js does), so load it here.
// On Vercel there is no .env.local file, so a missing file is fine.
try {
  process.loadEnvFile(".env.local");
} catch {
  /* no .env.local — use the environment as-is */
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Add it to your .env.local file.");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
});
