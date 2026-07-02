import type { ReactNode } from "react";

// The centered-card recipe: a full-page-centered tinted panel with a heading.
// Shared by Notice itself, the home code-entry panel (app/code-entry.tsx), and
// the health dashboard (app/health/health-dashboard.tsx) — consumers with their
// own inner structure compose the constants via cn() deltas.
export const CENTERED_CARD_WRAPPER = "flex flex-1 items-start justify-center px-5 py-12";
export const CENTERED_CARD =
  "w-full max-w-xl rounded-xl border border-foreground/15 bg-foreground/5 px-7 py-6";
export const CENTERED_CARD_HEADING = "mb-3 font-bold text-lg";

// A centered full-page notice (access denied, invalid share link, ...). Server
// component — pure presentation, no state.
export function Notice({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className={CENTERED_CARD_WRAPPER}>
      <div className={CENTERED_CARD}>
        <h2 className={CENTERED_CARD_HEADING}>{heading}</h2>
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    </section>
  );
}

export function AccessDenied() {
  return (
    <Notice heading="Access denied">
      <p>
        This page is only available to teachers. If you believe you should have access, contact your
        administrator.
      </p>
    </Notice>
  );
}
