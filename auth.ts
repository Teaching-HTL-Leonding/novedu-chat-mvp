import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// Fail fast (and clearly) at startup if a required credential is missing, rather
// than interpolating `undefined` into the issuer URL and failing mid-sign-in
// with an opaque OAuth discovery error.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Auth.js (NextAuth v5) instance. The app is gated to Microsoft Entra ID users —
// any signed-in account is allowed (no authorization/groups yet). JWT sessions
// (no database adapter) keep this edge-safe and in-memory, matching the rest of
// the prototype. The Entra credentials live in `.env`; we read the existing
// AZURE_* names directly rather than Auth.js's AUTH_MICROSOFT_ENTRA_ID_* names.
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
  },
});
