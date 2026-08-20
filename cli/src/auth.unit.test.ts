// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthenticationResult, PublicClientApplication } from "@azure/msal-node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireByDeviceCode,
  acquireInteractive,
  acquireSilent,
  browserCommand,
  buildCachePlugin,
  buildPca,
  displayName,
  getAccessToken,
  NotSignedInError,
} from "./auth";

// The PCA is mocked (no Entra traffic) — but only the PCA: the real
// CryptoProvider stays so PKCE generation in acquireInteractive is genuine.
// The cache plugin runs against the real filesystem in a temp dir so the
// permission modes are actually checked.
const mockPca = {
  getTokenCache: vi.fn(),
  acquireTokenSilent: vi.fn(),
  acquireTokenByDeviceCode: vi.fn(),
  getAuthCodeUrl: vi.fn(),
  acquireTokenByCode: vi.fn(),
};
vi.mock("@azure/msal-node", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@azure/msal-node")>()),
  // A function expression (not an arrow) so `new PublicClientApplication(...)` works.
  PublicClientApplication: vi.fn(function constructMock() {
    return mockPca;
  }),
}));

function accountsInCache(accounts: unknown[]): void {
  mockPca.getTokenCache.mockReturnValue({ getAllAccounts: vi.fn().mockResolvedValue(accounts) });
}

const RESULT = {
  accessToken: "token-123",
  account: { name: "Jane Teacher", username: "jane@example.org" },
} as unknown as AuthenticationResult;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildCachePlugin", () => {
  function tempCachePath(): string {
    // The .novedu segment does not exist yet — afterCacheAccess must create it.
    return join(mkdtempSync(join(tmpdir(), "novedu-cli-test-")), ".novedu", "token-cache.json");
  }

  it("loads an existing cache file into the token cache", async () => {
    const cachePath = tempCachePath();
    const plugin = buildCachePlugin(cachePath);
    const deserialize = vi.fn();
    await plugin.afterCacheAccess({
      cacheHasChanged: true,
      tokenCache: { serialize: () => '{"cached":"state"}' },
    } as never);

    await plugin.beforeCacheAccess({ tokenCache: { deserialize } } as never);
    expect(deserialize).toHaveBeenCalledWith('{"cached":"state"}');
  });

  it("treats a missing cache file as an empty cache", async () => {
    const plugin = buildCachePlugin(tempCachePath());
    const deserialize = vi.fn();
    await plugin.beforeCacheAccess({ tokenCache: { deserialize } } as never);
    expect(deserialize).not.toHaveBeenCalled();
  });

  it("writes the cache with restrictive modes (dir 0700, file 0600)", async () => {
    const cachePath = tempCachePath();
    const plugin = buildCachePlugin(cachePath);
    await plugin.afterCacheAccess({
      cacheHasChanged: true,
      tokenCache: { serialize: () => "serialized" },
    } as never);

    expect(readFileSync(cachePath, "utf8")).toBe("serialized");
    expect(statSync(cachePath).mode & 0o777).toBe(0o600);
    expect(statSync(join(cachePath, "..")).mode & 0o777).toBe(0o700);
  });

  it("does not write when the cache is unchanged", async () => {
    const cachePath = tempCachePath();
    const plugin = buildCachePlugin(cachePath);
    await plugin.afterCacheAccess({
      cacheHasChanged: false,
      tokenCache: { serialize: () => "serialized" },
    } as never);
    expect(existsSync(cachePath)).toBe(false);
  });
});

describe("acquireSilent", () => {
  const pca = mockPca as unknown as PublicClientApplication;

  it("returns null when no account is cached", async () => {
    accountsInCache([]);
    expect(await acquireSilent(pca)).toBeNull();
    expect(mockPca.acquireTokenSilent).not.toHaveBeenCalled();
  });

  it("acquires a token for the cached account", async () => {
    const account = { homeAccountId: "acc-1" };
    accountsInCache([account]);
    mockPca.acquireTokenSilent.mockResolvedValue(RESULT);

    expect(await acquireSilent(pca)).toBe(RESULT);
    expect(mockPca.acquireTokenSilent).toHaveBeenCalledWith(
      expect.objectContaining({ account, scopes: [expect.stringMatching(/\/cli\.access$/)] }),
    );
  });

  it("returns null when silent acquisition fails (expired refresh token)", async () => {
    accountsInCache([{ homeAccountId: "acc-1" }]);
    mockPca.acquireTokenSilent.mockRejectedValue(new Error("interaction_required"));
    expect(await acquireSilent(pca)).toBeNull();
  });
});

describe("acquireByDeviceCode", () => {
  const pca = mockPca as unknown as PublicClientApplication;

  it("surfaces the device-code message before the flow completes", async () => {
    const events: string[] = [];
    mockPca.acquireTokenByDeviceCode.mockImplementation(
      async ({ deviceCodeCallback }: { deviceCodeCallback: (r: { message: string }) => void }) => {
        deviceCodeCallback({ message: "go to https://microsoft.com/devicelogin, code ABC" });
        events.push("flow-completed");
        return RESULT;
      },
    );

    const result = await acquireByDeviceCode(pca, (message) => events.push(message));
    expect(result).toBe(RESULT);
    expect(events).toEqual(["go to https://microsoft.com/devicelogin, code ABC", "flow-completed"]);
  });

  it("throws when the flow yields no token", async () => {
    mockPca.acquireTokenByDeviceCode.mockResolvedValue(null);
    await expect(acquireByDeviceCode(pca, () => {})).rejects.toThrow(/did not return a token/);
  });
});

describe("acquireInteractive", () => {
  const pca = mockPca as unknown as PublicClientApplication;

  function redirectUriFromAuthCodeCall(): string {
    const [request] = mockPca.getAuthCodeUrl.mock.calls[0] as [{ redirectUri: string }];
    return request.redirectUri;
  }

  it("exchanges the loopback auth code for a token (PKCE round-trip)", async () => {
    mockPca.getAuthCodeUrl.mockResolvedValue("https://login.example/authorize");
    mockPca.acquireTokenByCode.mockResolvedValue(RESULT);
    const urls: string[] = [];
    const opened: string[] = [];

    const pending = acquireInteractive(
      pca,
      (url) => urls.push(url),
      (url) => {
        opened.push(url);
        // Simulate the browser: Entra redirects back to the loopback server.
        const redirectUri = redirectUriFromAuthCodeCall();
        void fetch(`${redirectUri}/?code=auth-code-1`);
      },
    );

    expect(await pending).toBe(RESULT);
    expect(urls).toEqual(["https://login.example/authorize"]);
    expect(opened).toEqual(["https://login.example/authorize"]);

    // The code exchange carries the SAME redirectUri and the PKCE verifier
    // matching the challenge sent in the authorize request.
    const [authRequest] = mockPca.getAuthCodeUrl.mock.calls[0] as [
      { redirectUri: string; codeChallenge: string; codeChallengeMethod: string },
    ];
    const [tokenRequest] = mockPca.acquireTokenByCode.mock.calls[0] as [
      { code: string; redirectUri: string; codeVerifier: string },
    ];
    expect(authRequest.codeChallengeMethod).toBe("S256");
    expect(authRequest.codeChallenge).toBeTruthy();
    expect(tokenRequest).toMatchObject({
      code: "auth-code-1",
      redirectUri: authRequest.redirectUri,
    });
    expect(tokenRequest.codeVerifier).toBeTruthy();
  });

  it("rejects when Entra redirects back with an error", async () => {
    mockPca.getAuthCodeUrl.mockResolvedValue("https://login.example/authorize");

    const pending = acquireInteractive(
      pca,
      () => {},
      () => {
        const redirectUri = redirectUriFromAuthCodeCall();
        void fetch(`${redirectUri}/?error=access_denied&error_description=blocked+by+policy`);
      },
    );

    await expect(pending).rejects.toThrow(/blocked by policy/);
    expect(mockPca.acquireTokenByCode).not.toHaveBeenCalled();
  });
});

describe("getAccessToken", () => {
  it("returns the silently acquired access token", async () => {
    accountsInCache([{ homeAccountId: "acc-1" }]);
    mockPca.acquireTokenSilent.mockResolvedValue(RESULT);
    expect(await getAccessToken()).toBe("token-123");
  });

  it("throws NotSignedInError when no account is cached", async () => {
    accountsInCache([]);
    await expect(getAccessToken()).rejects.toBeInstanceOf(NotSignedInError);
  });
});

describe("buildPca", () => {
  it("configures the public client with the baked-in tenant and client id", async () => {
    const { PublicClientApplication } = await import("@azure/msal-node");
    buildPca();
    expect(vi.mocked(PublicClientApplication)).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          clientId: "4d44fc4b-0434-4981-9765-62e2074ceecb",
          authority: expect.stringContaining("91fc072c-edef-4f97-bdc5-cfb67718ae3a"),
        }),
      }),
    );
  });

  it("honors the NOVEDU_TENANT_ID / NOVEDU_CLIENT_ID overrides", async () => {
    vi.stubEnv("NOVEDU_TENANT_ID", "other-tenant");
    vi.stubEnv("NOVEDU_CLIENT_ID", "other-client");
    try {
      const { PublicClientApplication } = await import("@azure/msal-node");
      buildPca();
      expect(vi.mocked(PublicClientApplication)).toHaveBeenLastCalledWith(
        expect.objectContaining({
          auth: expect.objectContaining({
            clientId: "other-client",
            authority: "https://login.microsoftonline.com/other-tenant",
          }),
        }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("displayName", () => {
  it("prefers the account name, falls back to username, then a placeholder", () => {
    expect(displayName(RESULT)).toBe("Jane Teacher");
    expect(
      displayName({ account: { username: "jane@example.org" } } as unknown as AuthenticationResult),
    ).toBe("jane@example.org");
    expect(displayName({ account: null } as unknown as AuthenticationResult)).toBe(
      "(unknown account)",
    );
  });
});

describe("browserCommand", () => {
  // A realistic authorize URL: every parameter after the first sits behind an
  // `&`, which cmd treats as a command separator unless the URL is quoted.
  const AUTH_URL =
    "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?client_id=abc&scope=api%3A%2F%2Fabc%2Fcli.access&redirect_uri=http%3A%2F%2Flocalhost%3A1234";

  it("passes the URL untouched to the POSIX openers", () => {
    expect(browserCommand(AUTH_URL, "darwin")).toEqual({
      command: "open",
      args: [AUTH_URL],
      verbatim: false,
    });
    expect(browserCommand(AUTH_URL, "linux")).toEqual({
      command: "xdg-open",
      args: [AUTH_URL],
      verbatim: false,
    });
  });

  it("quotes the URL for cmd on Windows so `&` cannot truncate it", () => {
    const { command, args, verbatim } = browserCommand(AUTH_URL, "win32");
    expect(command).toBe("cmd");
    // Verbatim: Node must not re-quote, so the quotes have to be ours.
    expect(verbatim).toBe(true);
    expect(args).toEqual(["/c", "start", '""', `"${AUTH_URL}"`]);
    // The command line cmd actually parses keeps the whole query string in one
    // quoted token — an unquoted URL would lose `scope` (AADSTS900144).
    const commandLine = args.join(" ");
    expect(commandLine).toContain(`"${AUTH_URL}"`);
    expect(commandLine.split("&")[0]).toBe(`/c start "" "${AUTH_URL.split("&")[0]}`);
  });
});
