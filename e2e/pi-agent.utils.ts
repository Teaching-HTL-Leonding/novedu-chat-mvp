import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildLittleCoderConfig } from "../lib/little-coder-config";

// Drives the REAL pi coding agent (`@earendil-works/pi-coding-agent`, a pinned
// devDependency — little-coder is a thin wrapper over it) against the coding
// module's public OpenAI-compatible endpoint, exactly the way a student's tool
// connects: a `models.json` with a minted per-user API key (`nvk-…`, from
// `novedu_coding_keys` via `mintCodingKey`). Used only by the @live-llm
// `coding-agent.spec.ts`.
//
// Plain `node:child_process` + `node:fs` — Playwright's CJS test runner cannot
// load ESM-only modules (the same constraint that keeps `code.utils.ts` on the
// plain `pg` driver). `buildLittleCoderConfig` is the app's own pure,
// client-safe config builder, so the generated file can never drift from what
// the connection page tells students to paste.

// The Playwright baseURL (playwright.config.ts) + the documented endpoint path.
const CODING_BASE_URL = "http://localhost:3000/api/coding/v1";

// A full agent round-trip should be well under this; a hung child must not eat
// the whole 120 s test timeout, so kill it early enough to leave room for the
// spec's follow-up assertions.
const PI_TIMEOUT_MS = 90_000;

export interface PiAgentResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs pi once in `--print` mode against the coding endpoint, authenticated by
 * the minted per-user API key. A fresh temp directory serves as pi's config dir
 * (`PI_CODING_AGENT_DIR` — the user's real `~/.pi` is never touched or read)
 * holding only the generated `models.json`; the child's cwd is an empty
 * subdirectory so no repo `AGENTS.md`/`CLAUDE.md` is picked up. All discovery
 * (tools, sessions, extensions, skills, context files, prompt templates) is
 * disabled — this is a pure chat-completion smoke through the proxy.
 */
export async function runPiAgent(options: {
  apiKey: string;
  prompt: string;
}): Promise<PiAgentResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-e2e-"));
  try {
    await writeFile(
      path.join(tempDir, "models.json"),
      buildLittleCoderConfig({
        baseUrl: CODING_BASE_URL,
        apiKey: options.apiKey,
        modelId: "coding",
        modelName: "Novedu coding",
      }),
      "utf8",
    );
    const workDir = path.join(tempDir, "work");
    await mkdir(workDir);

    const piBin = path.join(process.cwd(), "node_modules", ".bin", "pi");
    return await new Promise<PiAgentResult>((resolve, reject) => {
      const child = spawn(
        piBin,
        [
          "--provider",
          "novedu",
          "--model",
          "coding",
          "--print",
          "--no-tools",
          "--no-session",
          "--no-extensions",
          "--no-skills",
          "--no-context-files",
          "--no-prompt-templates",
          options.prompt,
        ],
        {
          cwd: workDir,
          env: { ...process.env, PI_CODING_AGENT_DIR: tempDir },
          // stdin must be CLOSED: pi in --print mode reads a non-TTY stdin
          // until EOF (piped-prompt support), so an open default pipe hangs it.
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        stderr += `\n[e2e] pi did not exit within ${PI_TIMEOUT_MS} ms — killed`;
        child.kill();
      }, PI_TIMEOUT_MS);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr });
      });
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Asks the coding endpoint which model actually served the completion: one
 * plain non-streamed POST, returning the OpenAI-compatible `model` field of the
 * response body. The proxy pipes the upstream response back UNPARSED, so this
 * is the upstream's own truth (vLLM reports the served model id, Azure Foundry
 * the deployment's model name) — not our bookkeeping. Reads ONLY `model`, so it
 * is safe even if a reasoning model spends the whole token budget thinking and
 * returns empty content (the endpoint's `adaptBody` handles the Foundry
 * `max_tokens` rename).
 */
export async function fetchServedModel(apiKey: string): Promise<{ model: string; raw: string }> {
  const res = await fetch(`${CODING_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "coding",
      stream: false,
      max_tokens: 512,
      messages: [{ role: "user", content: "Say OK." }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) return { model: `<HTTP ${res.status}>`, raw };
  const model = (JSON.parse(raw) as { model?: unknown }).model;
  return { model: typeof model === "string" ? model : "<missing>", raw };
}
