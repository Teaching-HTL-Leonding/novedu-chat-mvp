// The build's sign-in mode (docs/auth.md, "Demo mode"). `NOVEDU_AUTH_MODE` is read
// HERE and only here — by `next.config.ts`, which re-emits the normalized value
// through `nextConfig.env`. Next inlines every `config.env` entry at build time, in
// server and client code alike, so each branch site's literal
// `process.env.NOVEDU_AUTH_MODE === "demo"` folds to a constant and the other mode's
// code is dropped from the bundle. A `NEXT_PUBLIC_*` name would not do: Next only
// inlines one that is SET at build time, so an unset variable would leave a live
// runtime lookup — a switch anyone could flip on the production image.
//
// Imported by `next.config.ts` (relative import, no path alias), so it stays free
// of every app import.

export type AuthMode = "entra" | "demo";

const MODES: readonly AuthMode[] = ["entra", "demo"];

/**
 * The validated mode from the build environment: `entra` when unset or empty,
 * otherwise exactly `entra` or `demo`. Throws on anything else, and on a set
 * `NEXT_PUBLIC_NOVEDU_AUTH_MODE` — that name would be inlined by Next on its own,
 * beside (and possibly against) the one this function emits.
 */
export function parseAuthMode(env: Record<string, string | undefined>): AuthMode {
  if (env.NEXT_PUBLIC_NOVEDU_AUTH_MODE !== undefined) {
    throw new Error(
      "NEXT_PUBLIC_NOVEDU_AUTH_MODE must not be set — the sign-in mode is NOVEDU_AUTH_MODE (entra or demo)",
    );
  }
  const raw = env.NOVEDU_AUTH_MODE;
  if (raw === undefined || raw === "") return "entra";
  if ((MODES as readonly string[]).includes(raw)) return raw as AuthMode;
  throw new Error(
    `NOVEDU_AUTH_MODE must be one of ${MODES.join(", ")} (or unset for entra), got "${raw}"`,
  );
}
