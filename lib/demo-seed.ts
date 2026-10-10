import { hashPassword, verifyPassword } from "better-auth/crypto";
import type { Queryable } from "@/lib/db/auth-mode-preflight";
import { DEMO_PASSWORD, DEMO_PERSONAS } from "@/lib/demo-personas";

// Seeds the four demo personas (lib/demo-personas.ts) at every demo-build boot
// (docs/auth.md, "Demo mode"): their `novedu_user` rows and their `credential`
// accounts, resetting any drift (a changed role, name or password). In a demo
// build this seed is the only writer of the personas' `is_teacher` — the Entra
// account hook is not registered.
//
// Raw SQL on purpose: the e2e suite runs it directly against its database inside a
// rolled-back transaction, through the same `pg` client it uses everywhere else.

/** Fixed key of the transaction-level advisory lock: a dev server may boot twice concurrently. */
export const DEMO_SEED_LOCK_KEY = 4_242_017;

/**
 * Seeds the personas through `db`, which must already be inside a transaction —
 * the advisory lock is transaction-scoped. Throws (rolling the caller back) when a
 * persona email is held by a row with a different id: no silent takeover.
 */
export async function seedDemoPersonasInTransaction(db: Queryable): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock($1)", [DEMO_SEED_LOCK_KEY]);

  for (const persona of DEMO_PERSONAS) {
    const holder = await db.query<{ id: string }>(
      "SELECT id FROM novedu_user WHERE lower(email) = lower($1) AND id <> $2",
      [persona.email, persona.id],
    );
    if (holder.rows[0]) {
      throw new Error(
        `demo seed: ${persona.email} already belongs to user ${holder.rows[0].id} — refusing to take it over`,
      );
    }

    // `created_at` / `updated_at` have no database default better-auth relies on,
    // so both are written explicitly; a re-seed keeps the original `created_at`.
    await db.query(
      `INSERT INTO novedu_user (id, name, given_name, email, email_verified, is_teacher, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, $5, now(), now())
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             given_name = EXCLUDED.given_name,
             email = EXCLUDED.email,
             email_verified = true,
             is_teacher = EXCLUDED.is_teacher,
             updated_at = now()`,
      [persona.id, persona.name, persona.givenName, persona.email, persona.role === "teacher"],
    );

    // scrypt salts randomly, so the stored hash is kept when it still verifies —
    // re-hashing on every boot would rewrite every row.
    const stored = await db.query<{ password: string | null }>(
      "SELECT password FROM novedu_account WHERE id = $1",
      [persona.accountId],
    );
    const current = stored.rows[0]?.password;
    const valid =
      typeof current === "string" &&
      (await verifyPassword({ hash: current, password: DEMO_PASSWORD }).catch(() => false));
    const password = valid ? current : await hashPassword(DEMO_PASSWORD);

    // better-auth's credential sign-in only accepts an account with
    // `provider_id = 'credential'` and `account_id = user id`. `novedu_account` has
    // no unique index on (provider_id, account_id), so the FIXED primary key is
    // what makes this upsert safe to repeat.
    await db.query(
      `INSERT INTO novedu_account (id, account_id, provider_id, user_id, password, created_at, updated_at)
       VALUES ($1, $2, 'credential', $2, $3, now(), now())
       ON CONFLICT (id) DO UPDATE
         SET account_id = EXCLUDED.account_id,
             provider_id = 'credential',
             user_id = EXCLUDED.user_id,
             password = EXCLUDED.password,
             updated_at = CASE WHEN novedu_account.password IS DISTINCT FROM EXCLUDED.password
                                 OR novedu_account.user_id IS DISTINCT FROM EXCLUDED.user_id
                               THEN now() ELSE novedu_account.updated_at END`,
      [persona.accountId, persona.id, password],
    );
  }
}

/** The pool's side of a transaction: a dedicated client. */
export interface TransactionPool {
  connect(): Promise<Queryable & { release(): void }>;
}

/** Seeds the personas in one transaction of its own — the boot's form. */
export async function seedDemoPersonas(pool: TransactionPool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await seedDemoPersonasInTransaction(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
