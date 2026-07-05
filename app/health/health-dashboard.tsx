"use client";

import { useEffect, useState } from "react";
import { CENTERED_CARD, CENTERED_CARD_HEADING, CENTERED_CARD_WRAPPER } from "@/components/notice";
import { Badge } from "@/components/ui/badge";
import type { HealthIndicator, HostInfo } from "@/lib/health";
import { cn } from "@/lib/utils";
import type { BuildInfo } from "@/lib/version";

// The probe rows' shared cell recipes (one dashboard, local constants). The
// badge pill sits before the detail text; rows collapse to one column below sm.
const ROW = "grid grid-cols-[11rem_auto] items-baseline gap-x-4 gap-y-1 max-sm:grid-cols-1";
const TERM = "font-semibold text-sm";
const VALUE = "wrap-anywhere text-sm leading-normal";
const PILL = "mr-2 rounded-full px-2 py-0.5 font-bold";

// Client side of the health page. The page shell (including the user/teacher
// rows, which the server already knows) renders immediately; the connectivity
// probes are fetched from /api/health in parallel and each row flips from
// "Checking…" to its result the moment its own response lands — a timing-out
// dependency never delays the others. The Azure Foundry rows exist only when the
// server says the provider is configured (an SCCH-only deployment shows no red
// Foundry indicator); mounting them is what starts their probes.

type Pending<T> = { status: "pending" } | { status: "done"; value: T };

const indicatorError = (message: string): HealthIndicator => ({ ok: false, detail: message });
const hostError = (message: string): HostInfo => ({ fqdn: null, ips: [], error: message });

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
    <dd className={VALUE} data-testid={testId}>
      {state.status === "pending" ? (
        <Badge className={PILL}>Checking…</Badge>
      ) : (
        <>
          <Badge tone={state.value.ok ? "green" : "red"} className={PILL}>
            {state.value.ok ? "OK" : "Failed"}
          </Badge>
          {state.value.detail}
        </>
      )}
    </dd>
  );
}

function HostValue({ state, testId }: { state: Pending<HostInfo>; testId: string }) {
  if (state.status === "pending") {
    return (
      <dd className={VALUE} data-testid={testId}>
        <Badge className={PILL}>Checking…</Badge>
      </dd>
    );
  }
  const host = state.value;
  if (!host.fqdn) {
    return (
      <dd className={VALUE} data-testid={testId}>
        {host.error ?? "Unknown host."}
      </dd>
    );
  }
  return (
    <dd className={`${VALUE} font-mono`} data-testid={testId}>
      {host.fqdn} — {host.ips.length > 0 ? host.ips.join(", ") : (host.error ?? "no addresses")}
    </dd>
  );
}

// Rendered only when Foundry is configured; its own component so the probe hooks
// run only in that case.
function FoundryStatusRow() {
  const foundry = useProbe("foundry", indicatorError);
  return (
    <div className={ROW}>
      <dt className={TERM}>Azure Foundry models</dt>
      <StatusValue state={foundry} testId="health-foundry" />
    </div>
  );
}

function FoundryHostRow() {
  const foundryHost = useProbe("foundry-host", hostError);
  return (
    <div className={ROW}>
      <dt className={TERM}>Foundry host</dt>
      <HostValue state={foundryHost} testId="health-foundry-host" />
    </div>
  );
}

export function HealthDashboard({
  userLabel,
  isTeacher,
  build,
  foundryConfigured,
}: {
  userLabel: string;
  isTeacher: boolean;
  build: BuildInfo;
  foundryConfigured: boolean;
}) {
  const db = useProbe("db", indicatorError);
  const scch = useProbe("scch", indicatorError);
  const sqlHost = useProbe("sql-host", hostError);
  const scchHost = useProbe("scch-host", hostError);

  return (
    <section className={cn(CENTERED_CARD_WRAPPER, "pt-6 pb-12")}>
      <div className={cn(CENTERED_CARD, "max-w-2xl")}>
        <h1 className={cn(CENTERED_CARD_HEADING, "mb-4")}>Health</h1>
        <dl className="flex flex-col gap-3.5">
          <div className={ROW}>
            <dt className={TERM}>Build version</dt>
            <dd className={`${VALUE} font-mono`} data-testid="health-version">
              {build.version}
              {build.gitSha !== "unknown" ? ` (${build.gitSha.slice(0, 7)})` : ""}
              {build.builtAt !== "unknown" ? ` — built ${build.builtAt}` : ""}
            </dd>
          </div>
          <div className={ROW}>
            <dt className={TERM}>Database connection</dt>
            <StatusValue state={db} testId="health-db" />
          </div>
          <div className={ROW}>
            <dt className={TERM}>SCCH models</dt>
            <StatusValue state={scch} testId="health-scch" />
          </div>
          {foundryConfigured && <FoundryStatusRow />}
          <div className={ROW}>
            <dt className={TERM}>Signed-in user</dt>
            <dd className={VALUE} data-testid="health-user">
              {userLabel}
            </dd>
          </div>
          <div className={ROW}>
            <dt className={TERM}>Teacher</dt>
            <dd className={VALUE} data-testid="health-teacher">
              {isTeacher ? "Yes" : "No"}
            </dd>
          </div>
          <div className={ROW}>
            <dt className={TERM}>SQL server host</dt>
            <HostValue state={sqlHost} testId="health-sql-host" />
          </div>
          <div className={ROW}>
            <dt className={TERM}>SCCH host</dt>
            <HostValue state={scchHost} testId="health-scch-host" />
          </div>
          {foundryConfigured && <FoundryHostRow />}
        </dl>
      </div>
    </section>
  );
}
