import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Integration tests that invoke the REAL built CLI binary the way a user would
// (`node dist/main.js …`), asserting stdout + exit code. Local-file cases need no
// network; the public-URL cases fetch tutor YAMLs from the GitHub repo, which is
// why this whole file is excluded from CI (see cli/vitest.config.mts).
//
// Run via `npm run test:cli` — it builds the CLI first, so `dist/main.js` exists.

const cli = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const tutorsDir = fileURLToPath(new URL("../../activities/tutors/", import.meta.url));
const quizzesDir = fileURLToPath(new URL("../../activities/quizzes/", import.meta.url));
const writingsDir = fileURLToPath(new URL("../../activities/writings/", import.meta.url));
const codingDir = fileURLToPath(new URL("../../activities/coding/", import.meta.url));

const RAW_BASE =
  "https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/tutors";

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

describe("novedu-cli validate — local files", () => {
  it("exits 0 for a valid tutor", async () => {
    const { code, stdout } = await runCli(["validate", `${tutorsDir}simple-tutor.yaml`]);

    expect(code).toBe(0);
    expect(stdout).toContain("Valid tutor");
  });

  it("exits 1 for a broken tutor", async () => {
    const { code, stdout } = await runCli(["validate", `${tutorsDir}broken-tutor.yaml`]);

    expect(code).toBe(1);
    expect(stdout).toContain("Invalid tutor");
  });

  it("emits raw JSON with --json", async () => {
    const { code, stdout } = await runCli(["validate", `${tutorsDir}simple-tutor.yaml`, "--json"]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).ok).toBe(true);
  });

  it("exits 0 for a valid fragment library with --kind fragment", async () => {
    const { code, stdout } = await runCli([
      "validate",
      `${tutorsDir}simple-fragments.yaml`,
      "--kind",
      "fragment",
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain("Valid fragment file");
  });

  it("exits 1 with FRAGMENT_TEMPLATE_ERROR for a broken fragment template", async () => {
    const { code, stdout } = await runCli([
      "validate",
      `${tutorsDir}broken-template-fragments.yaml`,
      "--kind",
      "fragment",
    ]);

    expect(code).toBe(1);
    expect(stdout).toContain("FRAGMENT_TEMPLATE_ERROR");
  });

  it("exits 0 for a valid quiz with --kind quiz", async () => {
    const { code, stdout } = await runCli([
      "validate",
      `${quizzesDir}sample-quiz.yaml`,
      "--kind",
      "quiz",
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain("Valid quiz");
  });

  it("exits 1 with QUIZ_SCHEMA_ERROR for the committed broken quiz", async () => {
    const { code, stdout } = await runCli([
      "validate",
      `${quizzesDir}broken-quiz.yaml`,
      "--kind",
      "quiz",
    ]);

    expect(code).toBe(1);
    expect(stdout).toContain("QUIZ_SCHEMA_ERROR");
  });

  it("exits 0 for a valid writing activity with --kind writing", async () => {
    const { code, stdout } = await runCli([
      "validate",
      `${writingsDir}human-animal-short-story.yaml`,
      "--kind",
      "writing",
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain("Valid writing activity");
  });

  it("exits 1 with WRITING_SCHEMA_ERROR for the committed broken writing activity", async () => {
    const { code, stdout } = await runCli([
      "validate",
      `${writingsDir}broken-writing.yaml`,
      "--kind",
      "writing",
    ]);

    expect(code).toBe(1);
    expect(stdout).toContain("WRITING_SCHEMA_ERROR");
  });

  it("exits 0 for a valid coding activity with --kind coding", async () => {
    const { code, stdout } = await runCli([
      "validate",
      `${codingDir}beginner-typescript.yaml`,
      "--kind",
      "coding",
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain("Valid coding activity");
  });

  it("exits 1 with CODING_SCHEMA_ERROR for the committed broken coding activity", async () => {
    const { code, stdout } = await runCli([
      "validate",
      `${codingDir}broken-coding.yaml`,
      "--kind",
      "coding",
    ]);

    expect(code).toBe(1);
    expect(stdout).toContain("CODING_SCHEMA_ERROR");
  });

  it("rejects an invalid --kind", async () => {
    const { code, stderr } = await runCli([
      "validate",
      `${tutorsDir}simple-tutor.yaml`,
      "--kind",
      "bogus",
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain("Invalid --kind");
  });
});

describe("novedu-cli validate — public URLs", () => {
  it("exits 0 for the published valid tutor", async () => {
    const { code, stdout } = await runCli(["validate", `${RAW_BASE}/simple-tutor.yaml`]);

    expect(code).toBe(0);
    expect(stdout).toContain("Valid tutor");
  });

  it("exits 1 for the published broken tutor", async () => {
    const { code, stdout } = await runCli(["validate", `${RAW_BASE}/broken-tutor.yaml`]);

    expect(code).toBe(1);
    expect(stdout).toContain("Invalid tutor");
  });
});
