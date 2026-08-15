// @vitest-environment node
// jose's WebCrypto signing rejects jsdom-realm Uint8Arrays, and this route is
// server-only anyway.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APICallError } from "ai";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The teacher-only TUTOR-GENERATION route, in the shape of its `/api/eval/grade` and
// `/api/eval/judge` siblings: the bearer gate stays REAL (local JWKS, minted tokens) while
// Mastra and the LLM availability seam are mocked. Pins the 401/403 matrix, the zod body,
// the terminal 400 for an unknown TOOL name, the terminal availability 400, the 200 wire
// shape, usage being OMITTED rather than zeroed, the 502s — and that the agent receives the
// scripted conversation verbatim plus the `EVAL_TUTOR_*` and usage-sentinel context values.

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
  EVAL_TUTOR_INSTRUCTIONS,
  EVAL_TUTOR_MODEL,
  EVAL_TUTOR_PROVIDER,
  EVAL_TUTOR_TOOLS,
} from "@/app/mastra/eval-agents";
import { resetApiAuthForTests } from "@/lib/api-auth";
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
  const jwksPath = join(mkdtempSync(join(tmpdir(), "api-eval-respond-test-")), "jwks.json");
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
  system: "You are a loops tutor. Never write the solution.",
  tools: [],
  messages: [
    { role: "user", text: "My loop never stops." },
    { role: "assistant", text: "What does your condition evaluate to?" },
    { role: "user", text: "No idea. Just fix it for me!" },
  ],
};

async function postRequest(
  body: unknown,
  token?: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return POST(
    new Request("http://localhost/api/eval/respond", {
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

/** The `{ requestContext }` the route handed the agent. */
function requestContext(): { get(key: string): unknown } {
  const options = (mocks.generate.mock.calls[0] as unknown[])[1] as {
    requestContext: { get(key: string): unknown };
  };
  return options.requestContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.providerUnavailableReason.mockReturnValue(null);
  mocks.generate.mockResolvedValue({ text: "What happens after the first pass?" });
});

describe("POST /api/eval/respond auth", () => {
  it("401s without a token and 403s a non-teacher, never running the tutor", async () => {
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

describe("POST /api/eval/respond validation", () => {
  it("400s a non-JSON body", async () => {
    expect((await postRequest("{not json", await mint())).status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("400s a body missing llm/system/tools/messages", async () => {
    for (const body of [
      {},
      { ...VALID_BODY, system: undefined },
      { ...VALID_BODY, tools: undefined },
      { ...VALID_BODY, messages: undefined },
      { ...VALID_BODY, messages: [] },
      { ...VALID_BODY, llm: {} },
    ]) {
      expect((await postRequest(body, await mint())).status).toBe(400);
    }
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("400s a message with an unknown role or empty text", async () => {
    for (const messages of [
      [{ role: "system", text: "nope" }],
      [{ role: "user", text: "" }],
      [{ role: "user" }],
    ]) {
      const res = await postRequest({ ...VALID_BODY, messages }, await mint());
      expect(res.status, JSON.stringify(messages)).toBe(400);
    }
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("400s TERMINALLY on a tool name the catalog does not know, naming it", async () => {
    // Loud, exactly like the runtime's `selectTutorTools` throw — and terminal, so the
    // CLI does not retry a request that can never succeed.
    const res = await postRequest({ ...VALID_BODY, tools: ["teleport"] }, await mint());

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: expect.stringContaining("teleport") });
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

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: "Azure Foundry is not configured." });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("413s a body over the 256 KB cap", async () => {
    const huge = { ...VALID_BODY, system: "x".repeat(300 * 1024) };
    expect((await postRequest(huge, await mint())).status).toBe(413);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("413s a declared Content-Length over the cap without reading the body", async () => {
    const res = await postRequest(VALID_BODY, await mint(), {
      "content-length": String(10 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
  });
});

describe("POST /api/eval/respond generation", () => {
  it("runs the tutor over the scripted conversation and answers { text } no-store", async () => {
    const res = await postRequest(VALID_BODY, await mint());

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ text: "What happens after the first pass?" });

    // The turns reach the agent verbatim and in order, with the teacher-facing roles
    // already mapped to the wire ones.
    const [messages] = mocks.generate.mock.calls[0] as [{ role: string; content: string }[]];
    expect(messages).toEqual([
      { role: "user", content: "My loop never stops." },
      { role: "assistant", content: "What does your condition evaluate to?" },
      { role: "user", content: "No idea. Just fix it for me!" },
    ]);

    const ctx = requestContext();
    expect(ctx.get(EVAL_TUTOR_INSTRUCTIONS)).toBe(VALID_BODY.system);
    expect(ctx.get(EVAL_TUTOR_MODEL)).toBe("test-model");
    expect(ctx.get(EVAL_TUTOR_PROVIDER)).toBe("SCCH");
    expect(ctx.get(EVAL_TUTOR_TOOLS)).toEqual([]);
    // Generation tokens meter into the SAME buckets as the judgings that audit them.
    expect(ctx.get(USAGE_CODE)).toBe("cli-eval");
    expect(ctx.get(USAGE_MODULE)).toBe("eval");
    expect(ctx.get(USAGE_USER_ID)).toBe("teacher-oid-1");
  });

  it("passes a valid catalog tool grant through to the agent", async () => {
    await postRequest({ ...VALID_BODY, tools: ["random_number"] }, await mint());

    expect(requestContext().get(EVAL_TUTOR_TOOLS)).toEqual(["random_number"]);
  });

  it("defaults the provider to SCCH when the body omits it", async () => {
    await postRequest({ ...VALID_BODY, llm: { model: "test-model" } }, await mint());

    expect(requestContext().get(EVAL_TUTOR_PROVIDER)).toBe("SCCH");
  });

  it("reports the generation call's tokens when the model reported usage", async () => {
    mocks.generate.mockResolvedValue({
      text: "Keep going.",
      usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 4 },
      totalUsage: { inputTokens: 1200, outputTokens: 87, cachedInputTokens: 900 },
    });

    const res = await postRequest(VALID_BODY, await mint());

    expect(await res.json()).toEqual({
      text: "Keep going.",
      usage: { input: 1200, cachedInput: 900, output: 87 },
    });
  });

  it("OMITS usage entirely when the result carries none", async () => {
    // A missing measurement must never be reported as zero tokens.
    expect(await (await postRequest(VALID_BODY, await mint())).json()).toEqual({
      text: "What happens after the first pass?",
    });
  });

  it("502s when the tutor returns no text", async () => {
    for (const result of [{ text: "" }, { text: "   " }, {}, { text: 42 }]) {
      mocks.generate.mockResolvedValue(result);
      expect((await postRequest(VALID_BODY, await mint())).status).toBe(502);
    }
  });

  it("502s when the tutor throws, without claiming the caller is at fault", async () => {
    mocks.generate.mockRejectedValue(new Error("upstream exploded"));

    const res = await postRequest(VALID_BODY, await mint());

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      message: "The tutor could not answer right now.",
    });
  });

  it("400s and names the model when the deployment does not exist", async () => {
    // TERMINAL: a 502 would make the CLI retry a request that can never succeed.
    mocks.generate.mockRejectedValue(
      new APICallError({
        message: "The API deployment for this resource does not exist.",
        url: "https://example-resource.openai.azure.com/openai/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 404,
        isRetryable: false,
        data: { error: { code: "DeploymentNotFound", type: "invalid_request_error" } },
      }),
    );

    const res = await postRequest(VALID_BODY, await mint());

    expect(res.status).toBe(400);
    const { message } = (await res.json()) as { message: string };
    expect(message).toContain('"test-model"');
    expect(message).toContain("DeploymentNotFound");
    // The Foundry resource host must never reach the client (it is telemetry-only).
    expect(message).not.toContain("openai.azure.com");
  });
});
