import { defineConfig } from "drizzle-kit";

// Config for `npm run db:generate` (drizzle-kit generate), which diffs
// lib/db/schema.ts against the committed migrations in `drizzle/` and emits a
// new SQL migration — no database connection involved. Migrations are applied
// at app startup (instrumentation.ts), NOT by drizzle-kit, so no
// `dbCredentials` are configured here.
export default defineConfig({
  dialect: "mssql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
});
