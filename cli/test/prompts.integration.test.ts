import { spawn } from "node:child_process";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixturesServer } from "../../test-fixtures/serve.mjs";

// Integration tests that invoke the REAL built CLI binary the way a user (or an eval
// harness) would (`node dist/main.js prompts …`), asserting stdout + exit code. The
// local-file cases read the synthetic fixtures under `test-fixtures/activities/`; the
// served-URL case fetches one from a local fixtures server (no network, no LLM, no DB).
// Excluded from CI because it needs the built binary (see cli/vitest.config.mts).
//
// Run via `npm run test:cli` — it builds the CLI first, so `dist/main.js` exists.

const cli = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const activitiesDir = fileURLToPath(new URL("../../test-fixtures/activities/", import.meta.url));

let fixtures: { server: Server; baseUrl: string } | undefined;
beforeAll(async () => {
  fixtures = await startFixturesServer(0);
});
afterAll(async () => {
  const server = fixtures?.server;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

function fixturesBaseUrl(): string {
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
    const child = spawn(process.execPath, [cli, ...args], { env: process.env });
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

describe("novedu-cli prompts — local files", () => {
  it("prints a human summary for a tutor", async () => {
    const { code, stdout } = await runCli(["prompts", `${activitiesDir}tutors/test-tutor.yaml`]);

    expect(code).toBe(0);
    expect(stdout).toContain("Prompts — tutor");
    expect(stdout).toContain("id: test-tutor");
    expect(stdout).toMatch(/system: \d+ chars/);
  });

  it("emits the full dump as JSON for a quiz", async () => {
    const { code, stdout } = await runCli([
      "prompts",
      `${activitiesDir}quizzes/test-quiz.yaml`,
      "--kind",
      "quiz",
      "--json",
    ]);

    expect(code).toBe(0);
    const dump = JSON.parse(stdout);
    expect(dump.kind).toBe("quiz");
    expect(dump.id).toBe("test-quiz");
    expect(dump.llm).toEqual({ provider: "SCCH", model: "test-model" });
    expect(dump.grading.questions).toHaveLength(1);
    expect(dump.grading.questions[0].system).toContain("You are grading");
    expect(dump.discussion.system).toContain("You are helping a student understand");
  });

  it("dumps the writing coach and the coding activity's injected prompt", async () => {
    const writing = await runCli([
      "prompts",
      `${activitiesDir}writings/test-writing.yaml`,
      "--kind",
      "writing",
      "--json",
    ]);
    expect(writing.code).toBe(0);
    expect(JSON.parse(writing.stdout).system).toContain("writing coach");

    const coding = await runCli([
      "prompts",
      `${activitiesDir}coding/test-coding.yaml`,
      "--kind",
      "coding",
      "--json",
    ]);
    expect(coding.code).toBe(0);
    const dump = JSON.parse(coding.stdout);
    expect(dump.upstreamSystemMessage).toBe(dump.system);
  });

  it("exits 1 with JSON errors on stderr for a broken activity", async () => {
    const { code, stderr } = await runCli([
      "prompts",
      `${activitiesDir}quizzes/broken-quiz.yaml`,
      "--kind",
      "quiz",
    ]);

    expect(code).toBe(1);
    expect(JSON.parse(stderr).errors.length).toBeGreaterThan(0);
  });

  it("rejects an invalid --kind (fragment libraries produce no prompts)", async () => {
    const { code, stderr } = await runCli([
      "prompts",
      `${activitiesDir}tutors/test-fragments-a.yaml`,
      "--kind",
      "fragment",
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain("Invalid --kind");
  });
});

describe("novedu-cli prompts — served URLs", () => {
  it("dumps a fixture quiz fetched over HTTP", async () => {
    const { code, stdout } = await runCli([
      "prompts",
      `${fixturesBaseUrl()}/quizzes/test-quiz.yaml`,
      "--kind",
      "quiz",
      "--json",
    ]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).grading.questions[0].id).toBe("q1");
  });
});
