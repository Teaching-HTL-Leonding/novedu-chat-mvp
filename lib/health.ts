import { lookup } from "node:dns/promises";
import sql from "mssql";
import { mastra } from "@/app/mastra";
import { auth } from "@/auth";
import { getTeacherView, type TeacherView } from "@/lib/student-mode";

// Server-side health probes for the teacher-only /health page. Each probe is
// independent and never throws — failures become `ok: false` indicators so a
// broken dependency can't take the page down with it.

const TIMEOUT_MS = 8_000;

export interface HealthIndicator {
  ok: boolean;
  /** Human-readable outcome, shown next to the OK/Failed badge. */
  detail: string;
}

export interface HostInfo {
  fqdn: string | null;
  ips: string[];
  /** Set when the FQDN could not be determined or DNS resolution failed. */
  error?: string;
}

export interface HealthReport {
  db: HealthIndicator;
  scch: HealthIndicator;
  user: { name?: string | null; email?: string | null; preferredUsername?: string } | null;
  teacher: TeacherView;
  sqlHost: HostInfo;
  scchHost: HostInfo;
}

async function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} timed out after ${TIMEOUT_MS} ms`)),
      TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * A real round-trip through the Mastra storage: querying a thread by an id that
 * never exists still opens a pooled connection, authenticates and runs SQL —
 * exactly the path the tutor's memory uses.
 */
async function checkDb(): Promise<HealthIndicator> {
  const storage = mastra.getStorage();
  if (!storage) {
    return { ok: false, detail: "Not configured (MSSQL_CONNECTION_STRING is missing)." };
  }
  try {
    const memory = await withTimeout(Promise.resolve(storage.getStore("memory")), "Storage init");
    if (!memory) return { ok: false, detail: "Storage exposes no memory domain." };
    await withTimeout(memory.getThreadById({ threadId: "health-check-probe" }), "Database query");
    return { ok: true, detail: "Round-trip query succeeded." };
  } catch (e) {
    return { ok: false, detail: errorMessage(e) };
  }
}

/** Live model listing against the SCCH endpoint — the same call scch.ts makes. */
async function checkScch(): Promise<HealthIndicator> {
  const baseUrl = process.env.SCCH_BASE_URL;
  const apiKey = process.env.SCCH_API_KEY;
  if (!baseUrl || !apiKey) {
    return { ok: false, detail: "Not configured (SCCH_BASE_URL or SCCH_API_KEY is missing)." };
  }
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, detail: `Model listing failed (HTTP ${res.status}).` };
    const json = (await res.json()) as { data?: { id: string }[] };
    return { ok: true, detail: `${json.data?.length ?? 0} models available.` };
  } catch (e) {
    return { ok: false, detail: errorMessage(e) };
  }
}

/** DNS-resolve a host. Pure DNS — succeeds even when a firewall blocks TCP. */
async function resolveHost(fqdn: string | null, missingHint: string): Promise<HostInfo> {
  if (!fqdn) return { fqdn: null, ips: [], error: missingHint };
  try {
    const addresses = await withTimeout(lookup(fqdn, { all: true }), `DNS lookup for ${fqdn}`);
    return { fqdn, ips: addresses.map((a) => a.address) };
  } catch (e) {
    return { fqdn, ips: [], error: errorMessage(e) };
  }
}

function sqlServerFqdn(): string | null {
  const connectionString = process.env.MSSQL_CONNECTION_STRING;
  if (!connectionString) return null;
  try {
    return sql.ConnectionPool.parseConnectionString(connectionString).server ?? null;
  } catch {
    return null;
  }
}

function scchFqdn(): string | null {
  const baseUrl = process.env.SCCH_BASE_URL;
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return null;
  }
}

export async function collectHealth(): Promise<HealthReport> {
  const session = await auth();
  const [teacher, db, scch, sqlHost, scchHost] = await Promise.all([
    getTeacherView(),
    checkDb(),
    checkScch(),
    resolveHost(
      sqlServerFqdn(),
      "No SQL server host (MSSQL_CONNECTION_STRING missing or unparseable).",
    ),
    resolveHost(scchFqdn(), "No SCCH host (SCCH_BASE_URL missing or unparseable)."),
  ]);

  return {
    db,
    scch,
    user: session?.user
      ? {
          name: session.user.name,
          email: session.user.email,
          preferredUsername: session.user.preferredUsername,
        }
      : null,
    teacher,
    sqlHost,
    scchHost,
  };
}
