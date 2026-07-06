import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test as setup } from "@playwright/test";
import { exportJWK, generateKeyPair } from "jose";
import { API_AUTH_JWKS_PATH, API_AUTH_KID, API_AUTH_PRIVATE_JWK_PATH } from "./api-auth.constants";

// Bearer-token counterpart of auth.setup.ts: real validation stays ON — the
// api-me specs mint genuine Entra-shaped JWTs (real env issuer/audience) and
// only the signing key is substituted. This setup generates that key pair:
// the public half as a JWKS file the dev server reads via API_AUTH_JWKS_PATH
// (injected by playwright.config.ts, honored by lib/api-auth.ts outside
// production only), the private half for the specs to sign with.
//
// The filename ends in "auth.setup.ts" on purpose — the config's existing
// setup-project testMatch picks it up.
//
// Generate-once, not per-run: lib/api-auth.ts caches the JWKS after the first
// bearer request, so a reused dev server (reuseExistingServer) would keep
// validating against the PREVIOUS run's keys if we rotated them here. The
// files live in the gitignored e2e/.auth/ and never expire.

setup("generate api-auth keypair", async () => {
  if (existsSync(API_AUTH_JWKS_PATH) && existsSync(API_AUTH_PRIVATE_JWK_PATH)) return;

  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);

  await mkdir(path.dirname(API_AUTH_JWKS_PATH), { recursive: true });
  await writeFile(
    API_AUTH_JWKS_PATH,
    JSON.stringify({ keys: [{ ...publicJwk, kid: API_AUTH_KID, alg: "RS256" }] }),
  );
  await writeFile(
    API_AUTH_PRIVATE_JWK_PATH,
    JSON.stringify({ ...privateJwk, kid: API_AUTH_KID, alg: "RS256" }),
  );
});
