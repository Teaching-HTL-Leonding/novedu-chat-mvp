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
const tutorsDir = fileURLToPath(new URL("../../tutors/", import.meta.url));

const RAW_BASE =
  "https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/tutors";

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
