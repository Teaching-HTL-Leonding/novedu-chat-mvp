import { getAccessToken, NotSignedInError } from "./auth";
import { resolveServerUrl } from "./server-url";

// Shared plumbing for the JSON API commands (`codes …`, `files …`): silent
// token acquisition, the --server/NOVEDU_SERVER/production base-URL chain, and
// the machine-readable output contract — success bodies pretty-printed to
// STDOUT (exit 0), every failure as a JSON object on STDERR (exit 1), so both
// streams are jq-processable. `whoami` keeps its human-readable output; these
// commands are built for scripts and coding agents (docs/api.md).

/** Pretty-prints a success payload to stdout. */
export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** Prints a failure payload as JSON to stderr and marks the process failed. */
export function failJson(value: unknown): void {
  console.error(JSON.stringify(value, null, 2));
  process.exitCode = 1;
}

/**
 * Performs one authenticated API request and prints the outcome per the JSON
 * contract. Server error bodies (`{ message }` — incl. the generic 401/403 —
 * or `{ errors }`) are passed through VERBATIM to stderr — the server's
 * structured validation detail is the CLI's error message. No client-side
 * pre-validation: the server runs the identical pipeline; offline checking is
 * the `validate` command's job.
 */
export async function runApiRequest(options: {
  server?: string;
  path: string;
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
}): Promise<void> {
  let token: string;
  try {
    token = await getAccessToken();
  } catch (error) {
    if (error instanceof NotSignedInError) {
      failJson({ message: error.message });
      return;
    }
    throw error;
  }

  const server = resolveServerUrl(options.server);
  let response: Response;
  try {
    response = await fetch(new URL(options.path, server), {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    failJson({
      message: `Could not reach ${server}: ${error instanceof Error ? error.message : error}`,
    });
    return;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    failJson(payload ?? { message: `${server} rejected the request: HTTP ${response.status}` });
    return;
  }
  printJson(payload ?? null);
}
