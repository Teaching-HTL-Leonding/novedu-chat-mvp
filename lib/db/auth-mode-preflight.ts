import type { AuthMode } from "@/lib/auth-mode";

// One sign-in mode per database (docs/auth.md, "Demo mode"). better-auth resolves a
// session from its row without asking how it was created, so an Entra build pointed
// at a demo database would keep honouring the demo sessions and bearer tokens — and
// a demo build pointed at real data would let anyone in. Each build therefore
// refuses a database holding the OTHER mode's accounts, read from `novedu_account`:
//
//  - an Entra build refuses any `credential` account (a demo persona);
//  - a demo build refuses any other provider's account (someone signed in through
//    a real identity provider). The e2e principals are user + session rows WITHOUT
//    account rows, so a database the e2e suite ran against keeps booting in both.
//
// Read-only, and run at boot BEFORE migrations and Mastra's storage init, so a wrong
// configuration never writes DDL to the wrong database. A fresh database (no
// `novedu_account` table yet) is accepted.

/** The slice of a `pg` Pool / PoolClient this needs. */
export interface Queryable {
  query<Row extends object>(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

/** Why a build of `mode` must not run against this database, or null when it may. */
export async function authModeProvenanceRefusal(
  db: Queryable,
  mode: AuthMode,
): Promise<string | null> {
  const table = await db.query<{ exists: boolean }>(
    `SELECT to_regclass('public.novedu_account') IS NOT NULL AS exists`,
  );
  if (!table.rows[0]?.exists) return null;

  const foreign = await db.query<{ provider_id: string }>(
    mode === "demo"
      ? `SELECT provider_id FROM novedu_account WHERE provider_id <> 'credential' LIMIT 1`
      : `SELECT provider_id FROM novedu_account WHERE provider_id = 'credential' LIMIT 1`,
  );
  const provider = foreign.rows[0]?.provider_id;
  if (provider === undefined) return null;

  return mode === "demo"
    ? `demo mode: this database holds "${provider}" sign-in accounts — it belongs to a real installation. Point DATABASE_URL at a separate database for the demo build.`
    : `Entra mode: this database holds demo ("credential") accounts — it belongs to a demo installation. Point DATABASE_URL at a separate database for the Entra build.`;
}

/** Throws the refusal, if any — the boot's form. */
export async function assertAuthModeProvenance(db: Queryable, mode: AuthMode): Promise<void> {
  const refusal = await authModeProvenanceRefusal(db, mode);
  if (refusal) throw new Error(refusal);
}
