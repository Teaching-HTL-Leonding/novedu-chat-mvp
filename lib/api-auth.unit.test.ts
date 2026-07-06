// @vitest-environment node
// jose's WebCrypto signing rejects jsdom-realm Uint8Arrays ("payload must be
// an instance of Uint8Array"), and this module is server-only anyway.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  ApiAuthError,
  requireBearerTeacher,
  requireBearerUser,
  resetApiAuthForTests,
} from "@/lib/api-auth";

// Validation stays REAL (like lib/thread-token.ts): we generate a keypair,
// point API_AUTH_JWKS_PATH at the matching local JWKS and mint genuine RS256
// JWTs carrying the configured issuer/audience — only the signing key differs
// from production.

const TENANT_ID = "11111111-2222-3333-4444-555555555555";
const CLIENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TEACHER_GROUP_ID = "99999999-8888-7777-6666-555555555555";
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const KID = "test-signing-key";

let privateKey: CryptoKey;
let strangerKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  // A second key that is NOT in the JWKS — for signature-rejection tests.
  strangerKey = (await generateKeyPair("RS256")).privateKey;

  const jwk = await exportJWK(pair.publicKey);
  const jwksPath = join(mkdtempSync(join(tmpdir(), "api-auth-test-")), "jwks.json");
  writeFileSync(jwksPath, JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: "RS256" }] }));

  vi.stubEnv("API_AUTH_JWKS_PATH", jwksPath);
  vi.stubEnv("AZURE_TENANT_ID", TENANT_ID);
  vi.stubEnv("AZURE_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("TEACHER_GROUP_ID", TEACHER_GROUP_ID);
  resetApiAuthForTests();
});

interface MintOptions {
  issuer?: string;
  audience?: string;
  expired?: boolean;
  key?: CryptoKey;
}

async function mint(
  claims: Record<string, unknown> = {},
  { issuer = ISSUER, audience = CLIENT_ID, expired = false, key }: MintOptions = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scp: "cli.access", oid: "user-oid-1", name: "Test User", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(expired ? now - 600 : now)
    .setExpirationTime(expired ? now - 300 : now + 300)
    .sign(key ?? privateKey);
}

function request(authorization?: string): Request {
  return new Request("http://localhost/api/me", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

async function expectRejection(promise: Promise<unknown>, status: 401 | 403): Promise<void> {
  const error = await promise.then(
    () => {
      throw new Error("expected the request to be rejected");
    },
    (e) => e,
  );
  expect(error).toBeInstanceOf(ApiAuthError);
  expect((error as ApiAuthError).status).toBe(status);
}

describe("requireBearerUser", () => {
  it("accepts a valid token and returns oid, name and non-teacher", async () => {
    const user = await requireBearerUser(request(`Bearer ${await mint()}`));
    expect(user).toEqual({ userId: "user-oid-1", name: "Test User", isTeacher: false });
  });

  it("derives isTeacher from the teacher group membership", async () => {
    const teacher = await requireBearerUser(
      request(`Bearer ${await mint({ groups: ["other-group", TEACHER_GROUP_ID] })}`),
    );
    expect(teacher.isTeacher).toBe(true);

    const student = await requireBearerUser(
      request(`Bearer ${await mint({ groups: ["other-group"] })}`),
    );
    expect(student.isTeacher).toBe(false);
  });

  it("fails closed (non-teacher) on a groups overage claim", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const token = await mint({
        groups: undefined,
        _claim_names: { groups: "src1" },
        _claim_sources: { src1: { endpoint: "https://graph.microsoft.com/..." } },
      });
      const user = await requireBearerUser(request(`Bearer ${token}`));
      expect(user.isTeacher).toBe(false);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it("returns name: null when the token lacks a name claim", async () => {
    const user = await requireBearerUser(request(`Bearer ${await mint({ name: undefined })}`));
    expect(user.name).toBeNull();
  });

  it("rejects a missing Authorization header with 401", async () => {
    await expectRejection(requireBearerUser(request()), 401);
  });

  it.each([
    ["a non-bearer scheme", "Basic dXNlcjpwdw=="],
    ["a bearer header without a token", "Bearer "],
    ["a garbage token", "Bearer not-a-jwt"],
  ])("rejects %s with 401", async (_label, header) => {
    await expectRejection(requireBearerUser(request(header)), 401);
  });

  it("rejects a token signed by a key outside the JWKS with 401", async () => {
    await expectRejection(
      requireBearerUser(request(`Bearer ${await mint({}, { key: strangerKey })}`)),
      401,
    );
  });

  it("rejects a wrong audience with 401", async () => {
    await expectRejection(
      requireBearerUser(request(`Bearer ${await mint({}, { audience: "some-other-app" })}`)),
      401,
    );
  });

  it("rejects a wrong issuer with 401", async () => {
    const issuer = "https://login.microsoftonline.com/other-tenant/v2.0";
    await expectRejection(requireBearerUser(request(`Bearer ${await mint({}, { issuer })}`)), 401);
  });

  it("rejects an expired token with 401", async () => {
    await expectRejection(
      requireBearerUser(request(`Bearer ${await mint({}, { expired: true })}`)),
      401,
    );
  });

  it("rejects a token without the cli.access scope with 401", async () => {
    await expectRejection(
      requireBearerUser(request(`Bearer ${await mint({ scp: "other.scope" })}`)),
      401,
    );
    await expectRejection(
      requireBearerUser(request(`Bearer ${await mint({ scp: undefined })}`)),
      401,
    );
  });

  it("accepts cli.access among multiple scopes", async () => {
    const user = await requireBearerUser(
      request(`Bearer ${await mint({ scp: "other.scope cli.access" })}`),
    );
    expect(user.userId).toBe("user-oid-1");
  });

  it("rejects a token without an oid with 401", async () => {
    await expectRejection(
      requireBearerUser(request(`Bearer ${await mint({ oid: undefined })}`)),
      401,
    );
    await expectRejection(requireBearerUser(request(`Bearer ${await mint({ oid: "" })}`)), 401);
  });
});

describe("requireBearerTeacher", () => {
  it("returns the user for a teacher token", async () => {
    const user = await requireBearerTeacher(
      request(`Bearer ${await mint({ groups: [TEACHER_GROUP_ID] })}`),
    );
    expect(user.isTeacher).toBe(true);
  });

  it("rejects a valid non-teacher token with 403", async () => {
    await expectRejection(requireBearerTeacher(request(`Bearer ${await mint()}`)), 403);
  });

  it("rejects an invalid token with 401 (not 403)", async () => {
    await expectRejection(requireBearerTeacher(request("Bearer not-a-jwt")), 401);
  });
});
