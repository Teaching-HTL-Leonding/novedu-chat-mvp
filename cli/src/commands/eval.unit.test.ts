// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken } from "../auth";
import { expandSources, registerEval, runEvalCommand } from "./eval";

// The eval command end to end in-process: the eval files and the quiz they target are
// REAL fixtures (so the grading prompts are the app's own), auth and fetch are mocked
// like in the reports/codes command tests. Covers the request body, the retry path,
// --json/--out, the exit codes, the LLM override rule, and batch mode incl. globbing.

vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  return { ...actual, getAccessToken: vi.fn() };
});

const evalsDir = fileURLToPath(
  new URL("../../../test-fixtures/activities/evals/", import.meta.url),
);
const okEval = join(evalsDir, "test-eval.yaml");
const mismatchEval = join(evalsDir, "mismatch-eval.yaml");
const brokenEval = join(evalsDir, "broken-eval.yaml");

const fetchMock = vi.fn();

function run(...args: string[]): Promise<Command> {
  const program = new Command();
  registerEval(program);
  return program.parseAsync(["eval", ...args], { from: "user" });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The fake grader: `correct` unless the answer carries a `[grade:…]` marker. */
function grader(): Response {
  const body = JSON.parse((fetchMock.mock.calls.at(-1) as [URL, RequestInit])[1].body as string);
  const marker = /\[grade:(correct|partial|incorrect)\]/.exec(String(body.answer));
  return jsonResponse({ result: marker?.[1] ?? "correct", feedback: "ok" });
}

let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;
let dir: string;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.mocked(getAccessToken).mockResolvedValue("token-123");
  fetchMock.mockImplementation(async () => grader());
  dir = mkdtempSync(join(tmpdir(), "novedu-eval-unit-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  log.mockRestore();
  error.mockRestore();
  stderr.mockRestore();
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe("eval — the request", () => {
  it("POSTs one grading call per golden answer with the quiz's llm and the real prompt", async () => {
    await run(okEval, "--server", "http://localhost:1234");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://localhost:1234/api/eval/grade");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-123");

    const body = JSON.parse(init.body as string);
    expect(body.llm).toEqual({ provider: "SCCH", model: "test-model" });
    // The system prompt is the app's own grading prompt for q1, not a copy.
    expect(body.system).toContain("The answer is 4.");
    expect(body.answer).toContain("two plus two");
    expect(process.exitCode).toBe(0);
  });

  it("announces the run's scope on stderr before the first call", async () => {
    await run(okEval, "--server", "http://x");

    const scope = stderr.mock.calls.map((call: unknown[]) => String(call[0])).join("");
    expect(scope).toContain("2 case(s) × 1 repeat(s) = 2 grading call(s)");
  });

  it("expands --repeats into observations of the same case", async () => {
    await run(okEval, "--repeats", "3", "--server", "http://x");

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(process.exitCode).toBe(0);
  });
});

describe("eval — failures and retries", () => {
  it("retries a 504 and succeeds on the next attempt", async () => {
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ message: "Gateway timeout" }, 504) : grader();
    });

    // Called through the core so the 5 s production backoff can be shrunk.
    await runEvalCommand([okEval], { server: "http://x" }, { retry: { baseDelayMs: 0 } });

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 failed + 1 retry + 1
    expect(process.exitCode).toBe(0);
  });

  it("exits 1 on a mismatch and lists it in the report", async () => {
    await run(mismatchEval, "--server", "http://x");

    expect(process.exitCode).toBe(1);
    const report = log.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(report).toContain("q1#1");
    expect(report).toContain("expected correct");
  });

  it("reports an unusable eval file as JSON on stderr, exit 1, without grading", async () => {
    await run(brokenEval, "--server", "http://x");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    const payload = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(payload.errors.length).toBeGreaterThan(0);
    expect(payload.errors[0].code).toBe("EVAL_SCHEMA");
  });
});

describe("eval — output", () => {
  it("prints the batch shape with --json, even for a single file", async () => {
    await run(okEval, "--json", "--server", "http://x");

    const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].status).toBe("ok");
    expect(payload.files[0].result.id).toBe("test-eval");
    expect(payload.totals).toMatchObject({ files: 1, cases: 2, passed: 2, failed: 0 });
  });

  it("writes the same JSON to --out", async () => {
    const out = join(dir, "report.json");

    await run(okEval, "--out", out, "--server", "http://x");

    const payload = JSON.parse(readFileSync(out, "utf8"));
    expect(payload.totals.cases).toBe(2);
  });

  it("carries the CI verdict as `passed`, per batch and per file", async () => {
    await run(okEval, "--json", "--server", "http://x");

    const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(payload.passed).toBe(true);
    expect(payload.files[0].passed).toBe(true);
  });

  it("writes the Markdown report to --report without touching stdout", async () => {
    const report = join(dir, "report.md");

    await run(okEval, "--json", "--report", report, "--server", "http://x");

    // stdout is still exactly the JSON payload.
    expect(() => JSON.parse(String(log.mock.calls[0]?.[0]))).not.toThrow();
    const md = readFileSync(report, "utf8");
    expect(md).toContain("# Eval report — ✅ passed");
    expect(md).toContain("test-eval");
  });

  it("reports an unwritable --report path as JSON on stderr", async () => {
    await run(okEval, "--report", join(dir, "missing-dir", "report.md"), "--server", "http://x");

    expect(process.exitCode).toBe(1);
    const payload = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(payload.message).toContain("Could not write");
  });
});

describe("eval — the LLM override", () => {
  it("rejects half a pair before any request", async () => {
    await run(okEval, "--llm-provider", "SCCH", "--server", "http://x");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("--llm-provider and --llm-model together");
  });

  it("rejects an unknown provider", async () => {
    await run(okEval, "--llm-provider", "OpenAI", "--llm-model", "gpt", "--server", "http://x");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("sends the override on every request and marks the run as overridden", async () => {
    await run(
      okEval,
      "--llm-provider",
      "Azure Foundry",
      "--llm-model",
      "gpt-5-mini",
      "--json",
      "--server",
      "http://x",
    );

    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse((call as [URL, RequestInit])[1].body as string);
      expect(body.llm).toEqual({ provider: "Azure Foundry", model: "gpt-5-mini" });
    }
    const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(payload.files[0].result.llm).toEqual({
      provider: "Azure Foundry",
      model: "gpt-5-mini",
      overrides: { provider: "SCCH", model: "test-model" },
    });
  });
});

describe("eval — batch mode", () => {
  it("evaluates several files, reporting per file plus grand totals", async () => {
    await run(okEval, mismatchEval, "--server", "http://x");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(process.exitCode).toBe(1);
    const report = log.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(report).toContain("Evaluated 2 file(s)");
    expect(report).toContain("test-eval.yaml");
    expect(report).toContain("TOTAL: 4 case(s), 3 passed, 1 failed");
  });

  it("keeps going when ONE file among several is invalid, and still exits 1", async () => {
    await run(okEval, brokenEval, "--json", "--server", "http://x");

    expect(fetchMock).toHaveBeenCalledTimes(2); // only the valid file was graded
    expect(process.exitCode).toBe(1);
    const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(payload.files.map((f: { status: string }) => f.status)).toEqual(["ok", "invalid"]);
    expect(payload.totals.invalid).toBe(1);
  });

  it("dedupes a repeated source with a warning", async () => {
    await run(okEval, okEval, "--server", "http://x");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const warnings = stderr.mock.calls.map((call: unknown[]) => String(call[0])).join("");
    expect(warnings).toContain("was given more than once");
  });
});

describe("expandSources", () => {
  it("passes URLs and plain paths through untouched", () => {
    const result = expandSources(["https://example.com/a.eval.yaml", okEval]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sources[0]).toBe("https://example.com/a.eval.yaml");
    expect(result.sources[1]).toMatch(/^file:\/\/.*test-eval\.yaml$/);
  });

  it("expands a glob deterministically", () => {
    const result = expandSources([join(evalsDir, "*.yaml")]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sources).toHaveLength(3);
    expect(result.sources.map((s) => s.split("/").pop())).toEqual([
      "broken-eval.yaml",
      "mismatch-eval.yaml",
      "test-eval.yaml",
    ]);
  });

  it("hard-fails a pattern that matches nothing", () => {
    const result = expandSources([join(evalsDir, "*.nope.yaml")]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("matched no files");
  });

  it("reports duplicates instead of evaluating them twice", () => {
    const result = expandSources([okEval, okEval]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sources).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });
});
