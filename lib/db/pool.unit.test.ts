// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The one connection seam: what `DATABASE_URL` turns into, and above all WHICH
// auth mode the URL selects. A password in the URL means password auth (dev/CI);
// no password means an Entra token fetched per physical connection. The Azure
// credential is mocked, so this runs hermetically in CI — no `az login`, no DB.

const credential = vi.hoisted(() => {
  const getToken = vi.fn(async () => ({ token: "tok", expiresOnTimestamp: 0 }));
  const build = vi.fn(() => ({ getToken }));
  return { getToken, build };
});

vi.mock("@/lib/azure-credential", () => ({
  buildDataStoreCredential: credential.build,
}));

import { buildPoolConfig, databaseHost, getPool } from "@/lib/db/pool";

const PASSWORD_URL = "postgresql://postgres:Test-Passw0rd!@localhost:5432/novedu";
const ENTRA_URL =
  "postgresql://novedu-chat-mvp-at@db-pgnovedu.postgres.database.azure.com/novedu?sslmode=require";

beforeEach(() => {
  credential.build.mockClear();
  credential.getToken.mockClear();
});

describe("buildPoolConfig", () => {
  it("parses host, port, database and user", () => {
    const config = buildPoolConfig(PASSWORD_URL);
    expect(config.host).toBe("localhost");
    expect(config.port).toBe(5432);
    expect(config.database).toBe("novedu");
    expect(config.user).toBe("postgres");
  });

  it("defaults the port to 5432 when the URL omits it", () => {
    expect(buildPoolConfig(ENTRA_URL).port).toBe(5432);
  });

  it("applies the pool bounds and the UTC session pin", () => {
    const config = buildPoolConfig(PASSWORD_URL);
    expect(config.max).toBe(10);
    expect(config.idleTimeoutMillis).toBe(30_000);
    expect(config.statement_timeout).toBe(60_000);
    expect(config.options).toBe("-c TimeZone=UTC");
    expect(config.application_name).toBe("novedu");
  });

  it("never passes a connectionString (node-postgres would re-parse and override)", () => {
    expect(buildPoolConfig(ENTRA_URL)).not.toHaveProperty("connectionString");
  });

  it("uses the URL's password verbatim and builds no Azure credential", () => {
    const config = buildPoolConfig(PASSWORD_URL);
    expect(config.password).toBe("Test-Passw0rd!");
    expect(credential.build).not.toHaveBeenCalled();
  });

  it("uses an Entra token callback when the URL has no password", async () => {
    const config = buildPoolConfig(ENTRA_URL);
    expect(typeof config.password).toBe("function");
    expect(credential.build).toHaveBeenCalledTimes(1);

    const password = config.password as () => Promise<string>;
    await expect(password()).resolves.toBe("tok");
    expect(credential.getToken).toHaveBeenCalledWith(
      "https://ossrdbms-aad.database.windows.net/.default",
    );
    // The credential is built ONCE at config time and reused by the callback.
    await password();
    expect(credential.build).toHaveBeenCalledTimes(1);
  });

  it("decodes a percent-encoded UPN user (the local `az login` identity)", () => {
    const config = buildPoolConfig(
      "postgresql://rainer%40software-architects.at@db-pgnovedu.postgres.database.azure.com/novedu?sslmode=require",
    );
    expect(config.user).toBe("rainer@software-architects.at");
  });

  it("verifies TLS on sslmode=require and sslmode=verify-full", () => {
    expect(buildPoolConfig(ENTRA_URL).ssl).toEqual({ rejectUnauthorized: true });
    expect(buildPoolConfig(`${PASSWORD_URL}?sslmode=verify-full`).ssl).toEqual({
      rejectUnauthorized: true,
    });
  });

  it("leaves a local URL without sslmode on plain TCP", () => {
    expect(buildPoolConfig(PASSWORD_URL).ssl).toBeUndefined();
  });
});

describe("getPool", () => {
  it("fails with a clear message when DATABASE_URL is unset", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => getPool()).toThrow("DATABASE_URL is not set — database storage is unavailable");
    vi.unstubAllEnvs();
  });
});

describe("databaseHost", () => {
  it("returns the hostname", () => {
    expect(databaseHost(ENTRA_URL)).toBe("db-pgnovedu.postgres.database.azure.com");
    expect(databaseHost(PASSWORD_URL)).toBe("localhost");
  });

  it("returns null for an unset or unparseable URL", () => {
    expect(databaseHost(undefined)).toBeNull();
    expect(databaseHost("not a url")).toBeNull();
  });
});
