import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// Auth.js (NextAuth v5) instance. The app is gated to Microsoft Entra ID users —
// any signed-in account is allowed (no authorization/groups yet). JWT sessions
// (no database adapter) keep this edge-safe and in-memory, matching the rest of
// the prototype. The Entra credentials live in `.env`; we read the existing
// AZURE_* names directly rather than Auth.js's AUTH_MICROSOFT_ENTRA_ID_* names.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`,
    }),
  ],
  callbacks: {
    // The gate: allow any authenticated user; the proxy redirects everyone else
    // to the sign-in page.
    authorized: ({ auth }) => !!auth?.user,
  },
});
