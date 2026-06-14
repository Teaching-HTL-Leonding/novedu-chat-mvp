// Build identity of the running image. The three values are baked into the
// Docker image at build time (Dockerfile ARG -> ENV, fed by docker-publish.yml)
// and read back at runtime to triage deployments — i.e. confirm the App Service
// container actually pulled the latest published image. In local `npm run dev`
// the env vars are unset, so everything reads "dev".
//
// `version` matches the Docker image TAG the workflow pushes
// (`<package.json version>.<run number>`), so /api/version maps 1:1 to a tag.

export type BuildInfo = {
  /** Image tag, e.g. "0.1.0.142". "dev" when running outside a built image. */
  version: string;
  /** Full commit SHA the image was built from, or "unknown". */
  gitSha: string;
  /** ISO-8601 build timestamp, or "unknown". */
  builtAt: string;
};

export function getBuildInfo(): BuildInfo {
  return {
    version: process.env.APP_VERSION || "dev",
    gitSha: process.env.APP_GIT_SHA || "unknown",
    builtAt: process.env.APP_BUILD_TIME || "unknown",
  };
}
