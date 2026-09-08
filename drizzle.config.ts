import { defineConfig } from "drizzle-kit";

// Config for `npm run db:generate` (drizzle-kit generate), which diffs the two
// schema files against the committed migrations in `drizzle/` and emits a new
// SQL migration — no database connection involved. Migrations are applied at app
// startup (instrumentation.ts), NOT by drizzle-kit, so no `dbCredentials` are
// configured here.
//
// TWO schema files: the app's own `novedu_*` tables and better-auth's tables
// (`lib/db/auth-schema.ts`, a hand-maintained mirror). Both live in `public` and
// migrate together.
export default defineConfig({
  dialect: "postgresql",
  schema: ["./lib/db/schema.ts", "./lib/db/auth-schema.ts"],
  out: "./drizzle",
});
