// @vitest-environment node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askJev, createJevClient, JEV_MODEL, JEV_TIMEOUT_MS } from "@/lib/llm/jev-client";

// The Jev seam: lazy construction, our own missing-key throw, and the wire shape
// the SDK actually produces (exercised against the REAL SDK through an injected
// `fetch`, so a future SDK bump that changes the URL or the auth header fails
// here). Plus the grep-guard that keeps `@typesafe-ai/sdk` behind this one file.
//
// Node realm: the SDK refuses to run in a browser-like environment without
// `dangerouslyAllowBrowser`, and the import guard walks the filesystem.

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** The canned `systemOne` response, exactly as the API shapes it. */
function jevResponse(): Response {
  return new Response(
    JSON.stringify({
      model: "typesafe/jev-1.13-20260917",
      answers: {
        verdict: {
          type: "choice",
          choice: "partial",
          confidence: 0.8,
          probabilities: { correct: 0.1, partial: 0.8, incorrect: 0.1 },
        },
      },
      usage: { input_tokens: 10, output_tokens: 0 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("createJevClient", () => {
  it("throws our own error before constructing anything when the key is missing", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    // Deliberately OUR message, not the SDK's: the SDK would otherwise fall back
    // to a stray TYPESAFE_API_KEY.
    vi.stubEnv("TYPESAFE_API_KEY", "sk-stray-typesafe");
    expect(() => createJevClient()).toThrow("OPENROUTER_API_KEY is not set");
  });

  it("points the SDK at the OpenRouter API root with the fixed Jev settings", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    vi.stubEnv("OPENROUTER_BASE_URL", "");
    const client = createJevClient();
    expect(client.baseURL).toBe("https://openrouter.ai/api");
    expect(client.defaultModel).toBe(JEV_MODEL);
    expect(client.timeout).toBe(JEV_TIMEOUT_MS);
    expect(client.retry.maxRetries).toBe(0);
    // `info`/`debug` would log request bodies — i.e. the student's answer.
    expect(client.logLevel).toBe("error");
  });
});

describe("module-level laziness", () => {
  it("imports without reading the key (a build or unit run has no .env)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.resetModules();
    await expect(import("@/lib/llm/jev-client")).resolves.toBeDefined();
  });

  it("constructs the client once and reuses it", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    const construct = vi.fn();
    vi.resetModules();
    vi.doMock("@typesafe-ai/sdk", () => ({
      TypeSafeClient: class {
        systemOne = vi.fn(async () => ({ answers: {} }));
        constructor(config: unknown) {
          construct(config);
        }
      },
    }));
    const { getJevClient } = await import("@/lib/llm/jev-client");
    const first = getJevClient();
    expect(getJevClient()).toBe(first);
    expect(construct).toHaveBeenCalledTimes(1);
    vi.doUnmock("@typesafe-ai/sdk");
  });
});

/** The one Choice question the pre-check asks, in miniature. */
const REQUEST = {
  state: { student_answer: "4" },
  questions: { verdict: { type: "choice" as const, criteria: { correct: null } } },
};

describe("askJev over the real SDK", () => {
  it("POSTs /v1/systemone with the OpenRouter bearer and the Jev model", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    vi.stubEnv("OPENROUTER_BASE_URL", "");
    const fetchMock = vi.fn(async () => jevResponse());
    const client = createJevClient({ fetch: fetchMock });
    const result = await client.systemOne(REQUEST);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // The SDK appends its own versioned path to the API ROOT.
    expect(url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-or-test");
    expect(JSON.parse(String(init.body)).model).toBe(JEV_MODEL);
    expect(result.answers.verdict).toMatchObject({ choice: "partial", confidence: 0.8 });
  });

  it("resolves askJev to the parsed answers through the lazy client", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    vi.stubEnv("OPENROUTER_BASE_URL", "");
    const fetchMock = vi.fn(async () => jevResponse());
    vi.stubGlobal("fetch", fetchMock);
    // Fresh module so the cached client is built against the stubbed globals.
    vi.resetModules();
    const { askJev: freshAskJev } = await import("@/lib/llm/jev-client");
    const { answers } = await freshAskJev(REQUEST);
    expect(answers.verdict).toMatchObject({ type: "choice", choice: "partial" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(typeof askJev).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Import guard: the SDK stays behind this one seam.

const REPO_ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["lib", "app", "cli", "components"];
const IGNORE = new Set(["node_modules", "dist", ".next", ".turbo"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry)) {
      yield full;
    }
  }
}

describe("@typesafe-ai/sdk isolation invariant", () => {
  it("is imported by exactly one file — lib/llm/jev-client.ts", () => {
    const pattern = /from\s+["']@typesafe-ai\/sdk["']|require\(["']@typesafe-ai\/sdk["']\)/;
    const importers: string[] = [];
    for (const dirName of SCAN_DIRS) {
      for (const file of walk(join(REPO_ROOT, dirName))) {
        const rel = relative(REPO_ROOT, file);
        // This test file mentions the specifier in its mocks; it is not an importer.
        if (rel === relative(REPO_ROOT, __filename)) continue;
        if (pattern.test(readFileSync(file, "utf8"))) importers.push(rel);
      }
    }
    expect(importers).toEqual([join("lib", "llm", "jev-client.ts")]);
  });
});
