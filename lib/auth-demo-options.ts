import type { AuthModeBlock } from "@/lib/auth-options-merge";
import { demoBootRefusal } from "@/lib/demo-env-lock";

// The demo build's sign-in (docs/auth.md, "Demo mode"): email + password for the
// four seeded personas (lib/demo-personas.ts), nothing else. auth.ts imports this
// factory statically — `betterAuth({...})` is built synchronously at module load —
// but calls it only inside its `process.env.NOVEDU_AUTH_MODE === "demo"` branch.
// It is inert configuration on purpose: no password and no persona data, so
// whatever of it survives tree-shaking in an Entra build enables nothing.

/** The better-auth options a demo build adds to the shared base. */
export function demoAuthOptions(): AuthModeBlock {
  // A second line behind the demo boot's env lock in instrumentation.ts, for any
  // path that builds the auth instance without that boot.
  const refusal = demoBootRefusal(process.env);
  if (refusal) throw new Error(refusal);
  return {
    // Sign-in only: the personas are seeded at boot, nobody signs up.
    emailAndPassword: { enabled: true, disableSignUp: true },
    rateLimit: {
      customRules: {
        // better-auth's production default is 3 sign-ins per 10 s per IP, and a
        // class behind one NAT (or one Docker port mapping) shares one IP. The
        // password is public, so throttling protects nothing; the cap only bounds
        // the scrypt CPU an abuser can burn.
        "/sign-in/email": { window: 60, max: 100 },
      },
    },
  };
}
