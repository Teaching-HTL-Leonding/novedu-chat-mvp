-- One-time provisioning of the Novedu Postgres database on the Azure Database for
-- PostgreSQL Flexible Server `db-pgnovedu` (docs/database.md, "Privilege model").
--
-- Run ONCE as the server's Entra admin. There is no psql on the dev machines, so run
-- each block through a small node/pg script (or any client) authenticated with an
-- Entra token as the password:
--
--   az account get-access-token --resource https://ossrdbms-aad.database.windows.net \
--     --query accessToken -o tsv
--
-- The admin's Postgres role name is the Entra UPN as Azure registers it (for a guest
-- account the `..._domain#EXT#@tenant.onmicrosoft.com` form), not the e-mail address.
--
-- Resulting shape ("privilege model A"): the web app's system-assigned Managed
-- Identity `novedu-chat-mvp-at` is a plain login role — not superuser, no CREATEDB /
-- CREATEROLE, not the database owner — with CONNECT on `novedu` and USAGE + CREATE on
-- exactly two schemas. It owns the tables it creates at boot (Drizzle migrations in
-- `public`, Mastra's `init()` in `mastra`) and nothing else. Mastra needs DDL rights
-- at runtime (CREATE TABLE IF NOT EXISTS / ALTER TABLE ... ADD COLUMN IF NOT EXISTS),
-- which Postgres refuses for a non-owner even when nothing needs creating — that is
-- why the app role is not DML-only.

---------------------------------------------------------------------------------
-- Block 1 — on database `postgres` (pgaadauth_* only exists there)
---------------------------------------------------------------------------------

-- Register the Managed Identity as a Postgres role (isAdmin = false, isMfa = false).
select * from pgaadauth_create_principal('novedu-chat-mvp-at', false, false);

-- The database, owned by the Entra admin (NOT by the app role).
create database novedu;

---------------------------------------------------------------------------------
-- Block 2 — on database `novedu`
---------------------------------------------------------------------------------

-- Mastra's tables live in their own schema; the app's `novedu_*` tables stay in public.
create schema mastra;

-- Nobody but explicitly granted roles may create objects in public.
revoke create on schema public from public;

grant connect on database novedu to "novedu-chat-mvp-at";
grant usage, create on schema public to "novedu-chat-mvp-at";
grant usage, create on schema mastra to "novedu-chat-mvp-at";

-- A developer connecting with their own `az login` identity needs the same grants on
-- their role (the Entra admin already has everything).

---------------------------------------------------------------------------------
-- Block 3 — developers (as the Entra admin, any database)
---------------------------------------------------------------------------------

-- A developer connects with their own `az login` identity. Making that role a MEMBER
-- of the app role gives it the app role's privileges on every table the app owns
-- (and lets it alter them), so local dev works against the shared database without
-- per-table grants. The Entra admin is a plain role like any other here — it owns
-- the database, not the tables — so it needs this too. Objects a developer's boot
-- creates FIRST still belong to the developer: run scripts/db/reassign-ownership.sql
-- afterwards (see its header).
grant "novedu-chat-mvp-at" to "rainer_timecockpit.com#EXT#@rainertimecockpit.onmicrosoft.com";
