import { createAuthClient } from "better-auth/react";

// The browser half of better-auth. Only the sign-in page uses it (to start the
// Entra redirect); everything else reads the session on the server through
// `lib/session.ts`.
//
// No `baseURL`: the client talks to `/api/auth/*` on the same origin.
export const authClient = createAuthClient();
