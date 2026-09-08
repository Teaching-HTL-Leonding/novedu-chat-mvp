import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { cliVersion } from "./version";

// Authentication for the CLI (docs/api.md). The Novedu app is the identity
// provider: `login` runs the app's own OAuth device authorization flow
// (`/api/auth/device/*`) and stores the resulting session token, which every
// later command sends as `Authorization: Bearer` to the app's API routes. The
// CLI knows nothing about Entra — the browser half of the flow signs in against
// the app, which owns the Entra integration.
//
// The primary user is a coding agent: `login` (approve the code in a browser)
// is the one human-assisted step; the session file below holds a long-lived
// session token, so every later command runs non-interactively.

/** The device-flow client identifier the server validates (`validateClient`). */
const CLIENT_ID = "novedu-cli";

/** Where the per-server session tokens live: `{ [origin]: { token, name } }`. */
export const SESSIONS_PATH = join(homedir(), ".novedu", "sessions.json");

/** One stored sign-in: the bearer token plus the display name it belongs to. */
export type StoredSession = { token: string; name: string };

/** The whole session file, keyed by server origin (one sign-in per server). */
export type Sessions = Record<string, StoredSession>;

/** Thrown when a command needs a token but no session is stored for the server. */
export class NotSignedInError extends Error {
  constructor(message = 'Not signed in — run "novedu-cli login".') {
    super(message);
    this.name = "NotSignedInError";
  }
}

/** What `POST /api/auth/device/code` hands back. */
export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

/** The identity `GET /api/me` reports for a bearer token. */
export type Identity = { name: string | null; userId: string; isTeacher: boolean };

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * The session-file key for a server: sessions are per ORIGIN, so
 * `http://localhost:3000/` and `http://localhost:3000/x` share one entry while
 * production and a dev server stay separate.
 */
export function serverOrigin(server: string): string {
  return new URL(server).origin;
}

/** Reads the session file; a missing or corrupt file simply means "no sessions". */
export function readSessions(path: string = SESSIONS_PATH): Sessions {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const sessions: Sessions = {};
    for (const [origin, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const { token, name } = value as { token?: unknown; name?: unknown };
      if (typeof token !== "string" || !token) continue;
      sessions[origin] = { token, name: typeof name === "string" ? name : "" };
    }
    return sessions;
  } catch {
    return {};
  }
}

/**
 * Writes the session file with the az-CLI modes: directory 0700, file 0600 —
 * the token is a live credential. Writing also removes the obsolete
 * `token-cache.json` beside it — no code path reads that file.
 */
export function writeSessions(sessions: Sessions, path: string = SESSIONS_PATH): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(sessions, null, 2)}\n`, { mode: 0o600 });
  removeLegacyTokenCache(path);
}

/** The stored session for a server, if any. */
export function storedSession(
  server: string,
  path: string = SESSIONS_PATH,
): StoredSession | undefined {
  return readSessions(path)[serverOrigin(server)];
}

/** Stores (or replaces) the session for a server. */
export function rememberSession(
  server: string,
  session: StoredSession,
  path: string = SESSIONS_PATH,
): void {
  const sessions = readSessions(path);
  sessions[serverOrigin(server)] = session;
  writeSessions(sessions, path);
}

/** Drops the stored session for a server (no-op when none is stored). */
export function forgetSession(server: string, path: string = SESSIONS_PATH): void {
  const sessions = readSessions(path);
  delete sessions[serverOrigin(server)];
  writeSessions(sessions, path);
}

/** Removes the obsolete `token-cache.json`, which no code path reads. */
function removeLegacyTokenCache(sessionsPath: string): void {
  rmSync(join(dirname(sessionsPath), "token-cache.json"), { force: true });
}

/**
 * The one call every API command makes: the bearer token for the given server.
 * Throws NotSignedInError when `login` has to run first.
 *
 * `NOVEDU_TOKEN` short-circuits the session file with a caller-supplied bearer
 * token. It exists for TESTS and CI (the CLI integration suite runs the real
 * binary against a fake API, with no browser to approve a device code) — the
 * token is still validated by the server on every request, so this weakens
 * nothing; it only removes the interactive step. Not a substitute for `login`.
 */
export async function getAccessToken(
  server: string,
  path: string = SESSIONS_PATH,
): Promise<string> {
  const override = process.env.NOVEDU_TOKEN?.trim();
  if (override) return override;
  const session = storedSession(server, path);
  if (!session) {
    throw new NotSignedInError(
      `Not signed in to ${serverOrigin(server)} — run "novedu-cli login".`,
    );
  }
  return session.token;
}

/** `{ error, error_description }` (OAuth) and `{ message, code }` (validation) in one shape. */
function parseError(payload: unknown): { error?: string; description?: string } {
  if (!payload || typeof payload !== "object") return {};
  const body = payload as Record<string, unknown>;
  const error =
    typeof body.error === "string"
      ? body.error
      : typeof body.code === "string"
        ? body.code
        : undefined;
  const description =
    typeof body.error_description === "string"
      ? body.error_description
      : typeof body.message === "string"
        ? body.message
        : undefined;
  return { error, description };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Starts the device flow: asks the server for a device + user code pair. The
 * request carries no credentials — the browser half authenticates the human.
 */
export async function requestDeviceCode(
  server: string,
  fetchImpl: FetchLike = fetch,
): Promise<DeviceCode> {
  const response = await fetchImpl(new URL("/api/auth/device/code", server), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": `novedu-cli/${cliVersion()}`,
    },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const { error, description } = parseError(payload);
    throw new Error(
      `Could not start the sign-in: ${description ?? error ?? `HTTP ${response.status}`}`,
    );
  }
  const code = payload as Partial<DeviceCode> | undefined;
  if (!code || typeof code.device_code !== "string" || typeof code.user_code !== "string") {
    throw new Error(`${server} returned no device code.`);
  }
  return {
    device_code: code.device_code,
    user_code: code.user_code,
    verification_uri: code.verification_uri ?? new URL("/device", server).href,
    verification_uri_complete:
      code.verification_uri_complete ??
      `${new URL("/device", server).href}?user_code=${encodeURIComponent(code.user_code)}`,
    expires_in: typeof code.expires_in === "number" ? code.expires_in : 1800,
    interval: typeof code.interval === "number" ? code.interval : 5,
  };
}

/** Terminal poll outcomes, phrased for a human reading the terminal. */
const POLL_FAILURES: Record<string, string> = {
  access_denied: "Sign-in was denied in the browser.",
  expired_token: "The sign-in request expired before it was approved.",
  invalid_grant: "The sign-in request is no longer valid.",
};

function pollFailureMessage(payload: unknown, status: number): string {
  const { error, description } = parseError(payload);
  const detail = description ?? error ?? `HTTP ${status}`;
  const known = error ? POLL_FAILURES[error] : undefined;
  return known ? `${known} (${detail})` : `Sign-in failed: ${detail}`;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the token endpoint until the human approves the code in the browser,
 * and returns the session token. Waits `interval` seconds between polls,
 * honours the server's `slow_down` back-off, and gives up once the code's
 * `expires_in` window has passed. The clock, the sleeper and fetch are
 * injectable so tests need no real time.
 */
export async function pollDeviceToken(
  server: string,
  code: DeviceCode,
  deps: { fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;

  const deadline = now() + code.expires_in * 1000;
  let interval = code.interval > 0 ? code.interval : 5;

  while (true) {
    await sleep(interval * 1000);
    if (now() >= deadline) {
      throw new Error("The sign-in request expired before it was approved.");
    }
    const response = await fetchImpl(new URL("/api/auth/device/token", server), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": `novedu-cli/${cliVersion()}`,
      },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: code.device_code,
        client_id: CLIENT_ID,
      }),
    });
    const payload = await readJson(response);

    if (response.ok) {
      const token = (payload as { access_token?: unknown } | undefined)?.access_token;
      if (typeof token === "string" && token) return token;
      throw new Error("Sign-in failed: the server returned no access token.");
    }

    const { error } = parseError(payload);
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      interval += 5;
      continue;
    }
    throw new Error(pollFailureMessage(payload, response.status));
  }
}

/**
 * Calls `GET /api/me` with a bearer token.
 *
 * The two failures are kept apart, because callers act on them differently:
 * `null` means the SERVER REJECTED the token (401/403 — sign in again), while
 * anything else — unreachable server, 5xx, a body that is not an identity —
 * THROWS with a message naming the server, so a transient outage is never
 * mistaken for a dead session.
 */
export async function fetchIdentity(
  server: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<Identity | null> {
  let response: Response;
  try {
    response = await fetchImpl(new URL("/api/me", server), {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new Error(
      `Could not reach ${serverOrigin(server)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    throw new Error(`${serverOrigin(server)} answered HTTP ${response.status}.`);
  }
  const payload = (await readJson(response)) as Identity | undefined;
  if (!payload || typeof payload.userId !== "string") {
    throw new Error(`${serverOrigin(server)} returned no identity.`);
  }
  return payload;
}

/**
 * Best-effort session revocation: deletes the session row server-side. The
 * endpoint is JSON-only (an empty body is rejected), and a slow or unreachable
 * server must never keep the local `logout` from clearing the token, hence the
 * short timeout and the swallowed errors.
 */
export async function revokeSession(
  server: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  try {
    await fetchImpl(new URL("/api/auth/sign-out", server), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Local sign-out is what matters; the session expires on its own.
  }
}

/**
 * How the system browser is launched per platform. Exported for tests.
 *
 * Windows goes through `cmd /c start`, and cmd RE-PARSES the command line it
 * receives: an unquoted URL is cut at the first `&`. Node quotes an argument
 * only when it contains whitespace, so the URL is quoted here explicitly and
 * the command line handed over verbatim. The empty `""` is `start`'s window
 * title — without it, `start` would take the quoted URL as the title.
 */
export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; verbatim: boolean } {
  if (platform === "darwin") return { command: "open", args: [url], verbatim: false };
  if (platform === "win32")
    return { command: "cmd", args: ["/c", "start", '""', `"${url}"`], verbatim: true };
  return { command: "xdg-open", args: [url], verbatim: false };
}

/** Opens the verification URL in the system browser; failure is not an error. */
export function openBrowser(url: string): void {
  const { command, args, verbatim } = browserCommand(url);
  try {
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
      windowsVerbatimArguments: verbatim,
    });
    // A missing opener (headless container, no xdg-open) surfaces ASYNCHRONOUSLY
    // as an `error` event, which the try/catch below cannot see — unhandled, it
    // would kill the CLI mid-flow. The link is already on stderr, so the person
    // can open it by hand: swallow the event and keep polling.
    child.on("error", () => {});
    child.unref();
  } catch {
    // The URL was already printed — opening it is a convenience.
  }
}
