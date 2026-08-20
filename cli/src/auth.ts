import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type AuthenticationResult,
  CryptoProvider,
  type ICachePlugin,
  PublicClientApplication,
} from "@azure/msal-node";

// Entra ID authentication for the CLI (docs/api.md). The CLI is a public
// client of the same "Novedu Chat MVP" app registration the web app signs in
// with; tokens are requested for the app's own exposed `cli.access` scope and
// sent as `Authorization: Bearer` to the app's API routes.
//
// The primary user is a coding agent: `login` (browser sign-in, or the device
// code flow via --device-code) is the one human-assisted step; the MSAL cache
// below holds the refresh token, so every later command acquires tokens
// silently and non-interactively.

// Public identifiers (NOT secrets), baked in so `npx @novedu/cli login` works
// out of the box. Env overrides let other deployments of this teaching repo
// reuse the CLI against their own tenant/app registration.
const DEFAULT_TENANT_ID = "91fc072c-edef-4f97-bdc5-cfb67718ae3a";
const DEFAULT_CLIENT_ID = "4d44fc4b-0434-4981-9765-62e2074ceecb";

function tenantId(): string {
  return process.env.NOVEDU_TENANT_ID || DEFAULT_TENANT_ID;
}

function clientId(): string {
  return process.env.NOVEDU_CLIENT_ID || DEFAULT_CLIENT_ID;
}

/** The delegated scope every token is requested for; msal-node adds the OIDC scopes itself. */
function scopes(): string[] {
  return [`api://${clientId()}/cli.access`];
}

/** Where the serialized MSAL cache (including the refresh token) lives. */
export const TOKEN_CACHE_DIR = join(homedir(), ".novedu");
export const TOKEN_CACHE_PATH = join(TOKEN_CACHE_DIR, "token-cache.json");

/** Thrown when a command needs a token but no (usable) cached account exists. */
export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in — run "novedu-cli login".');
    this.name = "NotSignedInError";
  }
}

/**
 * File-backed MSAL cache (az-CLI model): plain JSON, directory 0700, file
 * 0600. A missing file simply means an empty cache. Exported for tests.
 */
export function buildCachePlugin(cachePath: string = TOKEN_CACHE_PATH): ICachePlugin {
  const cacheDir = dirname(cachePath);
  return {
    beforeCacheAccess: async (context) => {
      let data: string;
      try {
        data = readFileSync(cachePath, "utf8");
      } catch {
        return; // no cache yet — leave the in-memory cache empty
      }
      context.tokenCache.deserialize(data);
    },
    afterCacheAccess: async (context) => {
      if (!context.cacheHasChanged) return;
      mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
      writeFileSync(cachePath, context.tokenCache.serialize(), { mode: 0o600 });
    },
  };
}

export function buildPca(cachePath: string = TOKEN_CACHE_PATH): PublicClientApplication {
  return new PublicClientApplication({
    auth: {
      clientId: clientId(),
      authority: `https://login.microsoftonline.com/${tenantId()}`,
    },
    cache: { cachePlugin: buildCachePlugin(cachePath) },
  });
}

/**
 * Acquires a token silently from the cached account (MSAL refreshes via the
 * cached refresh token when needed). Returns null when there is no account or
 * the silent acquisition fails (expired/revoked refresh token) — callers
 * decide between falling back to interactive (`login`) and NotSignedInError.
 */
export async function acquireSilent(
  pca: PublicClientApplication,
): Promise<AuthenticationResult | null> {
  const [account] = await pca.getTokenCache().getAllAccounts();
  if (!account) return null;
  try {
    return await pca.acquireTokenSilent({ account, scopes: scopes() });
  } catch {
    return null;
  }
}

/**
 * How the system browser is launched per platform. Exported for tests.
 *
 * Windows goes through `cmd /c start`, and cmd RE-PARSES the command line it
 * receives: an unquoted URL is cut at the first `&`, so Entra only ever saw
 * `authorize?client_id=…` and answered AADSTS900144 ("the request body must
 * contain the following parameter: 'scope'"). Node quotes an argument only
 * when it contains whitespace, so the URL is quoted here explicitly and the
 * command line handed over verbatim. The empty `""` is `start`'s window title
 * — without it, `start` would take the quoted URL as the title.
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

function defaultOpenBrowser(url: string): void {
  const { command, args, verbatim } = browserCommand(url);
  try {
    spawn(command, args, {
      stdio: "ignore",
      detached: true,
      windowsVerbatimArguments: verbatim,
    }).unref();
  } catch {
    // The sign-in URL was already surfaced via onUrl — opening is best-effort.
  }
}

/**
 * Runs the interactive authorization-code + PKCE flow with a loopback
 * redirect (the az-CLI model): opens the system browser and receives the code
 * on a short-lived localhost server. This is the DEFAULT login flow — tenant
 * Conditional Access policies commonly block the device code flow (error
 * 53003) but permit this one, since it is the same flow the web sign-in uses.
 *
 * Entra matches any localhost port against the registered `http://localhost`
 * public-client redirect URI, so the receiver binds an ephemeral port.
 * `onUrl` always receives the sign-in URL (fallback when no browser opens).
 */
export async function acquireInteractive(
  pca: PublicClientApplication,
  onUrl: (url: string) => void,
  openBrowser: (url: string) => void = defaultOpenBrowser,
): Promise<AuthenticationResult> {
  const { verifier, challenge } = await new CryptoProvider().generatePkceCodes();

  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });
  const redirectUri = `http://localhost:${port}`;

  try {
    const authCode = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Sign-in timed out after 5 minutes.")),
        5 * 60_000,
      );
      server.on("request", (req, res) => {
        const url = new URL(req.url ?? "/", redirectUri);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (!code && !error) {
          // Favicon and other stray requests must not consume the redirect.
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          code
            ? "<p>Signed in — you can close this tab and return to the terminal.</p>"
            : "<p>Sign-in failed — you can close this tab.</p>",
        );
        clearTimeout(timeout);
        if (code) resolve(code);
        else
          reject(
            new Error(`Sign-in failed: ${url.searchParams.get("error_description") ?? error}`),
          );
      });
    });

    const authUrl = await pca.getAuthCodeUrl({
      scopes: scopes(),
      redirectUri,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
    });
    onUrl(authUrl);
    openBrowser(authUrl);

    const code = await authCode;
    return await pca.acquireTokenByCode({
      code,
      scopes: scopes(),
      redirectUri,
      codeVerifier: verifier,
    });
  } finally {
    server.close();
  }
}

/**
 * Runs the device code flow — for machines without a local browser; the
 * tenant's Conditional Access policy must allow it. `onMessage` receives
 * Entra's instruction line (verification URL + user code) the moment the flow
 * starts — print it immediately so it can be relayed to the human while MSAL
 * keeps polling.
 */
export async function acquireByDeviceCode(
  pca: PublicClientApplication,
  onMessage: (message: string) => void,
): Promise<AuthenticationResult> {
  const result = await pca.acquireTokenByDeviceCode({
    deviceCodeCallback: (response) => onMessage(response.message),
    scopes: scopes(),
  });
  if (!result) throw new Error("Device code sign-in did not return a token.");
  return result;
}

/**
 * The one call every API command makes: a silently-acquired access token for
 * the Authorization header. Throws NotSignedInError when interactive login is
 * required first.
 *
 * `NOVEDU_TOKEN` short-circuits the MSAL cache with a caller-supplied bearer
 * token. It exists for TESTS and CI (the CLI integration suite runs the real
 * binary against a fake API, with no browser to sign in) — the token is still
 * validated by the server on every request, so this weakens nothing; it only
 * removes the interactive step. Not a substitute for `login` in normal use.
 */
export async function getAccessToken(): Promise<string> {
  const override = process.env.NOVEDU_TOKEN?.trim();
  if (override) return override;
  const result = await acquireSilent(buildPca());
  if (!result) throw new NotSignedInError();
  return result.accessToken;
}

/** Human-readable account label for command output. */
export function displayName(result: AuthenticationResult): string {
  return result.account?.name ?? result.account?.username ?? "(unknown account)";
}
