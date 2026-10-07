import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixturesServer } from "../../test-fixtures/serve.mjs";

// `codes export` end to end through the REAL built CLI binary (`node dist/main.js`)
// against the fixtures server's fake `GET /api/codes/<code>/conversations` — fully
// offline, no sign-in (the CLI reads NOVEDU_TOKEN, see cli/src/auth.ts). Pins the
// JSONL stream on stdout (header + one line per conversation, nothing else), the
// cursor walk across pages, the --out file + JSON summary, and the failure path
// (JSON on stderr, exit 1, no file left behind).
//
// Run via `npm run test:cli` — it builds the CLI first, so `dist/main.js` exists.

const cli = fileURLToPath(new URL("../dist/main.js", import.meta.url));

let fixtures: Awaited<ReturnType<typeof startFixturesServer>> | undefined;
let dir: string;

beforeAll(async () => {
  fixtures = await startFixturesServer(0);
  dir = mkdtempSync(join(tmpdir(), "novedu-export-integration-"));
});

afterAll(async () => {
  const server = fixtures?.server as Server | undefined;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  fixtures?.exportRequests.splice(0);
});

function baseUrl(): string {
  if (!fixtures) throw new Error("fixtures server not started");
  return fixtures.baseUrl;
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<Run> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, NOVEDU_TOKEN: "integration-test-token" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
  });
}

function lines(jsonl: string): Array<Record<string, unknown>> {
  expect(jsonl.endsWith("\n")).toBe(true);
  return jsonl
    .slice(0, -1)
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

// The file and stdout runs differ only in the CLI clock's `exportedAt`.
function withoutClock(rows: Array<Record<string, unknown>>) {
  return rows.map(({ exportedAt: _exportedAt, ...rest }) => rest);
}

describe("novedu-cli codes export", () => {
  it("streams one header line plus one line per conversation on stdout, across pages", async () => {
    const run = await runCli(["codes", "export", "export1", "--server", baseUrl()]);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);

    const rows = lines(run.stdout);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      type: "export",
      format: "novedu-conversations/1",
      code: "export1",
      module: "tutor",
      note: "Vektoren",
      fileUrl: "https://example.test/vektoren.yaml",
      anonymous: true,
      exportedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    });
    expect(rows.slice(1).map((row) => [row.type, row.threadId])).toEqual([
      ["conversation", "thread-1"],
      ["conversation", "thread-2"],
    ]);
    expect(rows[2]?.messages).toHaveLength(3);

    // Full pages, and the cursor handed back verbatim on the second request.
    expect(fixtures?.exportRequests).toEqual([
      { code: "export1", limit: "50", after: null },
      { code: "export1", limit: "50", after: "p2" },
    ]);
  });

  it("--out writes the same JSONL to the file and prints the JSON summary on stdout", async () => {
    const stdoutRun = await runCli(["codes", "export", "export1", "--server", baseUrl()]);
    const file = join(dir, "export1.jsonl");
    const run = await runCli(["codes", "export", "export1", "--out", file, "--server", baseUrl()]);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      code: "export1",
      file,
      conversations: 2,
      messages: 5,
    });
    expect(withoutClock(lines(readFileSync(file, "utf8")))).toEqual(
      withoutClock(lines(stdoutRun.stdout)),
    );
  });

  it("fails with JSON on stderr, exit 1 and no file left behind for someone else's code", async () => {
    const file = join(dir, "export403.jsonl");
    const run = await runCli([
      "codes",
      "export",
      "export403",
      "--out",
      file,
      "--server",
      baseUrl(),
    ]);
    expect(run.code).toBe(1);
    expect(run.stdout).toBe("");
    expect(JSON.parse(run.stderr)).toEqual({
      message: "Only the code's creator can export its conversations.",
    });
    expect(existsSync(file)).toBe(false);
  });

  it("fails before any request when the --out path is not writable", async () => {
    const file = join(dir, "missing-dir", "out.jsonl");
    const run = await runCli(["codes", "export", "export1", "--out", file, "--server", baseUrl()]);
    expect(run.code).toBe(1);
    expect(JSON.parse(run.stderr).message).toContain("Could not write");
    expect(fixtures?.exportRequests).toEqual([]);
  });

  it("reports an unknown code with exit 1 and writes nothing on stdout", async () => {
    const run = await runCli(["codes", "export", "nope", "--server", baseUrl()]);
    expect(run.code).toBe(1);
    expect(run.stdout).toBe("");
    expect(JSON.parse(run.stderr)).toEqual({ message: "No code with that name." });
  });
});
