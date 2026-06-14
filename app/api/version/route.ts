import { getBuildInfo } from "@/lib/version";

// PUBLIC, unauthenticated build-identity endpoint — deliberately excluded from
// the access gate in proxy.ts so it can be curled without a session (CD triage:
// "did prod pull the latest image?"). It exposes only the build version string,
// git SHA, and build time — all of which are public (the repo is public) and
// carry no secrets. force-dynamic so it reads process.env at request time
// instead of baking the build-time "dev" defaults into a static response.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getBuildInfo());
}
