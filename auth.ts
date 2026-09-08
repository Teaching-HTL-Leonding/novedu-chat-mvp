import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { authSchema, authUsers } from "@/lib/db/auth-schema";
import { teacherFromIdToken } from "@/lib/teacher";
import { recordError } from "@/lib/telemetry";

// Fail fast (and clearly) at startup if a required credential is missing, rather
// than interpolating `undefined` into the issuer URL and failing mid-sign-in
// with an opaque OAuth discovery error.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// The Entra security group whose members are teachers. It lives in `.env`
// because it is tenant-specific configuration (not a secret).
const TEACHER_GROUP_ID = required("TEACHER_GROUP_ID");

const DAY_SECONDS = 60 * 60 * 24;

/**
 * The teacher role, recomputed from the ID token on every sign-in and written to
 * `novedu_user.is_teacher`. The flag is SERVER-OWNED: `input: false` below keeps
 * it off every API surface, and this hook is the only writer.
 *
 * It runs on the account row (created on the first sign-in of an identity,
 * updated on every later one), where better-auth has just stored the fresh
 * `id_token` — and it runs BEFORE the session is created, so the very next
 * `getSession` already reflects the new role.
 *
 * Everything is wrapped: a failure here must never block sign-in. The flag then
 * keeps its previous value, which for a new user is `false` — fail closed.
 */
async function applyTeacherFlag(account: { userId: string; idToken?: string | null }) {
  try {
    if (typeof account.idToken !== "string") return;
    const { isTeacher, overage } = teacherFromIdToken(account.idToken, TEACHER_GROUP_ID);
    if (overage) {
      console.warn(
        "[auth] Entra returned a group overage claim; teacher status cannot be derived " +
          "from the token and defaults to non-teacher. A Microsoft Graph lookup would be " +
          "required to resolve membership for this user.",
      );
    }
    await getDb().update(authUsers).set({ isTeacher }).where(eq(authUsers.id, account.userId));
  } catch (error) {
    recordError(error, { "novedu.auth.stage": "apply-teacher-flag" });
    console.error("[auth] recomputing the teacher flag failed", error);
  }
}

// The one auth system. Microsoft Entra ID (single tenant) is the only provider;
// any signed-in account passes the gate, and finer-grained authorization
// (teacher-only work) is enforced per action from `user.isTeacher` — through
// `requireEffectiveTeacher()` wherever student mode applies (docs/auth.md).
//
// Sessions live in the database (`novedu_session`), so both channels share one
// notion of "signed in": the browser sends the session token in a signed cookie,
// the CLI sends the same token as a bearer (the `bearer()` plugin).
//
// The Entra credentials live in `.env` under the app's own AZURE_* names.
export const auth = betterAuth({
  database: drizzleAdapter(getDb(), { provider: "pg", schema: authSchema }),
  // Signs the session cookie (and, elsewhere, derives the thread-ownership HMAC
  // key — see lib/thread-token.ts).
  secret: required("AUTH_SECRET"),
  // Undefined locally: better-auth then infers the base URL from the request.
  // Production sets AUTH_URL, which also makes that host a trusted origin.
  baseURL: process.env.AUTH_URL,
  socialProviders: {
    microsoft: {
      clientId: required("AZURE_CLIENT_ID"),
      clientSecret: required("AZURE_CLIENT_SECRET"),
      tenantId: required("AZURE_TENANT_ID"),
      // The Entra profile is authoritative for the display name and email: both
      // are overwritten on every sign-in.
      overrideUserInfoOnSignIn: true,
      // No avatars anywhere in the app — the user menu renders initials — so the
      // provider's Microsoft Graph photo fetch (an untimed extra request on every
      // callback) is skipped entirely.
      disableProfilePhoto: true,
      // The provider spreads this over `{ name, email, image, emailVerified }`,
      // both when it creates the user and on the `overrideUserInfoOnSignIn`
      // update, so these three fields are what every sign-in writes.
      mapProfileToUser: (profile) => ({
        // `novedu_user.name` is NOT NULL and every name fallback in the app
        // (`??`, `COALESCE`) treats an empty string as a real name, so a profile
        // without a `name` claim must not store `""`.
        name: profile.name?.trim() || profile.preferred_username || profile.email || profile.oid,
        // A profile with no `email` claim would otherwise be rejected with
        // EMAIL_NOT_FOUND; `preferred_username` is the tenant-unique UPN.
        email: profile.email ?? profile.preferred_username ?? `${profile.oid}@entra.invalid`,
        // A NULL is what clears the column; `undefined` would leave whatever the
        // provider supplied in place. better-auth types the mapped `image` as
        // `string | undefined`, hence the cast.
        image: null as unknown as string,
      }),
    },
  },
  user: {
    modelName: "novedu_user",
    additionalFields: {
      isTeacher: {
        type: "boolean",
        required: false,
        defaultValue: false,
        // Server-owned: settable only by `applyTeacherFlag`, never through the API.
        input: false,
        returned: true,
      },
    },
  },
  session: {
    modelName: "novedu_session",
    // A FIXED 30-day window (owner decision): the session is never extended, so
    // everyone signs in again 30 days after signing in.
    expiresIn: 30 * DAY_SECONDS,
    // A refresh would emit a session Set-Cookie, and `nextCookies()` writes those
    // into whatever response is being built — including a BEARER route's, which
    // would plant the CLI caller's session as a cookie in the browser that
    // happened to trigger it. A Server Component cannot write a cookie either, so
    // half the cookie channel could not renew anyway.
    disableSessionRefresh: true,
  },
  // NO cookie cache (owner decision): every request resolves its session from the
  // database (an indexed lookup on `novedu_session.token`, plus the user row).
  // That keeps sign-out and a changed `is_teacher` visible immediately on both
  // channels, with no staleness window to reason about. It is one line to enable
  // later if the queries ever matter.
  account: {
    modelName: "novedu_account",
    // One person, one `novedu_user` row: an Entra identity whose `oid` is not yet
    // in `novedu_account` links to the existing user row with the same email
    // instead of creating a second one. BOTH options are needed
    // (`oauth2/link-account.mjs`): Entra ID tokens carry no `email_verified`
    // claim, and the app's own rows have `email_verified = false`.
    //
    // SAFE ONLY WHILE THE ENTRA APP IS SINGLE-TENANT — the tenant owns every
    // email it can present. Revisit before admitting a second tenant, where one
    // tenant could claim another's address.
    accountLinking: {
      trustedProviders: ["microsoft"],
      requireLocalEmailVerified: false,
    },
  },
  verification: { modelName: "novedu_verification" },
  // The app owns display names: they come from the Entra profile on every
  // sign-in, and teacher-facing lists resolve user ids through
  // `novedu_user.name`. Without this, any signed-in user could rewrite their own
  // name (and image) through `POST /api/auth/update-user`; the path 404s instead.
  disabledPaths: ["/update-user"],
  advanced: {
    // The app's own cookie name: `novedu.session_token`, and
    // `__Secure-novedu.session_token` under https. Cookies ignore ports, so a
    // shared `better-auth` prefix would let any other better-auth app on
    // localhost overwrite this app's session cookie.
    cookiePrefix: "novedu",
  },
  databaseHooks: {
    account: {
      create: { after: applyTeacherFlag },
      update: { after: applyTeacherFlag },
    },
  },
  plugins: [
    // The CLI's sign-in: it asks for a device code and polls while the person
    // approves it at /device in a browser that already has a session.
    deviceAuthorization({
      verificationUri: "/device",
      validateClient: async (clientId) => clientId === "novedu-cli",
      schema: { deviceCode: { modelName: "novedu_device_code" } },
    }),
    // Accepts the session token as `Authorization: Bearer …` — the CLI/API channel.
    bearer(),
    // Lets server actions and route handlers set better-auth's cookies. MUST stay
    // last: it wraps the response of every plugin declared before it.
    nextCookies(),
  ],
});

/** The `{ session, user }` pair `auth.api.getSession` returns when signed in. */
export type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
