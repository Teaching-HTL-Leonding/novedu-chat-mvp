import type { ReactNode } from "react";

// A centered full-page notice (access denied, invalid share link, ...). Server
// component — pure presentation, no state.
export function Notice({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-1 items-start justify-center px-5 py-12">
      <div className="w-full max-w-xl rounded-xl border border-foreground/15 bg-foreground/5 px-7 py-6">
        <h2 className="mb-3 font-bold text-lg">{heading}</h2>
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
