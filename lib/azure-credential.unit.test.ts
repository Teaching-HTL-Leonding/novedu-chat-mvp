// @vitest-environment node
import type { TokenCredential } from "@azure/identity";
import { describe, expect, it } from "vitest";
import { buildMssqlConnectionConfig } from "@/lib/azure-credential";

// `buildMssqlConnectionConfig` is the ONE place that decides how the app
// authenticates against Azure SQL. It is effectively pure — parsing a string and
// shaping a node-mssql config — and the Azure credential it may build is lazy
// (no network until `getToken()`), so this whole matrix runs fast and SECRET-FREE.
//
// The contract we lock down:
//   * a connection string carrying SQL user + password ⇒ classic SQL login
//     (config left untouched, NO injected `token-credential`)
//   * any other string ⇒ passwordless Entra ID via a real `TokenCredential`.

const HOST = "Server=tcp:db.database.windows.net,1433;Initial Catalog=novedu;Encrypt=True";

/** Narrow the token-credential auth variant to read its credential back out. */
function tokenCredentialOf(authentication: unknown): TokenCredential {
  const auth = authentication as { type: string; options: { credential: TokenCredential } };
  expect(auth.type).toBe("token-credential");
  return auth.options.credential;
}

describe("buildMssqlConnectionConfig — SQL user/password auth", () => {
  it("keeps the parsed user/password and does NOT inject a token credential", () => {
    const config = buildMssqlConnectionConfig(`${HOST};User ID=alice;Password=s3cret`);

    expect(config.user).toBe("alice");
    expect(config.password).toBe("s3cret");
    // The absence here is the regression guard: tedious falls back to its
    // `default` (SQL) auth, so a user/password string is honoured as-is.
    expect(config.authentication).toBeUndefined();
  });

  it("recognises the UID/PWD aliases the same way", () => {
    const config = buildMssqlConnectionConfig(`${HOST};UID=bob;PWD=p2`);

    expect(config.user).toBe("bob");
    expect(config.password).toBe("p2");
    expect(config.authentication).toBeUndefined();
  });

  it("preserves the rest of the parsed connection config", () => {
    const config = buildMssqlConnectionConfig(`${HOST};User ID=alice;Password=s3cret`);

    expect(config.server).toBe("db.database.windows.net");
    expect(config.database).toBe("novedu");
    expect(config.options?.encrypt).toBe(true);
  });
});

describe("buildMssqlConnectionConfig — request timeout", () => {
  it("raises the default 15 s requestTimeout to 60 s (large writes on a small tier)", () => {
    const config = buildMssqlConnectionConfig(HOST);

    expect(config.requestTimeout).toBe(60_000);
  });

  it("does not override a Request Timeout the connection string already set", () => {
    const config = buildMssqlConnectionConfig(`${HOST};Request Timeout=30000`);

    expect(config.requestTimeout).toBe(30_000);
  });
});

describe("buildMssqlConnectionConfig — passwordless Entra ID", () => {
  it("attaches a real TokenCredential via tedious's token-credential auth", () => {
    const config = buildMssqlConnectionConfig(HOST);

    expect(config.user).toBeUndefined();
    expect(config.password).toBeUndefined();
    const credential = tokenCredentialOf(config.authentication);
    // It's the live credential chain, not a pre-fetched token string — proven by
    // the `getToken` method. We never call it, so no network / secrets are touched.
    expect(typeof credential.getToken).toBe("function");
  });

  it("falls back to Entra when only a username is present (both are required)", () => {
    const config = buildMssqlConnectionConfig(`${HOST};User ID=alice`);

    expect(config.user).toBe("alice");
    expect(config.password).toBeUndefined();
    tokenCredentialOf(config.authentication);
  });

  it("falls back to Entra when only a password is present", () => {
    const config = buildMssqlConnectionConfig(`${HOST};Password=s3cret`);

    expect(config.password).toBe("s3cret");
    expect(config.user).toBeUndefined();
    tokenCredentialOf(config.authentication);
  });
});
