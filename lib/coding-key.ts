import { randomInt } from "node:crypto";

// THE definition of the coding module's `nvk-` API-key format: the accepted shape
// and the generator that mints it. PURE — no database, no app imports (node:crypto
// only) — so the e2e harness (`e2e/code.utils.ts`, kept on the plain `mssql` driver
// because Playwright's CJS runner cannot load drizzle) shares this one definition
// instead of a copy. Storage, lookup and issuance live in `lib/coding-key-store.ts`.

// The accepted key shape: the `nvk-` prefix plus 40 lowercase letters/digits.
// EXACT (unlike CODE_PATTERN, which stays broad for memorable codes) — every key
// there will ever be is minted by `generateCodingKey`, so the pattern doubles as
// the proxy's malformed-bearer fast path.
export const KEY_PATTERN = /^nvk-[a-z0-9]{40}$/;

const KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const KEY_LENGTH = 40;
// The `nvk-` marker makes a leaked key recognizable as a Novedu coding key
// (secret scanners, teacher support) without revealing which activity it opens.
const KEY_PREFIX = "nvk-";

/**
 * Crypto-secure random API key (`randomInt` is uniform — no modulo bias), the
 * same construction as `generateCode()` at a 36^40 keyspace: a key is a bearer
 * secret on a public endpoint, so it must be unguessable on its own.
 */
export function generateCodingKey(): string {
  let key = KEY_PREFIX;
  for (let i = 0; i < KEY_LENGTH; i++) {
    key += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
  }
  return key;
}
