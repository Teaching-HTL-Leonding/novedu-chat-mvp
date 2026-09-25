import { getBearerTokenProvider } from "@azure/identity";
import { buildMonitorCredential } from "@/lib/azure-credential";
import type { DiagnosticsQueryName } from "@/lib/diagnostics-kql";
import type { DiagnosticsFailure, QueryResult, QueryTable } from "@/lib/diagnostics-shape";
import { withTimeout } from "@/lib/promise-timeout";
import { recordError } from "@/lib/telemetry";

// The ONE read seam from the app to its own telemetry: the Application Insights
// query API (docs/diagnostics.md). The resource is addressed by the
// `ApplicationId` inside the existing `APPLICATIONINSIGHTS_CONNECTION_STRING` — no
// new setting — and read with an Entra token (`buildMonitorCredential`; the app's
// identity needs `Reader` on the resource), never an API key.
//
// NEVER THROWS: every call resolves to the result table or a typed failure, so a
// failed section degrades to "unavailable" instead of crashing the page. Nothing
// secret is ever logged — not the connection string, not the request URL (it
// carries the app id), not a header or the token.
//
// SERVER-ONLY.

export type { QueryResult, QueryTable };

export const MONITOR_SCOPE = "https://api.applicationinsights.io/.default";
export const DIAGNOSTICS_QUERY_TIMEOUT_MS = 30_000;
// Same bound as the Foundry token (lib/llm/foundry-endpoint.ts): a cold `az` run
// plus the IMDS retry budget, never an unbounded stall.
export const MONITOR_TOKEN_TIMEOUT_MS = 15_000;

const QUERY_API = "https://api.applicationinsights.io/v1/apps";

/** The `ApplicationId` of a connection string (`Key=value;…`, keys case-insensitive). */
export function parseApplicationId(connectionString: string | undefined): string | undefined {
  if (!connectionString) return undefined;
  for (const pair of connectionString.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim().toLowerCase() !== "applicationid") continue;
    const value = pair.slice(eq + 1).trim();
    return value || undefined;
  }
  return undefined;
}

type Env = Readonly<Record<string, string | undefined>>;

function applicationId(env: Env = process.env): string | undefined {
  return parseApplicationId(env.APPLICATIONINSIGHTS_CONNECTION_STRING);
}

/** Whether this server can address an App Insights resource at all. */
export function diagnosticsConfigured(env: Env = process.env): boolean {
  return applicationId(env) !== undefined;
}

let tokenProvider: (() => Promise<string>) | undefined;

export function monitorBearerToken(): Promise<string> {
  tokenProvider ??= getBearerTokenProvider(buildMonitorCredential(), MONITOR_SCOPE);
  return withTimeout(tokenProvider(), "Entra token acquisition", MONITOR_TOKEN_TIMEOUT_MS);
}

function fail(
  name: DiagnosticsQueryName,
  failure: DiagnosticsFailure,
  error: unknown,
  status?: number,
): QueryResult {
  // Only the name + message of our own errors — never a request, header or token.
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error("diagnostics-client: query failed", {
    name,
    failure,
    status,
    detail: detail.slice(0, 200),
  });
  recordError(error, {
    "novedu.area": "diagnostics",
    "novedu.diagnostics.query": name,
    "novedu.diagnostics.failure": failure,
  });
  return { ok: false, failure };
}

function isTable(value: unknown): value is QueryTable {
  if (typeof value !== "object" || value === null) return false;
  const { columns, rows } = value as { columns?: unknown; rows?: unknown };
  return (
    Array.isArray(columns) &&
    columns.every(
      (c) =>
        typeof c === "object" && c !== null && typeof (c as { name?: unknown }).name === "string",
    ) &&
    Array.isArray(rows) &&
    rows.every(Array.isArray)
  );
}

function transportFailure(error: unknown): DiagnosticsFailure {
  const timedOut =
    error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
  return timedOut ? "timeout" : "error";
}

/** The API's error code + message, for the log (it echoes our KQL, never a credential). */
async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
    return `${String(body.error?.code ?? "")} ${String(body.error?.message ?? "")}`.trim();
  } catch {
    return "";
  }
}

/** Runs one query over `[from, to)`. Never throws. */
export async function runDiagnosticsQuery(
  name: DiagnosticsQueryName,
  query: string,
  window: { from: Date; to: Date },
): Promise<QueryResult> {
  const appId = applicationId();
  if (!appId) return { ok: false, failure: "not-configured" };

  let token: string;
  try {
    token = await monitorBearerToken();
  } catch (error) {
    return fail(name, "credential", error);
  }

  let res: Response;
  try {
    res = await fetch(`${QUERY_API}/${encodeURIComponent(appId)}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: `wait=${DIAGNOSTICS_QUERY_TIMEOUT_MS / 1000}`,
      },
      body: JSON.stringify({
        query,
        timespan: `${window.from.toISOString()}/${window.to.toISOString()}`,
      }),
      signal: AbortSignal.timeout(DIAGNOSTICS_QUERY_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    return fail(name, transportFailure(error), error);
  }

  if (!res.ok) {
    const failure = res.status === 401 || res.status === 403 ? "forbidden" : "error";
    const detail = await errorDetail(res);
    return fail(name, failure, new Error(`HTTP ${res.status} ${detail}`.trim()), res.status);
  }

  try {
    const body = (await res.json()) as { tables?: unknown };
    const table = Array.isArray(body.tables) ? body.tables[0] : undefined;
    if (!isTable(table)) return fail(name, "error", new Error("malformed query response"));
    return { ok: true, table };
  } catch (error) {
    // The 30 s signal also covers reading the body.
    return fail(name, transportFailure(error), error);
  }
}
