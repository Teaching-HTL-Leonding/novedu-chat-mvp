import { version as cliVersion } from "@/cli/package.json";
import { getBuildInfo } from "@/lib/version";

// PUBLIC, unauthenticated build-identity endpoint — deliberately excluded from
// the access gate in proxy.ts so it can be curled without a session (CD triage:
// "did prod pull the latest image?"). It exposes only the build version string,
// git SHA, build time, and the CLI version this server was built with — all of
// which are public (the repo is public, the CLI is published on npm) and carry
// no secrets. force-dynamic so it reads process.env at request time
// instead of baking the build-time "dev" defaults into a static response.
//
// `cliVersion` is a BUILD-TIME static JSON import, not a runtime fs read:
// `cli/package.json` is absent from the `.next/standalone` output, so only an
// import the bundler inlines works in both `npm run dev` and the Docker image.
// CLI and server share this repo, so at any server commit `cli/package.json`'s
// version IS the CLI release matching the `lib/**` code this server runs —
// which is what lets `novedu-cli eval` warn about a stale CLI whose frozen copy
// of the prompt builders may no longer match (`docs/cli-eval.md`). It stays out
// of `lib/version.ts`, whose `BuildInfo` contract is strictly "baked env vars"
// (and which the /health page hands to a client component).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ...getBuildInfo(), cliVersion });
}
