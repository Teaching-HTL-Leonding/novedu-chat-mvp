// @vitest-environment node
// jose's WebCrypto signing rejects jsdom-realm Uint8Arrays, and this route is
// server-only anyway.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The bearer routes for codes: the auth gate stays REAL (tokens minted against
// a local JWKS via API_AUTH_JWKS_PATH — the lib/api-auth.unit.test.ts
// strategy), while the service and store behind the handlers are mocked. Pins
// the 401/403 matrix, the /codes page's filter parsing (mine default ON), the
// naive-timestamp rejection, the failure-reason → status mapping, and the wire
// shape (share URL from the resolved origin, ISO timestamps).

const mocks = vi.hoisted(() => ({
  listCodes: vi.fn(),
  createCodeForUser: vi.fn(),
  resolveAppOriginOr: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/code-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/code-store")>();
  return { ...actual, listCodes: mocks.listCodes };
});
vi.mock("@/lib/code-service", () => ({ createCodeForUser: mocks.createCodeForUser }));
vi.mock("@/lib/app-origin", () => ({ resolveAppOriginOr: mocks.resolveAppOriginOr }));

import { resetApiAuthForTests } from "@/lib/api-auth";
import { unpagedResult } from "@/lib/db/paging";
import { GET, POST } from "./route";

const TENANT_ID = "11111111-2222-3333-4444-555555555555";
const CLIENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TEACHER_GROUP_ID = "99999999-8888-7777-6666-555555555555";
const KID = "test-signing-key";

let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  const jwksPath = join(mkdtempSync(join(tmpdir(), "api-codes-test-")), "jwks.json");
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

async function getRequest(query = "", token?: string): Promise<Response> {
  return GET(
    new Request(`http://localhost/api/codes${query}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    }),
  );
}

async function postRequest(body: unknown, token?: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/codes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const ENTRY = {
  code: "abc123def4",
  module: "tutor" as const,
  createdBy: "teacher-oid-1",
  fileUrl: "https://example.com/tutor.yaml",
  validFrom: new Date("2026-07-07T08:00:00Z"),
  validUntil: null,
  note: "My class",
  origin: "http://localhost:3000",
  anonymous: true,
  llm: null,
  createdAt: new Date("2026-07-07T07:59:12Z"),
};

const WIRE_ENTRY = {
  code: "abc123def4",
  url: "https://app.example/abc123def4",
  module: "tutor",
  note: "My class",
  fileUrl: "https://example.com/tutor.yaml",
  anonymous: true,
  validFrom: "2026-07-07T08:00:00.000Z",
  validUntil: null,
  llm: null,
  createdBy: "teacher-oid-1",
  createdAt: "2026-07-07T07:59:12.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listCodes.mockResolvedValue(unpagedResult([ENTRY]));
  mocks.createCodeForUser.mockResolvedValue({
    ok: true,
    entry: ENTRY,
    shareUrl: "https://app.example/abc123def4",
  });
  mocks.resolveAppOriginOr.mockResolvedValue("https://app.example");
});

describe("GET /api/codes auth", () => {
  it("401s without a token, with WWW-Authenticate and the uniform { message } body", async () => {
    const res = await getRequest();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    // The generic auth failure uses the SAME { message } key as every other
    // failure on the bearer channel — no second key for scripts to probe.
    expect(await res.json()).toEqual({ message: "Unauthorized" });
    expect(mocks.listCodes).not.toHaveBeenCalled();
  });

  it("401s a garbage token", async () => {
    const res = await getRequest("", "not-a-jwt");
    expect(res.status).toBe(401);
  });

  it("403s a valid non-teacher token", async () => {
    const res = await getRequest("", await mint(false));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "Forbidden" });
    expect(mocks.listCodes).not.toHaveBeenCalled();
  });
});

describe("GET /api/codes", () => {
  it("defaults to only the caller's codes and returns the wire shape", async () => {
    const res = await getRequest("", await mint());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.listCodes).toHaveBeenCalledWith({
      search: undefined,
      createdBy: "teacher-oid-1",
      module: undefined,
    });
    expect(await res.json()).toEqual([WIRE_ENTRY]);
  });

  it("widens to all teachers with mine=0 and passes q + module through", async () => {
    await getRequest("?mine=0&q=%20bio%20&module=quiz", await mint());
    expect(mocks.listCodes).toHaveBeenCalledWith({
      search: "bio",
      createdBy: undefined,
      module: "quiz",
    });
  });

  it("ignores an unknown module filter", async () => {
    await getRequest("?module=nonsense", await mint());
    expect(mocks.listCodes).toHaveBeenCalledWith(expect.objectContaining({ module: undefined }));
  });

  it("503s when the store is unreachable", async () => {
    mocks.listCodes.mockResolvedValue(undefined);
    const res = await getRequest("", await mint());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ message: expect.stringMatching(/try again/i) });
  });
});

describe("POST /api/codes", () => {
  const BODY = { module: "tutor", fileUrl: "https://example.com/tutor.yaml" };

  it("401s without a token and 403s a non-teacher", async () => {
    expect((await postRequest(BODY)).status).toBe(401);
    expect((await postRequest(BODY, await mint(false))).status).toBe(403);
    expect(mocks.createCodeForUser).not.toHaveBeenCalled();
  });

  it("201s with the stored code's wire shape on success", async () => {
    const res = await postRequest(
      { ...BODY, validFrom: "2026-07-07T08:00:00Z", note: "My class" },
      await mint(),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(WIRE_ENTRY);
    // The ISO bound reaches the pipeline as the unix-seconds string
    // validateCodeRequest expects.
    expect(mocks.createCodeForUser).toHaveBeenCalledWith("teacher-oid-1", {
      module: "tutor",
      file: "https://example.com/tutor.yaml",
      start: String(Date.parse("2026-07-07T08:00:00Z") / 1000),
      end: "",
      note: "My class",
      llmProvider: "",
      llmModel: "",
      llmReasoning: "",
    });
  });

  it("converts an explicit non-UTC offset correctly", async () => {
    await postRequest({ ...BODY, validUntil: "2026-07-07T10:00:00+02:00" }, await mint());
    expect(mocks.createCodeForUser).toHaveBeenCalledWith(
      "teacher-oid-1",
      expect.objectContaining({ end: String(Date.parse("2026-07-07T08:00:00Z") / 1000) }),
    );
  });

  it("passes the llm override pair through", async () => {
    await postRequest({ ...BODY, llm: { provider: "SCCH", model: "m1" } }, await mint());
    expect(mocks.createCodeForUser).toHaveBeenCalledWith(
      "teacher-oid-1",
      expect.objectContaining({ llmProvider: "SCCH", llmModel: "m1", llmReasoning: "" }),
    );
  });

  it("passes the override's optional reasoning level through", async () => {
    await postRequest(
      { ...BODY, llm: { provider: "SCCH", model: "m1", reasoning: "high" } },
      await mint(),
    );
    expect(mocks.createCodeForUser).toHaveBeenCalledWith(
      "teacher-oid-1",
      expect.objectContaining({ llmProvider: "SCCH", llmModel: "m1", llmReasoning: "high" }),
    );
  });

  it("400s a NAIVE timestamp (no offset) without touching the pipeline", async () => {
    const res = await postRequest({ ...BODY, validFrom: "2026-07-07T08:00:00" }, await mint());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      message: expect.stringMatching(/validFrom.*explicit offset/i),
    });
    expect(mocks.createCodeForUser).not.toHaveBeenCalled();
  });

  it("400s a non-JSON body", async () => {
    const res = await postRequest("{not json", await mint());
    expect(res.status).toBe(400);
    expect(mocks.createCodeForUser).not.toHaveBeenCalled();
  });

  it("maps service failures: invalid → 400 message, validation → 400 errors, unavailable → 503", async () => {
    mocks.createCodeForUser.mockResolvedValue({
      ok: false,
      reason: "invalid",
      message: "bad request",
    });
    let res = await postRequest(BODY, await mint());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "bad request" });

    mocks.createCodeForUser.mockResolvedValue({
      ok: false,
      reason: "validation",
      errors: [{ code: "TUTOR_SCHEMA_ERROR", message: "bad" }],
    });
    res = await postRequest(BODY, await mint());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: [{ code: "TUTOR_SCHEMA_ERROR", message: "bad" }] });

    mocks.createCodeForUser.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "down",
    });
    res = await postRequest(BODY, await mint());
    expect(res.status).toBe(503);
  });
});
