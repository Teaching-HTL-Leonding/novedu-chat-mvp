import { cn } from "@/lib/utils";

// Inline spinner for "busy" buttons (e.g. the filter's Apply while a navigation
// is pending). Decorative — the surrounding control carries the accessible state
// (`disabled` / `aria-busy`). Sized in em so it scales with the button text and
// borrows currentColor so it shows correctly on any background. Reduced motion
// slows the spin instead of freezing it (a stopped spinner reads as "done").
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-[0.9em] animate-spin rounded-full border-2 border-current/30 border-t-current align-[-0.1em] motion-reduce:[animation-duration:1.6s]",
        className,
      )}
      aria-hidden="true"
    />
  );
}

// Centered "the page is loading" panel for route-level `loading.tsx` fallbacks —
// shown by Next while a slow server segment renders (initial open / link click).
export function LoadingPanel({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="flex flex-1 items-center justify-center gap-2.5 px-5 py-10 text-foreground/70"
      role="status"
      aria-live="polite"
    >
      <Spinner className="size-5 border-[3px]" />
      <span>{label}</span>
    </div>
  );
}
