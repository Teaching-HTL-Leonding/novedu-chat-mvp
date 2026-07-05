import { Spinner } from "@/components/spinner";
import { DASHBOARD_CARD } from "./dashboard-ui";

// Suspense fallbacks for the dashboard sections: the card shell renders instantly
// while its async server section streams in, so the page never blocks on the DB.

function Loading() {
  return (
    <div
      className="flex h-72 items-center justify-center gap-2 text-foreground/60"
      role="status"
      aria-live="polite"
    >
      <Spinner className="size-5 border-[3px]" />
      <span>Loading…</span>
    </div>
  );
}

export function ChartSkeleton({ title }: { title: string }) {
  return (
    <section className={DASHBOARD_CARD}>
      <h2 className="mb-3 font-semibold text-sm">{title}</h2>
      <Loading />
    </section>
  );
}

export function BreakdownSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ChartSkeleton title="Tokens by category" />
      <ChartSkeleton title="Tokens by code" />
    </div>
  );
}

export function ModelsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ChartSkeleton title="Tokens by model" />
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="flex flex-wrap gap-4" role="status" aria-live="polite">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-[4.75rem] min-w-32 flex-1 rounded-lg border border-foreground/15 bg-card"
        />
      ))}
    </div>
  );
}
