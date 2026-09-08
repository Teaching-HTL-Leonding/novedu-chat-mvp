// @vitest-environment node
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserCommand,
  type DeviceCode,
  fetchIdentity,
  forgetSession,
  getAccessToken,
  NotSignedInError,
  openBrowser,
  pollDeviceToken,
  readSessions,
  rememberSession,
  requestDeviceCode,
  revokeSession,
  serverOrigin,
  storedSession,
  writeSessions,
} from "./auth";

// Everything here is offline: the device flow runs against a fake `fetchImpl`
// and a fake clock, and the session file is written into a temp dir so the real
// permission modes are actually checked without touching ~/.novedu. `spawn` is
// mocked so `openBrowser` never launches anything — no test opens a browser.

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock,
}));

const SERVER = "http://localhost:3000";

function tempSessionsPath(): string {
  // The .novedu segment does not exist yet — writeSessions must create it.
  return join(mkdtempSync(join(tmpdir(), "novedu-cli-test-")), ".novedu", "sessions.json");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CODE: DeviceCode = {
  device_code: "dev-code-1",
  user_code: "ABCD2345",
  verification_uri: "http://localhost:3000/device",
  verification_uri_complete: "http://localhost:3000/device?user_code=ABCD2345",
  expires_in: 1800,
  interval: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("serverOrigin", () => {
  it("keys sessions by origin, ignoring path and trailing slash", () => {
    expect(serverOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(serverOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(serverOrigin("https://novedu.at/codes?x=1")).toBe("https://novedu.at");
  });
});

describe("the session file", () => {
  it("round-trips sessions per origin with restrictive modes (dir 0700, file 0600)", () => {
    const path = tempSessionsPath();
    writeSessions(
      {
        "http://localhost:3000": { token: "local-token", name: "Jane Teacher" },
        "https://novedu.at": { token: "prod-token", name: "Jane Prod" },
      },
      path,
    );

    expect(readSessions(path)).toEqual({
      "http://localhost:3000": { token: "local-token", name: "Jane Teacher" },
      "https://novedu.at": { token: "prod-token", name: "Jane Prod" },
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(path, "utf8"))["https://novedu.at"].token).toBe("prod-token");
  });

  it("treats a missing or corrupt file as no sessions", () => {
    const path = tempSessionsPath();
    expect(readSessions(path)).toEqual({});

    writeSessions({}, path);
    writeFileSync(path, "{ not json");
    expect(readSessions(path)).toEqual({});

    writeFileSync(path, JSON.stringify({ "http://x": { name: "no token" } }));
    expect(readSessions(path)).toEqual({});
  });

  it("remembers and forgets one server without disturbing the others", () => {
    const path = tempSessionsPath();
    rememberSession(SERVER, { token: "local-token", name: "Jane" }, path);
    rememberSession("https://novedu.at/", { token: "prod-token", name: "Jane" }, path);

    expect(storedSession("http://localhost:3000/anything", path)?.token).toBe("local-token");

    forgetSession(SERVER, path);
    expect(storedSession(SERVER, path)).toBeUndefined();
    expect(storedSession("https://novedu.at", path)?.token).toBe("prod-token");
  });

  it("deletes the obsolete token-cache.json next to it", () => {
    const path = tempSessionsPath();
    writeSessions({}, path);
    const legacy = join(path, "..", "token-cache.json");
    writeFileSync(legacy, "{}");

    rememberSession(SERVER, { token: "t", name: "n" }, path);

    expect(existsSync(legacy)).toBe(false);
  });
});

describe("getAccessToken", () => {
  it("returns the stored token for the server", async () => {
    const path = tempSessionsPath();
    rememberSession(SERVER, { token: "local-token", name: "Jane" }, path);
    expect(await getAccessToken(SERVER, path)).toBe("local-token");
  });

  it("throws NotSignedInError when no session is stored for that server", async () => {
    const path = tempSessionsPath();
    rememberSession("https://novedu.at", { token: "prod-token", name: "Jane" }, path);
    await expect(getAccessToken(SERVER, path)).rejects.toBeInstanceOf(NotSignedInError);
  });

  it("lets NOVEDU_TOKEN take precedence over the session file", async () => {
    const path = tempSessionsPath();
    rememberSession(SERVER, { token: "local-token", name: "Jane" }, path);
    vi.stubEnv("NOVEDU_TOKEN", "  env-token  ");
    expect(await getAccessToken(SERVER, path)).toBe("env-token");
  });
});

describe("requestDeviceCode", () => {
  it("posts the client id as JSON and returns the code pair", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(CODE));

    expect(await requestDeviceCode(SERVER, fetchImpl)).toEqual(CODE);

    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://localhost:3000/api/auth/device/code");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["user-agent"]).toMatch(/^novedu-cli\//);
    expect(JSON.parse(init.body as string)).toEqual({ client_id: "novedu-cli" });
  });

  it("reports the server's error description", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: "invalid_client", error_description: "unknown client" }, 400),
      );
    await expect(requestDeviceCode(SERVER, fetchImpl)).rejects.toThrow(/unknown client/);
  });

  it("tolerates the validation error shape", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: "client_id is required", code: "VALIDATION_ERROR" }, 400),
      );
    await expect(requestDeviceCode(SERVER, fetchImpl)).rejects.toThrow(/client_id is required/);
  });
});

describe("pollDeviceToken", () => {
  /** A fake clock the fake sleeper advances, so no test waits in real time. */
  function fakeClock() {
    let millis = 0;
    return {
      now: () => millis,
      sleep: vi.fn(async (ms: number) => {
        millis += ms;
      }),
    };
  }

  it("polls at the interval until the code is approved", async () => {
    const clock = fakeClock();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }, 400))
      .mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }, 400))
      .mockResolvedValueOnce(jsonResponse({ access_token: "session-token", token_type: "Bearer" }));

    expect(await pollDeviceToken(SERVER, CODE, { fetchImpl, ...clock })).toBe("session-token");

    expect(clock.sleep.mock.calls.map((c) => c[0])).toEqual([5000, 5000, 5000]);
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://localhost:3000/api/auth/device/token");
    expect(JSON.parse(init.body as string)).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: "dev-code-1",
      client_id: "novedu-cli",
    });
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("backs off by five seconds on slow_down", async () => {
    const clock = fakeClock();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "slow_down" }, 400))
      .mockResolvedValueOnce(jsonResponse({ error: "slow_down" }, 400))
      .mockResolvedValueOnce(jsonResponse({ access_token: "session-token" }));

    await pollDeviceToken(SERVER, CODE, { fetchImpl, ...clock });

    expect(clock.sleep.mock.calls.map((c) => c[0])).toEqual([5000, 10_000, 15_000]);
  });

  it.each([
    ["access_denied", /denied/i],
    ["expired_token", /expired/i],
    ["invalid_grant", /no longer valid/i],
  ])("throws on %s", async (error, matcher) => {
    const clock = fakeClock();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error }, 400));
    await expect(pollDeviceToken(SERVER, CODE, { fetchImpl, ...clock })).rejects.toThrow(matcher);
  });

  it("tolerates the validation error shape", async () => {
    const clock = fakeClock();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: "grant_type is invalid", code: "VALIDATION_ERROR" }, 400),
      );
    await expect(pollDeviceToken(SERVER, CODE, { fetchImpl, ...clock })).rejects.toThrow(
      /grant_type is invalid/,
    );
  });

  it("gives up once the code's lifetime has passed", async () => {
    const clock = fakeClock();
    // A fresh Response per call — a body can only be read once.
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => jsonResponse({ error: "authorization_pending" }, 400));

    await expect(
      pollDeviceToken(SERVER, { ...CODE, expires_in: 12 }, { fetchImpl, ...clock }),
    ).rejects.toThrow(/expired/i);

    // Two polls fit into the 12-second window; the third wake-up is past it.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("fetchIdentity", () => {
  it("sends the bearer token and returns the identity", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ name: "Jane Teacher", userId: "u1", isTeacher: true }));

    expect(await fetchIdentity(SERVER, "session-token", fetchImpl)).toEqual({
      name: "Jane Teacher",
      userId: "u1",
      isTeacher: true,
    });
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://localhost:3000/api/me");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer session-token");
  });

  it("returns null when the server REJECTS the token", async () => {
    expect(
      await fetchIdentity(SERVER, "t", vi.fn().mockResolvedValue(jsonResponse({}, 401))),
    ).toBeNull();
    expect(
      await fetchIdentity(SERVER, "t", vi.fn().mockResolvedValue(jsonResponse({}, 403))),
    ).toBeNull();
  });

  it("throws, naming the server, when it is unreachable or answers with an error", async () => {
    // Distinct from a rejection: the caller must not conclude "sign in again"
    // — and `login` must not start a second device flow — over an outage.
    await expect(
      fetchIdentity(SERVER, "t", vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))),
    ).rejects.toThrow(/localhost:3000.*ECONNREFUSED/);
    await expect(
      fetchIdentity(SERVER, "t", vi.fn().mockResolvedValue(jsonResponse({}, 502))),
    ).rejects.toThrow(/localhost:3000.*502/);
    await expect(
      fetchIdentity(SERVER, "t", vi.fn().mockResolvedValue(jsonResponse({ nope: true }))),
    ).rejects.toThrow(/no identity/);
  });
});

describe("revokeSession", () => {
  it("posts an empty JSON body with the bearer token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true }));

    await revokeSession(SERVER, "session-token", fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://localhost:3000/api/auth/sign-out");
    expect(init.method).toBe("POST");
    // The endpoint is JSON-only: both the header and the `{}` body are required.
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer session-token");
    expect(init.body).toBe("{}");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("swallows a failing sign-out", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(revokeSession(SERVER, "t", fetchImpl)).resolves.toBeUndefined();
  });
});

describe("browserCommand", () => {
  // A realistic verification URL: the query parameter sits behind a `?`, and a
  // longer link behind an `&`, which cmd treats as a command separator unless
  // the URL is quoted.
  const URL_WITH_AMP = "http://localhost:3000/device?user_code=ABCD2345&client=novedu-cli";

  it("passes the URL untouched to the POSIX openers", () => {
    expect(browserCommand(URL_WITH_AMP, "darwin")).toEqual({
      command: "open",
      args: [URL_WITH_AMP],
      verbatim: false,
    });
    expect(browserCommand(URL_WITH_AMP, "linux")).toEqual({
      command: "xdg-open",
      args: [URL_WITH_AMP],
      verbatim: false,
    });
  });

  it("quotes the URL for cmd on Windows so `&` cannot truncate it", () => {
    const { command, args, verbatim } = browserCommand(URL_WITH_AMP, "win32");
    expect(command).toBe("cmd");
    // Verbatim: Node must not re-quote, so the quotes have to be ours.
    expect(verbatim).toBe(true);
    expect(args).toEqual(["/c", "start", '""', `"${URL_WITH_AMP}"`]);
    const commandLine = args.join(" ");
    expect(commandLine).toContain(`"${URL_WITH_AMP}"`);
    expect(commandLine.split("&")[0]).toBe(`/c start "" "${URL_WITH_AMP.split("&")[0]}`);
  });
});

describe("openBrowser", () => {
  // A container without an opener (`spawn xdg-open ENOENT`) reports the failure
  // ASYNCHRONOUSLY through the child's `error` event — a try/catch never sees
  // it, and unhandled it would take the CLI down right after the link was
  // printed. The event must be swallowed so the device flow keeps polling.
  it("survives an opener that fails after the spawn call returned", async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    spawnMock.mockReturnValue(child);
    const uncaught = vi.fn();
    process.on("uncaughtException", uncaught);
    try {
      expect(() => openBrowser("http://localhost:3000/device?user_code=ABCD2345")).not.toThrow();
      expect(child.unref).toHaveBeenCalledTimes(1);
      // Attached before the event can fire — otherwise `emit("error")` throws.
      expect(child.listenerCount("error")).toBeGreaterThan(0);
      setImmediate(() => {
        child.emit("error", Object.assign(new Error("spawn xdg-open ENOENT"), { code: "ENOENT" }));
      });
      await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
      expect(uncaught).not.toHaveBeenCalled();
    } finally {
      process.off("uncaughtException", uncaught);
    }
  });
});
