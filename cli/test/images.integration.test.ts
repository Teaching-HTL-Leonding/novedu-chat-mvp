import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixturesServer } from "../../test-fixtures/serve.mjs";

// `images upload` end to end through the REAL built CLI binary
// (`node dist/main.js`) against the fixtures server's fake
// `POST /api/images/<name>` — fully offline, no sign-in (the CLI reads
// NOVEDU_TOKEN, see cli/src/auth.ts). This is the only place the CLI's
// multipart request is proven to arrive over the real wire: a genuine `fetch`
// call from the built binary, parsed by the same
// `new Response(buf, { headers }).formData()` the app route uses.
//
// Run via `npm run test:cli` — it builds the CLI first, so `dist/main.js` exists.

const cli = fileURLToPath(new URL("../dist/main.js", import.meta.url));

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);

let fixtures: Awaited<ReturnType<typeof startFixturesServer>> | undefined;
let dir: string;

beforeAll(async () => {
  fixtures = await startFixturesServer(0);
  dir = mkdtempSync(join(tmpdir(), "novedu-images-integration-"));
});

afterAll(async () => {
  const server = fixtures?.server as Server | undefined;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
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

describe("novedu-cli images upload", () => {
  it("sends one multipart request and reports the server's JSON on stdout", async () => {
    const path = join(dir, "diagram.png");
    writeFileSync(path, PNG_BYTES);

    const { code, stdout, stderr } = await runCli([
      "images",
      "upload",
      "e2e-img",
      "--file",
      path,
      "--credit",
      "CC BY",
      "--server",
      baseUrl(),
    ]);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.name).toBe("e2e-img");
    expect(payload.mimeType).toBe("image/png");
    expect(payload.byteSize).toBe(PNG_BYTES.length);
    expect(payload.credit).toBe("CC BY");

    // The fixtures server's fake route parsed the real multipart wire body —
    // its capture proves the CLI sent exactly the file's bytes and fields.
    expect(fixtures?.imageUploads).toHaveLength(1);
    const upload = fixtures?.imageUploads[0] as {
      name: string;
      mime: string;
      credit: string | null;
      fileName: string;
      bytes: Buffer;
    };
    expect(upload.name).toBe("e2e-img");
    expect(upload.mime).toBe("image/png");
    expect(upload.credit).toBe("CC BY");
    expect(upload.fileName).toBe("diagram.png");
    expect(Buffer.compare(upload.bytes, PNG_BYTES)).toBe(0);
  });

  it("rejects an unsupported extension on stderr, exit 1, without a request", async () => {
    const path = join(dir, "notes.txt");
    writeFileSync(path, "not an image");
    const before = fixtures?.imageUploads.length ?? 0;

    const { code, stdout, stderr } = await runCli([
      "images",
      "upload",
      "e2e-notes",
      "--file",
      path,
      "--server",
      baseUrl(),
    ]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    const payload = JSON.parse(stderr);
    expect(payload.message).toMatch(/\.png, \.jpg\/\.jpeg and \.svg/);
    expect(fixtures?.imageUploads.length).toBe(before);
  });
});
