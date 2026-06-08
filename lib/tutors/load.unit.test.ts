import { describe, expect, it } from "vitest";
import type { Fetcher } from "./fetcher";
import { loadAndBuildTutorPrompt } from "./load";
import {
  fixtureFetcher,
  fixtureResponse,
  GENERAL_URL,
  LINKED_URL,
  TUTOR_URL,
} from "./test-fixtures";

describe("loadAndBuildTutorPrompt — happy path", () => {
  it("builds the prompt from the real fixtures with no network", async () => {
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain("Knoten"); // German prose from a fragment
      expect(result.prompt).toContain("->"); // ASCII diagram, unescaped
    }
  });

  it("only fetches the tutor URL and its declared fragment files", async () => {
    const seen: string[] = [];
    const base = fixtureFetcher();
    const spy: Fetcher = (url) => {
      seen.push(url);
      return base(url);
    };
    await loadAndBuildTutorPrompt(TUTOR_URL, spy);
    expect(new Set(seen)).toEqual(new Set([TUTOR_URL, GENERAL_URL, LINKED_URL]));
  });
});

describe("loadAndBuildTutorPrompt — failures", () => {
  it("INVALID_URL for a non-http(s) URL (no fetch attempted)", async () => {
    const result = await loadAndBuildTutorPrompt("ftp://example.com/t.yaml", () => {
      throw new Error("should not fetch");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("INVALID_URL");
  });

  it("FETCH_FAILED when the tutor URL returns non-2xx", async () => {
    const overrides = new Map([[TUTOR_URL, fixtureResponse("", { ok: false, status: 404 })]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("FETCH_FAILED");
      expect(result.errors[0]?.status).toBe(404);
    }
  });

  it("FETCH_FAILED when the fetcher throws (network down)", async () => {
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, () =>
      Promise.reject(new Error("ECONNREFUSED")),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("FETCH_FAILED");
  });

  it("YAML_PARSE_ERROR for a malformed tutor body", async () => {
    const overrides = new Map([[TUTOR_URL, fixtureResponse("foo: [1, 2")]]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("YAML_PARSE_ERROR");
  });

  it("collects every failing fragment file (parallel, not short-circuited)", async () => {
    const overrides = new Map([
      [GENERAL_URL, fixtureResponse("", { ok: false, status: 500 })],
      [LINKED_URL, fixtureResponse("", { ok: false, status: 503 })],
    ]);
    const result = await loadAndBuildTutorPrompt(TUTOR_URL, fixtureFetcher(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const failedUrls = result.errors.filter((e) => e.code === "FETCH_FAILED").map((e) => e.url);
      expect(failedUrls).toContain(GENERAL_URL);
      expect(failedUrls).toContain(LINKED_URL);
    }
  });
});
