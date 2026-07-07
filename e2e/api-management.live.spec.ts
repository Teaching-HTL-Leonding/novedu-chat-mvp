import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { importJWK, SignJWT } from "jose";
import { API_AUTH_KID, API_AUTH_PRIVATE_JWK_PATH } from "./api-auth.constants";
import { deleteCode, hardDeleteFile, VALID_TUTOR_URL } from "./code.utils";

// @live-db lifecycle of the CLI/API management channel over real HTTP against
// the real database: PUT an app-hosted file (create → update → kind-mismatch),
// list it via GET /api/files, mint a code via POST /api/codes (the full
// validation pipeline against the fixtures tutor), list it via GET /api/codes.
// The teacher token is minted like in api-me.spec.ts (real env
// issuer/audience, e2e signing key); rows are uniquely named and cleaned up
// directly in the DB afterwards.

test.use({ storageState: { cookies: [], origins: [] } });
// Dev compilation of the routes + fixture fetch + DB round-trips.
test.setTimeout(120_000);

const RUN_ID = Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz"[randomInt(26)]).join(
  "",
);
const FILE_NAME = `e2e-api-file-${RUN_ID}`;
const CODE_NOTE = `e2e-api-code-${RUN_ID}`;

const FRAGMENT_V1 = `id: e2e_api_fragments
fragments:
  - id: greeting
    version: 1
    priority: 1
    content: "Hello from the API, version one"
`;
const FRAGMENT_V2 = `id: e2e_api_fragments
fragments:
  - id: greeting
    version: 2
    priority: 1
    content: "Hello from the API, version two"
`;

async function mintTeacher(): Promise<string> {
  loadEnvConfig(process.cwd());
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const teacherGroup = process.env.TEACHER_GROUP_ID;
  if (!tenantId || !clientId || !teacherGroup) {
    throw new Error("AZURE_TENANT_ID / AZURE_CLIENT_ID / TEACHER_GROUP_ID missing in env");
  }

  const privateJwk = JSON.parse(await readFile(API_AUTH_PRIVATE_JWK_PATH, "utf8"));
  const key = await importJWK(privateJwk, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    scp: "cli.access",
    oid: "e2e-api-oid",
    name: "E2E Api Teacher",
    groups: [teacherGroup],
  })
    .setProtectedHeader({ alg: "RS256", kid: API_AUTH_KID })
    .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .sign(key);
}

test.afterAll(async () => {
  await hardDeleteFile(FILE_NAME);
});

test("file upsert → file list → code create → code list, over real HTTP", {
  tag: ["@live", "@live-db"],
}, async ({ request }) => {
  const headers = { authorization: `Bearer ${await mintTeacher()}` };
  let mintedCode: string | undefined;

  try {
    // CREATE: the name is free, so the upsert needs the kind.
    const missingKind = await request.put(`/api/files/${FILE_NAME}`, {
      headers,
      data: { content: FRAGMENT_V1 },
    });
    expect(missingKind.status()).toBe(400);
    expect((await missingKind.json()).message).toContain("kind");

    const created = await request.put(`/api/files/${FILE_NAME}`, {
      headers,
      data: { kind: "fragment", content: FRAGMENT_V1 },
    });
    expect(created.status()).toBe(200);
    const createdBody = await created.json();
    expect(createdBody).toMatchObject({ name: FILE_NAME, kind: "fragment", action: "created" });
    expect(createdBody.url).toContain(`/api/files/${FILE_NAME}`);

    // The public GET serves what was uploaded.
    expect(await (await request.get(`/api/files/${FILE_NAME}`)).text()).toBe(FRAGMENT_V1);

    // UPDATE: same PUT, no kind needed; a WRONG kind fails loudly instead.
    const mismatch = await request.put(`/api/files/${FILE_NAME}`, {
      headers,
      data: { kind: "quiz", content: FRAGMENT_V2 },
    });
    expect(mismatch.status()).toBe(409);
    expect((await mismatch.json()).message).toContain("fragment");

    const updated = await request.put(`/api/files/${FILE_NAME}`, {
      headers,
      data: { content: FRAGMENT_V2 },
    });
    expect(updated.status()).toBe(200);
    expect(await updated.json()).toMatchObject({ action: "updated", kind: "fragment" });
    expect(await (await request.get(`/api/files/${FILE_NAME}`)).text()).toBe(FRAGMENT_V2);

    // LIST files: the default (mine=on) list of the uploading teacher finds it.
    const files = await request.get(`/api/files?q=${FILE_NAME}`, { headers });
    expect(files.status()).toBe(200);
    const fileList = await files.json();
    expect(fileList).toHaveLength(1);
    expect(fileList[0]).toMatchObject({
      name: FILE_NAME,
      kind: "fragment",
      createdBy: "e2e-api-oid",
    });

    // CREATE a code: the full pipeline (window conversion, tutor validation
    // against the fixtures server, storing, read-back).
    const start = new Date(Date.now() - 60_000).toISOString();
    const createCode = await request.post("/api/codes", {
      headers,
      data: {
        module: "tutor",
        fileUrl: VALID_TUTOR_URL,
        validFrom: start,
        note: CODE_NOTE,
      },
    });
    expect(createCode.status()).toBe(201);
    const codeBody = await createCode.json();
    mintedCode = codeBody.code;
    expect(codeBody).toMatchObject({
      module: "tutor",
      note: CODE_NOTE,
      fileUrl: VALID_TUTOR_URL,
      createdBy: "e2e-api-oid",
      validUntil: null,
    });
    expect(codeBody.url).toContain(`/${codeBody.code}`);
    expect(new Date(codeBody.validFrom).getTime()).toBe(new Date(start).getTime());

    // A naive timestamp is rejected, not silently interpreted.
    const naive = await request.post("/api/codes", {
      headers,
      data: { module: "tutor", fileUrl: VALID_TUTOR_URL, validFrom: "2026-07-07T08:00:00" },
    });
    expect(naive.status()).toBe(400);

    // LIST codes: the default (mine=on) list finds the minted code.
    const codes = await request.get(`/api/codes?q=${CODE_NOTE}`, { headers });
    expect(codes.status()).toBe(200);
    const codeList = await codes.json();
    expect(codeList).toHaveLength(1);
    expect(codeList[0]).toMatchObject({ code: mintedCode, note: CODE_NOTE });
  } finally {
    if (mintedCode) await deleteCode(mintedCode);
  }
});
