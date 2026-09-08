import { makeSignature } from "better-auth/crypto";

// better-auth's session-cookie format, shared by the auth setup (which mints the
// suite's real sessions) and the sign-in spec (which mints a cookie with NO
// session row behind it). The signature comes from better-auth's own
// `makeSignature`, so the value is byte-identical to what the server would have
// written — nothing here re-implements the format.
//
// Free of `next/headers` and of Playwright's `test()`, so the config and any
// spec may import it.

/** The cookie value a browser sends: `${token}.${signature}`, URL-encoded. */
export async function sessionCookieValue(token: string, secret: string): Promise<string> {
  return encodeURIComponent(`${token}.${await makeSignature(token, secret)}`);
}
