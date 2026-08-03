// @vitest-environment node
// jose's WebCrypto signing rejects jsdom-realm Uint8Arrays, and this route is
// server-only anyway.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The bearer image-list route: real auth gate (local-JWKS-minted tokens),
// mocked store + blob seam. Pins the 401/403 matrix, the /images page's filter
// parsing (mine default ON), the 503 mapping, and the wire shape (short-lived
// read-SAS url, null when minting fails for a row, createdAt = the active
// version's validFrom).

const mocks = vi.hoisted(() => ({
  listImages: vi.fn(),
  mintReadSas: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/image-store", () => ({ listImages: mocks.listImages }));
vi.mock("@/lib/image-blob", () => ({ mintReadSas: mocks.mintReadSas }));

import { resetApiAuthForTests } from "@/lib/api-auth";
import { GET } from "./route";

const TENANT_ID = "11111111-2222-3333-4444-555555555555";
const CLIENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TEACHER_GROUP_ID = "99999999-8888-7777-6666-555555555555";
const KID = "test-signing-key";

let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  const jwksPath = join(mkdtempSync(join(tmpdir(), "api-images-test-")), "jwks.json");
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
    new Request(`http://localhost/api/images${query}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listImages.mockResolvedValue([
    {
      id: "v1-id",
      name: "diagram",
      blobPath: "abc.png",
      mimeType: "image/png",
      byteSize: 1234,
      credit: "CC BY 4.0",
      validFrom: new Date("2026-07-07T08:00:00Z"),
      createdBy: "teacher-oid-1",
    },
  ]);
  mocks.mintReadSas.mockResolvedValue("https://blob.example/abc.png?sas=read");
});

describe("GET /api/images auth", () => {
  it("401s without a token, with WWW-Authenticate", async () => {
    const res = await getRequest();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(mocks.listImages).not.toHaveBeenCalled();
  });

  it("403s a valid non-teacher token", async () => {
    const res = await getRequest("", await mint(false));
    expect(res.status).toBe(403);
    expect(mocks.listImages).not.toHaveBeenCalled();
  });
});

describe("GET /api/images", () => {
  it("defaults to only the caller's images and returns the wire shape with a read-SAS url", async () => {
    const res = await getRequest("", await mint());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.listImages).toHaveBeenCalledWith({
      search: undefined,
      createdBy: "teacher-oid-1",
    });
    expect(mocks.mintReadSas).toHaveBeenCalledWith("abc.png");
    expect(await res.json()).toEqual([
      {
        name: "diagram",
        mimeType: "image/png",
        byteSize: 1234,
        credit: "CC BY 4.0",
        createdBy: "teacher-oid-1",
        createdAt: "2026-07-07T08:00:00.000Z",
        url: "https://blob.example/abc.png?sas=read",
      },
    ]);
  });

  it("widens to all teachers with mine=0 and passes q through trimmed", async () => {
    await getRequest("?mine=0&q=%20gram%20", await mint());
    expect(mocks.listImages).toHaveBeenCalledWith({ search: "gram", createdBy: undefined });
  });

  it("returns url null for a row whose SAS minting fails, keeping the rest", async () => {
    mocks.listImages.mockResolvedValue([
      {
        id: "v1",
        name: "bad",
        blobPath: "bad.png",
        mimeType: "image/png",
        byteSize: 1,
        credit: null,
        validFrom: new Date("2026-07-07T08:00:00Z"),
        createdBy: "teacher-oid-1",
      },
      {
        id: "v2",
        name: "good",
        blobPath: "good.png",
        mimeType: "image/jpeg",
        byteSize: 2,
        credit: null,
        validFrom: new Date("2026-07-07T09:00:00Z"),
        createdBy: "teacher-oid-1",
      },
    ]);
    mocks.mintReadSas.mockImplementation((blobPath: string) =>
      blobPath === "bad.png"
        ? Promise.reject(new Error("mint failed"))
        : Promise.resolve(`https://blob.example/${blobPath}?sas=read`),
    );
    const res = await getRequest("", await mint());
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.map((r: { name: string; url: string | null }) => r.url)).toEqual([
      null,
      "https://blob.example/good.png?sas=read",
    ]);
  });

  it("503s when the store is unreachable", async () => {
    mocks.listImages.mockResolvedValue(undefined);
    const res = await getRequest("", await mint());
    expect(res.status).toBe(503);
  });
});
