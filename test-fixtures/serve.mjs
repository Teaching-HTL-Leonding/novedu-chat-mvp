// A tiny static file server for the on-disk test fixtures. Two consumers:
//   - Playwright's `webServer` (run directly: `node test-fixtures/serve.mjs`),
//     so e2e specs fetch activity YAML over HTTP, fully offline.
//   - the CLI integration test, which imports `startFixturesServer` and starts
//     one on an ephemeral port for its "fetch a URL" cases.
//
// Serves flat files under `test-fixtures/activities/<subpath>`; anything that
// resolves outside that root is refused (path-traversal guard). `GET /` is a
// health check. The whole handler is wrapped so a malformed request (e.g. a bad
// %-escape) answers 400 instead of crashing the long-lived shared process.
//
// It ALSO fakes the app's `/api/codes` endpoint (list + mint) so `codes sync`
// can be integration-tested end-to-end offline: same wire shape as
// `app/api/codes/route.ts`, deterministic codes, no YAML validation, and any
// bearer token accepted (the CLI supplies one via NOVEDU_TOKEN). It is a test
// double, never a second implementation — anything policy-relevant belongs in
// the app's route and its own tests.

import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ACTIVITIES_ROOT = fileURLToPath(new URL("./activities/", import.meta.url));

/**
 * Start the fixtures server on `port` (0 = an ephemeral free port). Resolves to
 * the server handle and its base URL once it is listening; rejects on a listen
 * failure (e.g. EADDRINUSE) instead of leaving the caller hanging.
 *
 * `options.codes` seeds the fake `/api/codes` store (the array is used as-is, so
 * a caller can inspect what a run minted).
 *
 * The typed return is what TypeScript consumers (the CLI integration test) see —
 * `allowJs` picks this JSDoc up straight from the implementation, so there is no
 * separate declaration file to drift.
 *
 * @param {number} [port]
 * @param {{ codes?: Array<Record<string, unknown>> }} [options]
 * @returns {Promise<{ server: import("node:http").Server, baseUrl: string, codes: Array<Record<string, unknown>> }>}
 */
export function startFixturesServer(port = 0, options = {}) {
  const codes = options.codes ?? [];
  let minted = 0;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
      }
      if (url.pathname === "/api/codes") {
        await handleCodes(req, res, codes, () => `synced${String(++minted).padStart(4, "0")}`);
        return;
      }
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const filePath = path.resolve(ACTIVITIES_ROOT, rel);
      if (!filePath.startsWith(ACTIVITIES_ROOT)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": "application/yaml" });
      res.end(body);
    } catch (error) {
      // ENOENT → 404; anything else (malformed %-escape, bad URL) → 400. Never
      // let an exception escape the async handler — it would kill the process.
      if (!res.headersSent) res.writeHead(error?.code === "ENOENT" ? 404 : 400);
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({ server, baseUrl: `http://127.0.0.1:${actualPort}`, codes });
    });
  });
}

/** JSON reply helper for the fake API. */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(payload);
}

/**
 * The fake `GET`/`POST /api/codes`. GET answers the store newest-first; POST
 * appends one row and answers 201 with it. Window bounds are normalized to ISO
 * UTC exactly like the real route, so a registry spelling a moment `+02:00`
 * still matches its stored code on the next run.
 */
/**
 * A window bound as the real route stores it: whole unix seconds (its
 * `isoToUnixSeconds` floors), rendered back as UTC. Keeping the milliseconds here
 * would make the fake more forgiving than production and hide a matching bug.
 */
function wholeSeconds(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(Math.floor(parsed / 1000) * 1000).toISOString();
}

async function handleCodes(req, res, codes, nextCode) {
  if (!/^Bearer .+/.test(req.headers.authorization ?? "")) {
    sendJson(res, 401, { message: "Unauthorized" });
    return;
  }
  const origin = `http://${req.headers.host ?? "127.0.0.1"}`;

  if (req.method === "GET") {
    sendJson(res, 200, [...codes].reverse());
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { message: "Method not allowed" });
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    sendJson(res, 400, { message: "The request body must be JSON." });
    return;
  }
  if (!body?.module || !body?.fileUrl) {
    sendJson(res, 400, { message: "module and fileUrl are required." });
    return;
  }

  const code = nextCode();
  const entry = {
    code,
    url: `${origin}/${code}`,
    module: body.module,
    note: body.note ?? "",
    fileUrl: new URL(body.fileUrl).href,
    anonymous: true,
    validFrom: wholeSeconds(body.validFrom),
    validUntil: wholeSeconds(body.validUntil),
    llm: body.llm ?? null,
    createdBy: "fixtures-teacher",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, codes.length)).toISOString(),
  };
  codes.push(entry);
  sendJson(res, 201, entry);
}

// Run directly (Playwright webServer): listen on a fixed port and stay up.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.E2E_FIXTURES_PORT ?? 34567);
  const { baseUrl } = await startFixturesServer(port);
  console.log(`[fixtures] serving ${ACTIVITIES_ROOT} at ${baseUrl}`);
}
