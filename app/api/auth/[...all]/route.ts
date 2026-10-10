import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/auth";

// better-auth owns every `/api/auth/*` sub-route: the sign-in (the Entra redirect
// and callback, or a demo build's email sign-in), `get-session`, `sign-out`, and
// the device-authorization endpoints the CLI polls. The catch-all segment hands
// the whole prefix to the one handler.
//
// A demo build answers only its allowlist (lib/auth-demo-allowlist.ts) and 404s
// everything else BEFORE better-auth's router runs — the demo personas are shared,
// so their account and session endpoints must not be (docs/auth.md, "Demo mode").
// The comparison folds at build time; an Entra build has no allowlist at all.
const handler = toNextJsHandler(auth);

async function demoRefusal(request: Request): Promise<Response | null> {
  if (process.env.NOVEDU_AUTH_MODE === "demo") {
    const { demoAuthAllows } = await import("@/lib/auth-demo-allowlist");
    if (!demoAuthAllows(request)) return new Response(null, { status: 404 });
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  return (await demoRefusal(request)) ?? handler.GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return (await demoRefusal(request)) ?? handler.POST(request);
}
