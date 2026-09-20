-- Provisioning template for ONE stage (dev or prod) on the Azure Database for
-- PostgreSQL Flexible Server `psql-novedu` — one database and one app role per
-- stage on a single Entra-only server (password auth is disabled).
--
-- This file is NOT meant to be pasted into a client: it is a template with the
-- placeholders `{{db}}`, `{{app_role}}` and `{{admin_group}}`, split into blocks
-- by the `-- @block <name>` marker lines below, and it is run ONLY through
--
--   AZURE_CONFIG_DIR=~/.htl-azure-novedu node scripts/db/provision-stage.mjs <dev|prod>
--
-- which substitutes the stage's identifiers, picks the database each block runs
-- on, and skips the two statements that Postgres cannot express idempotently.
-- Replaying the whole script against an already-provisioned stage is a no-op:
-- the runner skips the principal and the database when they exist, and every
-- other statement is idempotent by itself.
--
-- Resulting shape (docs/database.md, "Privilege model"): the stage's Container
-- App runs under a system-assigned Managed Identity whose Postgres role is
-- `{{app_role}}` — a plain login role, not superuser, no CREATEDB / CREATEROLE,
-- not the database owner — with CONNECT + CREATE on `{{db}}` and USAGE + CREATE
-- on exactly two schemas. It owns the objects it creates at boot (Drizzle
-- migrations in `public`, Mastra's `init()` in `mastra`) and nothing else.
-- Mastra needs DDL rights at runtime (CREATE TABLE IF NOT EXISTS / ALTER TABLE
-- ... ADD COLUMN IF NOT EXISTS), which Postgres refuses for a non-owner even
-- when nothing needs creating — that is why the app role is not DML-only.
-- CREATE on the DATABASE is needed because Drizzle's migrator always runs
-- `CREATE SCHEMA IF NOT EXISTS` for its bookkeeping schema (`public` here)
-- before touching anything, and Postgres checks that privilege BEFORE the
-- IF NOT EXISTS shortcut — a role without it cannot boot.
--
-- The server's Entra admin is the security GROUP `{{admin_group}}`: a member
-- connects with that group name as the Postgres user and their own Entra access
-- token as the password, which is exactly what the runner does.

-- @block postgres:create-principal
-- On database `postgres` — `pgaadauth_*` exists only there.
-- Register the stage's Managed Identity as a Postgres role (isAdmin = false,
-- isMfa = false). The runner skips this when the role is already in pg_roles.
select * from pgaadauth_create_principal('{{app_role}}', false, false);

-- @block postgres:create-database
-- The stage database, owned by the connecting admin group (NOT by the app
-- role). The runner skips this when the database already exists.
create database {{db}};

-- @block stage
-- On database `{{db}}`. Every statement here is naturally idempotent.

-- Mastra's tables live in their own schema; the app's `novedu_*` tables stay in public.
create schema if not exists mastra;

-- Nobody but explicitly granted roles may create objects in public.
revoke create on schema public from public;

-- Both stages live on ONE server, so the stage boundary is a privilege, not a
-- network rule: without the implicit PUBLIC grant, only roles named below can
-- open a connection at all — one stage's identity cannot reach the other's data.
revoke connect on database {{db}} from public;

-- CREATE on the database only permits creating schemas (not tables in them); it is
-- what lets the Drizzle migrator's `CREATE SCHEMA IF NOT EXISTS "public"` pass.
grant connect, create on database {{db}} to "{{app_role}}";
grant usage, create on schema public to "{{app_role}}";
grant usage, create on schema mastra to "{{app_role}}";

-- @block stage:dev-only
-- On database `{{db}}`, dev stage only.
--
-- Every developer connects to the dev database as the admin group, so without a
-- default the objects a local boot creates first (Drizzle migrations, Mastra's
-- init()) would be owned by the group and the app identity would be locked out
-- of them — the "ownership hazard" of docs/database.md. Making the group a
-- member of the app role and defaulting `role` for that pair inside this
-- database means each such session automatically ACTS AS `{{app_role}}`, so
-- everything it creates is owned by the app role from the start and the hazard
-- cannot occur. Admin work inside `{{db}}` therefore starts with `SET ROLE NONE`
-- (which is what the runner itself does). The prod database has no such default:
-- there the group is a plain admin and nothing runs as the app role by accident.
grant "{{app_role}}" to "{{admin_group}}";
alter role "{{admin_group}}" in database {{db}} set role = '{{app_role}}';
