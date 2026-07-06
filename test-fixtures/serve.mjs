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
 * The typed return is what TypeScript consumers (the CLI integration test) see —
 * `allowJs` picks this JSDoc up straight from the implementation, so there is no
 * separate declaration file to drift.
 *
 * @param {number} [port]
 * @returns {Promise<{ server: import("node:http").Server, baseUrl: string }>}
 */
export function startFixturesServer(port = 0) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
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
      resolve({ server, baseUrl: `http://127.0.0.1:${actualPort}` });
    });
  });
}

// Run directly (Playwright webServer): listen on a fixed port and stay up.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.E2E_FIXTURES_PORT ?? 34567);
  const { baseUrl } = await startFixturesServer(port);
  console.log(`[fixtures] serving ${ACTIVITIES_ROOT} at ${baseUrl}`);
}
