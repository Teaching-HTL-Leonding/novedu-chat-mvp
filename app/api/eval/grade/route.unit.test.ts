// @vitest-environment node
// jose's WebCrypto signing rejects jsdom-realm Uint8Arrays, and this route is
// server-only anyway.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The teacher-only grader-eval route: the bearer gate stays REAL (local JWKS, minted
// tokens) while Mastra is mocked like in `lib/quiz-actions.unit.test.ts`. Pins the
// 401/403 matrix, the 400 matrix (bad body, unknown provider, unavailable provider,
// empty-after-trim answer), the 413 cap, the 200 wire shape + no-store, the 502 on a
// grader throw — and, crucially, that the agent receives `buildAnswerMessage` of the
// TRIMMED answer plus the QUIZ_EVAL_* / usage RequestContext values (production parity
// with `submitAnswer`).

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  providerUnavailableReason: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/app/mastra", () => ({
  mastra: { getAgent: () => ({ generate: mocks.generate }) },
}));
vi.mock("@/lib/llm/availability", () => ({
  providerUnavailableReason: mocks.providerUnavailableReason,
}));
vi.mock("@mastra/core/request-context", () => ({
  RequestContext: class {
    private m = new Map<string, unknown>();
    set(key: string, value: unknown) {
      this.m.set(key, value);
    }
    get(key: string) {
      return this.m.get(key);
    }
  },
}));

import {
  QUIZ_EVAL_INSTRUCTIONS,
  QUIZ_EVAL_MODEL,
  QUIZ_EVAL_PROVIDER,
} from "@/app/mastra/quiz-agents";
import { resetApiAuthForTests } from "@/lib/api-auth";
import { buildAnswerMessage } from "@/lib/quiz-grading-prompt";
import { USAGE_CODE, USAGE_MODULE, USAGE_USER_ID } from "@/lib/usage-context-keys";
import { POST } from "./route";

const TENANT_ID = "11111111-2222-3333-4444-555555555555";
const CLIENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TEACHER_GROUP_ID = "99999999-8888-7777-6666-555555555555";
const KID = "test-signing-key";

let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  const jwksPath = join(mkdtempSync(join(tmpdir(), "api-eval-grade-test-")), "jwks.json");
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

const VALID_BODY = {
  llm: { provider: "SCCH", model: "test-model" },
  system: "You are grading question q1.",
  answer: "4\n",
};

async function postRequest(
  body: unknown,
  token?: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return POST(
    new Request("http://localhost/api/eval/grade", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.providerUnavailableReason.mockReturnValue(null);
  mocks.generate.mockResolvedValue({ object: { result: "correct", feedback: "Well done." } });
});

describe("POST /api/eval/grade auth", () => {
  it("401s without a token and 403s a non-teacher, never running the grader", async () => {
    expect((await postRequest(VALID_BODY)).status).toBe(401);
    expect((await postRequest(VALID_BODY, await mint(false))).status).toBe(403);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("sends WWW-Authenticate with the generic body", async () => {
    const res = await postRequest(VALID_BODY);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(await res.json()).toMatchObject({ message: expect.any(String) });
  });
});

describe("POST /api/eval/grade validation", () => {
  it("400s a non-JSON body", async () => {
    expect((await postRequest("{not json", await mint())).status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("400s a body missing system/answer/llm", async () => {
    expect((await postRequest({}, await mint())).status).toBe(400);
    expect((await postRequest({ llm: { model: "m" }, system: "s" }, await mint())).status).toBe(
      400,
    );
    expect((await postRequest({ llm: {}, system: "s", answer: "a" }, await mint())).status).toBe(
      400,
    );
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("400s an unknown provider rather than silently defaulting to SCCH", async () => {
    const res = await postRequest(
      { ...VALID_BODY, llm: { provider: "OpenAI", model: "m" } },
      await mint(),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: expect.stringContaining("OpenAI") });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("400s TERMINALLY when the provider is not configured on this server", async () => {
    mocks.providerUnavailableReason.mockReturnValue("Azure Foundry is not configured.");

    const res = await postRequest(
      { ...VALID_BODY, llm: { provider: "Azure Foundry", model: "gpt" } },
      await mint(),
    );

    // A 502 here would burn the CLI's whole retry budget on every single case.
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: "Azure Foundry is not configured." });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("400s an answer that is empty after trimming", async () => {
    const res = await postRequest({ ...VALID_BODY, answer: "   \n  " }, await mint());
    expect(res.status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("413s a body over the 256 KB cap", async () => {
    const huge = { ...VALID_BODY, answer: "x".repeat(300 * 1024) };
    const res = await postRequest(huge, await mint());
    expect(res.status).toBe(413);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("413s a declared Content-Length over the cap without reading the body", async () => {
    const res = await postRequest(VALID_BODY, await mint(), {
      "content-length": String(10 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
  });
});

describe("POST /api/eval/grade grading", () => {
  it("runs the production grading path and answers { result, feedback } no-store", async () => {
    const res = await postRequest(VALID_BODY, await mint());

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ result: "correct", feedback: "Well done." });

    // The TRIMMED answer, wrapped by the shared production builder (parity with
    // submitAnswer — a golden answer's YAML block scalar always ends in a newline).
    const [prompt, opts] = mocks.generate.mock.calls[0] as [
      string,
      { requestContext: { get(key: string): unknown } },
    ];
    expect(prompt).toBe(buildAnswerMessage("4"));

    const ctx = opts.requestContext;
    expect(ctx.get(QUIZ_EVAL_INSTRUCTIONS)).toBe(VALID_BODY.system);
    expect(ctx.get(QUIZ_EVAL_MODEL)).toBe("test-model");
    expect(ctx.get(QUIZ_EVAL_PROVIDER)).toBe("SCCH");
    expect(ctx.get(USAGE_CODE)).toBe("cli-eval");
    expect(ctx.get(USAGE_MODULE)).toBe("eval");
    expect(ctx.get(USAGE_USER_ID)).toBe("teacher-oid-1");
  });

  it("defaults the provider to SCCH when the body omits it", async () => {
    await postRequest({ ...VALID_BODY, llm: { model: "test-model" } }, await mint());

    const [, opts] = mocks.generate.mock.calls[0] as [
      string,
      { requestContext: { get(key: string): unknown } },
    ];
    expect(opts.requestContext.get(QUIZ_EVAL_PROVIDER)).toBe("SCCH");
  });

  it("reports the grading call's tokens when the model reported usage", async () => {
    // Mastra's `FullOutput`: `totalUsage` across all steps, AI-SDK v5 field names
    // (`@mastra/core/dist/stream/base/output.d.ts` → `LanguageModelUsage`).
    mocks.generate.mockResolvedValue({
      object: { result: "partial", feedback: "Half." },
      usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 4 },
      totalUsage: { inputTokens: 1200, outputTokens: 87, cachedInputTokens: 900 },
    });

    const res = await postRequest(VALID_BODY, await mint());

    expect(await res.json()).toEqual({
      result: "partial",
      feedback: "Half.",
      // `input` is the TOTAL input (cached included); `cachedInput` its cache-read part.
      usage: { input: 1200, cachedInput: 900, output: 87 },
    });
  });

  it("falls back to the last step's usage when there is no total", async () => {
    mocks.generate.mockResolvedValue({
      object: { result: "correct", feedback: "Yes." },
      usage: { inputTokens: 30, outputTokens: 5 },
    });

    const res = await postRequest(VALID_BODY, await mint());

    // No cache reporting from this provider ⇒ 0, not a missing field.
    expect(await res.json()).toMatchObject({ usage: { input: 30, cachedInput: 0, output: 5 } });
  });

  it("OMITS usage entirely when the result carries none", async () => {
    const res = await postRequest(VALID_BODY, await mint());

    // The default mock has no usage at all — a missing measurement must never be
    // reported as zero tokens.
    expect(await res.json()).toEqual({ result: "correct", feedback: "Well done." });
  });

  it("502s when the grader throws", async () => {
    mocks.generate.mockRejectedValue(new Error("upstream exploded"));
    const res = await postRequest(VALID_BODY, await mint());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ message: expect.any(String) });
  });

  it("502s when the grader returns no structured object", async () => {
    mocks.generate.mockResolvedValue({ object: undefined });
    const res = await postRequest(VALID_BODY, await mint());
    expect(res.status).toBe(502);
  });
});
