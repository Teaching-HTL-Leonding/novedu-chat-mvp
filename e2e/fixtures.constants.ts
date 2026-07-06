// Single source of truth for the local fixtures server's address. Three parties
// must agree on it: playwright.config.ts (spawns `node test-fixtures/serve.mjs`
// with E2E_FIXTURES_PORT set from here and health-checks FIXTURES_BASE), the
// server itself (reads that env var), and the specs (mint codes whose file_url
// points at FIXTURES_BASE via code.utils.ts). Change the port HERE only.

export const FIXTURES_PORT = 34567;
export const FIXTURES_BASE = `http://127.0.0.1:${FIXTURES_PORT}`;
