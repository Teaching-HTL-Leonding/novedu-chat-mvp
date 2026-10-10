import "server-only";

import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { demoAuthOptions } from "@/lib/auth-demo-options";
import { entraAuthOptions } from "@/lib/auth-entra-options";
import { mergeAuthOptions } from "@/lib/auth-options-merge";
import { getDb } from "@/lib/db";
import { authSchema } from "@/lib/db/auth-schema";
import { requiredEnv } from "@/lib/required-env";

const DAY_SECONDS = 60 * 60 * 24;

// The one auth system, with exactly ONE sign-in mode per build (docs/auth.md):
//
//  - Entra builds (the default): Microsoft Entra ID (single tenant) is the only
//    provider — `entraAuthOptions()`.
//  - Demo builds (`NOVEDU_AUTH_MODE=demo`, frozen at build time by next.config.ts):
//    one-click sign-in as one of four seeded demo personas — `demoAuthOptions()`.
//
// The literal comparison below folds to a constant at build time, so each build
// calls only its own factory. Everything else is shared: any signed-in account
// passes the gate, and finer-grained authorization (teacher-only work) is enforced
// per action from `user.isTeacher` — through `requireEffectiveTeacher()` wherever
// student mode applies.
//
// Sessions live in the database (`novedu_session`), so both channels share one
// notion of "signed in": the browser sends the session token in a signed cookie,
// the CLI sends the same token as a bearer (the `bearer()` plugin).
const shared = {
  database: drizzleAdapter(getDb(), { provider: "pg", schema: authSchema }),
  // Signs the session cookie (and, elsewhere, derives the thread-ownership HMAC
  // key — see lib/thread-token.ts).
  secret: requiredEnv("AUTH_SECRET"),
  // Undefined locally: better-auth then infers the base URL from the request.
  // Production sets AUTH_URL, which also makes that host a trusted origin.
  baseURL: process.env.AUTH_URL,
  user: {
    modelName: "novedu_user",
    additionalFields: {
      isTeacher: {
        type: "boolean",
        required: false,
        defaultValue: false,
        // Server-owned: written only server-side — the Entra account hook
        // (lib/auth-entra-options.ts) or the demo seed (lib/demo-seed.ts) — never
        // through the API.
        input: false,
        returned: true,
      },
      givenName: {
        type: "string",
        required: false,
        // Server-owned like `isTeacher`, by the same writers.
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
  account: { modelName: "novedu_account" },
  verification: { modelName: "novedu_verification" },
  // The app owns display names: they come from the Entra profile on every
  // sign-in (or the demo seed), and teacher-facing lists resolve user ids through
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
} satisfies BetterAuthOptions;

export const auth = betterAuth(
  mergeAuthOptions(
    shared,
    process.env.NOVEDU_AUTH_MODE === "demo" ? demoAuthOptions() : entraAuthOptions(),
  ),
);

/** The `{ session, user }` pair `auth.api.getSession` returns when signed in. */
export type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
