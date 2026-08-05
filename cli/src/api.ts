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
 * Performs one authenticated API request. On ANY failure (not signed in,
 * network, non-2xx) it prints the JSON error to stderr per the contract —
 * server error bodies (`{ message }` — incl. the generic 401/403 — or
 * `{ errors }`) passed through VERBATIM — marks the process failed, and
 * returns `{ ok: false, error }` with that same payload. On success it returns
 * the parsed payload WITHOUT printing, so multi-step commands (`images upload`)
 * can consume intermediate responses silently. No client-side pre-validation:
 * the server runs the identical pipeline; offline checking is the `validate`
 * command's job.
 *
 * `quiet` suppresses both the stderr print and the exit-code marking and hands
 * the failure payload back instead — for commands that make MANY requests and
 * report the outcome themselves (`codes sync`, where one entry's rejection must
 * not abort the run).
 */
export async function performApiRequest(options: {
  server?: string;
  path: string;
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  quiet?: boolean;
}): Promise<{ ok: true; payload: unknown } | { ok: false; error: unknown }> {
  const fail = (value: unknown): { ok: false; error: unknown } => {
    if (!options.quiet) failJson(value);
    return { ok: false, error: value };
  };

  let token: string;
  try {
    token = await getAccessToken();
  } catch (error) {
    if (error instanceof NotSignedInError) {
      return fail({ message: error.message });
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
    return fail({
      message: `Could not reach ${server}: ${error instanceof Error ? error.message : error}`,
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    return fail(payload ?? { message: `${server} rejected the request: HTTP ${response.status}` });
  }
  return { ok: true, payload };
}

/**
 * Performs one authenticated API request and prints the outcome per the JSON
 * contract: the success body pretty-printed to stdout, every failure to stderr
 * (see {@link performApiRequest}).
 */
export async function runApiRequest(options: {
  server?: string;
  path: string;
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
}): Promise<void> {
  const result = await performApiRequest(options);
  if (result.ok) printJson(result.payload ?? null);
}
