import { randomBytes, randomUUID } from "node:crypto";
import { query } from "./db";

// Mints the bearer credentials the CLI/API specs drive `lib/api-auth.ts` with.
// The credential IS a better-auth session token — the same string the device
// flow hands the CLI — so these specs exercise the real gate
// (`auth.api.getSession` over `novedu_session`) rather than a stub: there is no
// test seam anywhere on this channel.
//
// The rows are written straight into `novedu_user` / `novedu_session` through
// `e2e/db.ts`, exactly like `auth.setup.ts` does for the browser principals, so
// a token minted here needs the database (every spec using it is `@live-db` or
// fails inside the gate before any store call).

export interface MintSessionOptions {
  /** Give the principal the teacher role (`novedu_user.is_teacher`). */
  teacher?: boolean;
  /**
   * The `novedu_user.id` the token resolves to. Teacher and non-teacher default
   * to DIFFERENT ids on purpose: the row's `is_teacher` is shared state, so a
   * teacher spec and a non-teacher spec running in parallel would otherwise
   * flip the flag under each other. `email` is derived from the id (it is
   * unique), so a spec that needs its own principal only passes a new id.
   */
  userId?: string;
  name?: string;
  /** Mint a token whose session already expired, to prove the gate rejects it. */
  expired?: boolean;
}

/**
 * Upserts the principal, gives it a fresh session row and returns the RAW
 * session token (what goes into `Authorization: Bearer …`).
 */
export async function mintSessionToken({
  teacher = false,
  userId = teacher ? "e2e-api-teacher" : "e2e-api-user",
  name = teacher ? "E2E Api Teacher" : "E2E Api User",
  expired = false,
}: MintSessionOptions = {}): Promise<string> {
  await query(
    `INSERT INTO novedu_user (id, name, email, email_verified, is_teacher, created_at, updated_at)
     VALUES ($1, $2, $3, true, $4, now(), now())
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           email = EXCLUDED.email,
           is_teacher = EXCLUDED.is_teacher,
           updated_at = now()`,
    [userId, name, `${userId}@example.com`, teacher],
  );

  const token = randomBytes(24).toString("base64url"); // 32 chars
  await query(
    `INSERT INTO novedu_session (id, token, user_id, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, now() + ($4)::interval, now(), now())`,
    [randomUUID(), token, userId, expired ? "-1 hour" : "1 hour"],
  );

  return token;
}
