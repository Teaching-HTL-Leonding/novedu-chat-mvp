-- Empty the Postgres database immediately BEFORE the one-off SQL Server → Postgres
-- data copy (`scripts/mssql-to-pg/`).
--
-- Run ONLY in the coordinated cutover, after `az webapp stop` — never by the app, and
-- never against a database that is serving traffic. This statement deletes every row
-- the app owns.
--
-- Why it is needed: the Postgres structures were created during implementation, and
-- development and test runs against that server left rows behind in the `novedu_*`
-- tables and in Mastra's `mastra.*` tables. The copy script refuses to write into a
-- non-empty target (its rerun guard), so those rows must go first. Conversations are
-- NOT migrated: Mastra's tables start empty on Postgres.
--
-- Run it as the server's Entra admin on database `novedu` (there is no psql on the
-- dev machines — push it through a small node/pg client authenticated with an Entra
-- token as the password, the same way `scripts/db/provision.sql` is run).
--
-- `novedu_drizzle_migrations` is deliberately NOT touched: it is Drizzle's migration
-- bookkeeping for the schema that is already in place, not data.

---------------------------------------------------------------------------------
-- Block 1 — the 11 app-owned tables, one statement so it is all-or-nothing
---------------------------------------------------------------------------------

truncate table
  public.novedu_users,
  public.novedu_codes,
  public.novedu_user_chats,
  public.novedu_recent_codes,
  public.novedu_writing_submissions,
  public.novedu_reports,
  public.novedu_coding_keys,
  public.novedu_files,
  public.novedu_images,
  public.novedu_usage_by_code,
  public.novedu_usage_by_user;

---------------------------------------------------------------------------------
-- Block 2 — every table Mastra owns in schema `mastra`
---------------------------------------------------------------------------------

-- Discovered dynamically rather than listed, so it still empties the schema after
-- Mastra adds a table. Base tables only (views and foreign tables are skipped), and
-- nothing outside schema `mastra` can be reached from here.
do $$
declare
  target text;
begin
  select string_agg(format('%I.%I', table_schema, table_name), ', ')
    into target
    from information_schema.tables
   where table_schema = 'mastra'
     and table_type = 'BASE TABLE';

  if target is null then
    raise notice 'schema mastra holds no tables — nothing to truncate';
  else
    raise notice 'truncating: %', target;
    execute 'truncate table ' || target || ' cascade';
  end if;
end
$$;
