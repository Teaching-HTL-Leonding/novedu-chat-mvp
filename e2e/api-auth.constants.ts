import path from "node:path";

// Shared between the Playwright config (which injects API_AUTH_JWKS_PATH into
// the dev server env) and the api-auth setup/specs. Kept free of `test()`
// calls for the same reason as auth.constants.ts.
//
// Absolute paths: the config hands JWKS_PATH to a child-process env, where a
// cwd-relative path would silently depend on where the server was spawned.
export const API_AUTH_JWKS_PATH = path.resolve("e2e", ".auth", "jwks.json");
export const API_AUTH_PRIVATE_JWK_PATH = path.resolve("e2e", ".auth", "jwks-private.json");
export const API_AUTH_KID = "e2e-api-auth";
