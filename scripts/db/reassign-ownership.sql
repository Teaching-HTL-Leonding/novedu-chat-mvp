-- Hand every table and sequence in the app's two schemas to the app role.
--
-- Under the privilege model in docs/database.md the web app's Managed Identity
-- `novedu-chat-mvp-at` must OWN the tables it works with: Postgres lets only the
-- owner ALTER a table, and Mastra's `init()` runs `ALTER TABLE ... ADD COLUMN IF NOT
-- EXISTS` on every boot. The database is shared by dev and prod, so whenever a
-- developer's own `az login` identity is the first to boot a new migration (or a
-- Mastra upgrade) against it, the new objects belong to that developer — and the
-- production identity is locked out of them until this script has run.
--
-- Run as the Entra admin on database `novedu` after any such local-first boot.
-- Idempotent: objects already owned by the app role are skipped.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'mastra')
      AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
      AND pg_get_userbyid(c.relowner) <> 'novedu-chat-mvp-at'
      -- A sequence behind a serial/identity column moves with its table; altering it
      -- on its own is refused (0A000), so only free-standing sequences are listed.
      AND NOT (c.relkind = 'S' AND EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = c.oid AND d.classid = 'pg_class'::regclass AND d.deptype = 'a'))
    ORDER BY c.relkind
  LOOP
    IF r.relkind = 'S' THEN
      EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I', r.nspname, r.relname, 'novedu-chat-mvp-at');
    ELSIF r.relkind = 'v' THEN
      EXECUTE format('ALTER VIEW %I.%I OWNER TO %I', r.nspname, r.relname, 'novedu-chat-mvp-at');
    ELSIF r.relkind = 'm' THEN
      EXECUTE format('ALTER MATERIALIZED VIEW %I.%I OWNER TO %I', r.nspname, r.relname, 'novedu-chat-mvp-at');
    ELSE
      EXECUTE format('ALTER TABLE %I.%I OWNER TO %I', r.nspname, r.relname, 'novedu-chat-mvp-at');
    END IF;
  END LOOP;
END $$;
