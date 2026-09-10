-- Local Docker Compose Postgres (compose.yaml): runs once, when the data volume
-- is first created. The app expects Mastra's schema to pre-exist and only creates
-- the tables inside it (app/mastra/index.ts); CI does the same in
-- scripts/ci/wait-and-create-db.mjs. Nothing else: the `novedu_*` tables come
-- from the Drizzle migrations the app applies at startup (instrumentation.ts).
CREATE SCHEMA IF NOT EXISTS mastra;
