import { expect, test } from "@playwright/test";
import { verifyPassword } from "better-auth/crypto";
import type { PoolClient } from "pg";
import { authModeProvenanceRefusal } from "../lib/db/auth-mode-preflight";
import { DEMO_PASSWORD, DEMO_PERSONAS } from "../lib/demo-personas";
import { seedDemoPersonasInTransaction } from "../lib/demo-seed";
import { getPool } from "./db";

// @demo: the demo boot's database half (docs/auth.md, "Demo mode"), called directly
// against the database the demo server booted with (and seeded). Every test runs in
// ONE transaction that is rolled back, so nothing is left behind in whatever
// database a local run points at.

const [ANNA] = DEMO_PERSONAS;
if (!ANNA) throw new Error("demo personas missing");

async function inRolledBackTransaction(work: (db: PoolClient) => Promise<void>): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await work(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

async function insertUser(db: PoolClient, id: string, email = `${id}@example.com`) {
  await db.query(
    `INSERT INTO novedu_user (id, name, email, email_verified, is_teacher, created_at, updated_at)
     VALUES ($1, $1, $2, false, false, now(), now())`,
    [id, email],
  );
}

const tags = ["@demo", "@live", "@live-db"];

test("the provenance preflight tells the two modes' databases apart", { tag: tags }, async () => {
  await inRolledBackTransaction(async (db) => {
    // The booted demo database: credential accounts only.
    expect(await authModeProvenanceRefusal(db, "demo")).toBeNull();
    expect(await authModeProvenanceRefusal(db, "entra")).toMatch(/demo \("credential"\) accounts/);

    // e2e principals are users without accounts: still a demo database.
    await insertUser(db, "e2e-demo-preflight");
    expect(await authModeProvenanceRefusal(db, "demo")).toBeNull();

    // One real sign-in ever: a real installation's database.
    await db.query(
      `INSERT INTO novedu_account (id, account_id, provider_id, user_id, created_at, updated_at)
       VALUES ('e2e-demo-preflight-ms', 'oid', 'microsoft', 'e2e-demo-preflight', now(), now())`,
    );
    expect(await authModeProvenanceRefusal(db, "demo")).toMatch(/"microsoft" sign-in accounts/);
  });
});

test("the seed is idempotent and resets drift", { tag: tags }, async () => {
  await inRolledBackTransaction(async (db) => {
    const hash = async () =>
      (
        await db.query<{ password: string }>("SELECT password FROM novedu_account WHERE id = $1", [
          ANNA.accountId,
        ])
      ).rows[0]?.password;

    await seedDemoPersonasInTransaction(db);
    const first = await hash();
    await seedDemoPersonasInTransaction(db);
    // scrypt salts randomly: an unchanged hash means it was verified, not redone.
    expect(await hash()).toBe(first);

    await db.query("UPDATE novedu_user SET is_teacher = false, name = 'X' WHERE id = $1", [
      ANNA.id,
    ]);
    await db.query("UPDATE novedu_account SET password = 'tampered' WHERE id = $1", [
      ANNA.accountId,
    ]);
    await seedDemoPersonasInTransaction(db);

    const user = await db.query<{ is_teacher: boolean; name: string }>(
      "SELECT is_teacher, name FROM novedu_user WHERE id = $1",
      [ANNA.id],
    );
    expect(user.rows[0]).toEqual({ is_teacher: true, name: ANNA.name });
    const restored = await hash();
    expect(restored).not.toBe("tampered");
    expect(await verifyPassword({ hash: restored ?? "", password: DEMO_PASSWORD })).toBe(true);
  });
});

test("the seed never takes over a persona email held by another user", { tag: tags }, async () => {
  await inRolledBackTransaction(async (db) => {
    await db.query("UPDATE novedu_user SET email = 'moved@demo.novedu.invalid' WHERE id = $1", [
      ANNA.id,
    ]);
    await insertUser(db, "e2e-demo-squatter", ANNA.email);

    await expect(seedDemoPersonasInTransaction(db)).rejects.toThrow(
      `${ANNA.email} already belongs to user e2e-demo-squatter`,
    );
  });
});
