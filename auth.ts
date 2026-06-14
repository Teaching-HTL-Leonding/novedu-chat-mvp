import NextAuth, { type DefaultSession } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { resolveTeacher } from "@/lib/teacher";

// Extra, app-specific fields we remember on the session. They are computed once
// at sign-in from the Entra ID-token claims and stored in the encrypted session
// token (a JWE), so they survive across requests without re-querying Entra.
declare module "next-auth" {
  interface Session {
    user: {
      // Stable per-user identifier: the Entra `oid` (object id) claim, which is
      // constant for a user across every app AND every reply-URL host within the
      // tenant. We deliberately do NOT use `sub`: `sub` is a *pairwise* subject
      // id scoped to the redirect-URI host, so the SAME user gets a DIFFERENT
      // `sub` on localhost vs. the Azure hostname — which silently partitioned
      // per-user data (tutor-code ownership, user↔chat links) by environment.
      // Falls back to `sub` only if a token ever lacks `oid`; "" if neither.
      id: string;
      // Whether the signed-in user is a teacher (member of TEACHER_GROUP_ID).
      // Gates teacher-only operations. `name`, `email` and `image` are already
      // populated by Auth.js from the Entra profile.
      isTeacher: boolean;
      preferredUsername?: string;
    } & DefaultSession["user"];
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    isTeacher?: boolean;
    preferredUsername?: string;
    // Entra object id — the host-independent stable user key (see Session.user.id).
    oid?: string;
  }
}

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

// Auth.js (NextAuth v5) instance. The app is gated to Microsoft Entra ID users —
// any signed-in account is allowed through the gate; finer-grained authorization
// (teacher-only operations) is enforced per-action via `session.user.isTeacher`.
// JWT sessions (no database adapter) keep this edge-safe and in-memory, matching
// the rest of the prototype. The Entra credentials live in `.env`; we read the
// existing AZURE_* names directly rather than Auth.js's AUTH_MICROSOFT_ENTRA_ID_*
// names.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: required("AZURE_CLIENT_ID"),
      clientSecret: required("AZURE_CLIENT_SECRET"),
      issuer: `https://login.microsoftonline.com/${required("AZURE_TENANT_ID")}/v2.0`,
    }),
  ],
  callbacks: {
    // The gate: allow any authenticated user; the proxy redirects everyone else
    // to the sign-in page.
    authorized: ({ auth }) => !!auth?.user,
    // `profile` (the decoded Entra ID token) is only present on sign-in. Derive
    // the teacher flag and remember the preferred username then; on later calls
    // the values already live on the token.
    jwt: ({ token, profile }) => {
      if (profile) {
        const { isTeacher, overage } = resolveTeacher(profile, TEACHER_GROUP_ID);
        if (overage) {
          console.warn(
            "[auth] Entra returned a group overage claim; teacher status cannot be derived " +
              "from the token and defaults to non-teacher. A Microsoft Graph lookup would be " +
              "required to resolve membership for this user.",
          );
        }
        token.isTeacher = isTeacher;
        if (typeof profile.preferred_username === "string") {
          token.preferredUsername = profile.preferred_username;
        }
        // `oid` isn't on Auth.js's Profile type but is always present in Entra
        // work/school ID tokens — capture it as the stable, host-independent id.
        const oid = (profile as { oid?: unknown }).oid;
        if (typeof oid === "string") {
          token.oid = oid;
        }
      }
      return token;
    },
    session: ({ session, token }) => {
      session.user.id = token.oid ?? token.sub ?? "";
      session.user.isTeacher = token.isTeacher ?? false;
      session.user.preferredUsername = token.preferredUsername;
      return session;
    },
  },
});

/**
 * Guard for teacher-only server work (server actions / route handlers). Returns
 * the session when the caller is a teacher, otherwise throws. Callers in a route
 * handler should catch this and respond 403.
 */
export async function requireTeacher() {
  const session = await auth();
  if (!session?.user?.isTeacher) {
    throw new Error("Forbidden: this operation requires a teacher account.");
  }
  return session;
}
