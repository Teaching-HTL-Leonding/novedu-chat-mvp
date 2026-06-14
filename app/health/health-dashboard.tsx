"use client";

import { useEffect, useState } from "react";
import type { HealthIndicator, HostInfo } from "@/lib/health";
import type { BuildInfo } from "@/lib/version";
import styles from "./health.module.css";

// Client side of the health page. The page shell (including the user/teacher
// rows, which the server already knows) renders immediately; the four
// connectivity probes are fetched from /api/health in parallel and each row
// flips from "Checking…" to its result the moment its own response lands — a
// timing-out dependency never delays the others.

type Pending<T> = { status: "pending" } | { status: "done"; value: T };

function useProbe<T>(probe: string, onError: (message: string) => T): Pending<T> {
  const [state, setState] = useState<Pending<T>>({ status: "pending" });

  // `onError` is intentionally not a dependency: callers pass inline lambdas
  // (a new identity every render) and the probe never changes after mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    let cancelled = false;
    (async (): Promise<T> => {
      const res = await fetch(`/api/health?probe=${probe}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Probe request failed (HTTP ${res.status}).`);
      return (await res.json()) as T;
    })()
      .catch((e) => onError(e instanceof Error ? e.message : String(e)))
      .then((value) => {
        if (!cancelled) setState({ status: "done", value });
      });
    return () => {
      cancelled = true;
    };
  }, [probe]);

  return state;
}

function StatusValue({ state, testId }: { state: Pending<HealthIndicator>; testId: string }) {
  return (
    <dd className={styles.value} data-testid={testId}>
      {state.status === "pending" ? (
        <span className={`${styles.badge} ${styles.pending}`}>Checking…</span>
      ) : (
        <>
          <span className={`${styles.badge} ${state.value.ok ? styles.ok : styles.failed}`}>
            {state.value.ok ? "OK" : "Failed"}
          </span>
          {state.value.detail}
        </>
      )}
    </dd>
  );
}

function HostValue({ state, testId }: { state: Pending<HostInfo>; testId: string }) {
  if (state.status === "pending") {
    return (
      <dd className={styles.value} data-testid={testId}>
        <span className={`${styles.badge} ${styles.pending}`}>Checking…</span>
      </dd>
    );
  }
  const host = state.value;
  if (!host.fqdn) {
    return (
      <dd className={styles.value} data-testid={testId}>
        {host.error ?? "Unknown host."}
      </dd>
    );
  }
  return (
    <dd className={`${styles.value} ${styles.mono}`} data-testid={testId}>
      {host.fqdn} — {host.ips.length > 0 ? host.ips.join(", ") : (host.error ?? "no addresses")}
    </dd>
  );
}

export function HealthDashboard({
  userLabel,
  isTeacher,
  build,
}: {
  userLabel: string;
  isTeacher: boolean;
  build: BuildInfo;
}) {
  const indicatorError = (message: string): HealthIndicator => ({ ok: false, detail: message });
  const hostError = (message: string): HostInfo => ({ fqdn: null, ips: [], error: message });
  const db = useProbe("db", indicatorError);
  const scch = useProbe("scch", indicatorError);
  const sqlHost = useProbe("sql-host", hostError);
  const scchHost = useProbe("scch-host", hostError);

  return (
    <section className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.heading}>Health</h1>
        <dl className={styles.list}>
          <div className={styles.row}>
            <dt className={styles.term}>Build version</dt>
            <dd className={`${styles.value} ${styles.mono}`} data-testid="health-version">
              {build.version}
              {build.gitSha !== "unknown" ? ` (${build.gitSha.slice(0, 7)})` : ""}
              {build.builtAt !== "unknown" ? ` — built ${build.builtAt}` : ""}
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.term}>Database connection</dt>
            <StatusValue state={db} testId="health-db" />
          </div>
          <div className={styles.row}>
            <dt className={styles.term}>SCCH models</dt>
            <StatusValue state={scch} testId="health-scch" />
          </div>
          <div className={styles.row}>
            <dt className={styles.term}>Signed-in user</dt>
            <dd className={styles.value} data-testid="health-user">
              {userLabel}
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.term}>Teacher</dt>
            <dd className={styles.value} data-testid="health-teacher">
              {isTeacher ? "Yes" : "No"}
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.term}>SQL server host</dt>
            <HostValue state={sqlHost} testId="health-sql-host" />
          </div>
          <div className={styles.row}>
            <dt className={styles.term}>SCCH host</dt>
            <HostValue state={scchHost} testId="health-scch-host" />
          </div>
        </dl>
      </div>
    </section>
  );
}
