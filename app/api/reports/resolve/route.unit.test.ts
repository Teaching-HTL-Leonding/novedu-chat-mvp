// @vitest-environment node
// jose's WebCrypto signing rejects jsdom-realm Uint8Arrays, and this route is
// server-only anyway.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The bearer route for bulk-RESOLVING reports: the auth gate stays REAL (local
// JWKS, minted tokens) while the store is mocked. Pins the 401/403 matrix, the
// 400 on a malformed/empty ids body, the 503 mapping, the 200 success body, and
// that the token oid is passed through as the resolving teacher (resolved_by).

const mocks = vi.hoisted(() => ({ setReportsResolved: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/report-store", () => ({ setReportsResolved: mocks.setReportsResolved }));

import { resetApiAuthForTests } from "@/lib/api-auth";
import { POST } from "./route";

const TENANT_ID = "11111111-2222-3333-4444-555555555555";
const CLIENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TEACHER_GROUP_ID = "99999999-8888-7777-6666-555555555555";
const KID = "test-signing-key";

const ID_1 = "22222222-2222-2222-2222-222222222222";
const ID_2 = "33333333-3333-3333-3333-333333333333";

let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  const jwksPath = join(mkdtempSync(join(tmpdir(), "api-reports-resolve-test-")), "jwks.json");
  writeFileSync(jwksPath, JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: "RS256" }] }));

  vi.stubEnv("API_AUTH_JWKS_PATH", jwksPath);
  vi.stubEnv("AZURE_TENANT_ID", TENANT_ID);
  vi.stubEnv("AZURE_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("TEACHER_GROUP_ID", TEACHER_GROUP_ID);
  resetApiAuthForTests();
});

async function mint(teacher = true): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    scp: "cli.access",
    oid: "teacher-oid-1",
    name: "Test Teacher",
    groups: teacher ? [TEACHER_GROUP_ID] : [],
  })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(`https://login.microsoftonline.com/${TENANT_ID}/v2.0`)
    .setAudience(CLIENT_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

async function postRequest(body: unknown, token?: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/reports/resolve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setReportsResolved.mockResolvedValue(true);
});

describe("POST /api/reports/resolve auth", () => {
  it("401s without a token and 403s a non-teacher, never touching the store", async () => {
    expect((await postRequest({ ids: [ID_1] })).status).toBe(401);
    expect((await postRequest({ ids: [ID_1] }, await mint(false))).status).toBe(403);
    expect(mocks.setReportsResolved).not.toHaveBeenCalled();
  });
});

describe("POST /api/reports/resolve validation", () => {
  it("400s a non-JSON body", async () => {
    const res = await postRequest("{not json", await mint());
    expect(res.status).toBe(400);
    expect(mocks.setReportsResolved).not.toHaveBeenCalled();
  });

  it("400s an empty ids array", async () => {
    const res = await postRequest({ ids: [] }, await mint());
    expect(res.status).toBe(400);
    expect(mocks.setReportsResolved).not.toHaveBeenCalled();
  });

  it("400s a non-UUID entry in ids", async () => {
    const res = await postRequest({ ids: [ID_1, "nope"] }, await mint());
    expect(res.status).toBe(400);
    expect(mocks.setReportsResolved).not.toHaveBeenCalled();
  });

  it("400s a missing ids field", async () => {
    const res = await postRequest({}, await mint());
    expect(res.status).toBe(400);
    expect(mocks.setReportsResolved).not.toHaveBeenCalled();
  });
});

describe("POST /api/reports/resolve success + errors", () => {
  it("resolves all ids under the token oid and returns { ok: true }", async () => {
    const res = await postRequest({ ids: [ID_1, ID_2] }, await mint());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
    // resolved = true, teacherId = the token oid (resolved_by attribution).
    expect(mocks.setReportsResolved).toHaveBeenCalledWith([ID_1, ID_2], true, "teacher-oid-1");
  });

  it("503s when the store update fails", async () => {
    mocks.setReportsResolved.mockResolvedValue(false);
    const res = await postRequest({ ids: [ID_1] }, await mint());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ message: expect.stringMatching(/try again/i) });
  });
});
