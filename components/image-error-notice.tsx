"use client";

import { useMemo, useState } from "react";
import { CopyIconButton } from "@/components/copy-icon-button";
import { Button } from "@/components/ui/button";
import type { ImageDiagnostics } from "@/lib/image-normalize";
import { collectImageEnvironment, formatImageReport } from "@/lib/image-report";
import { cn } from "@/lib/utils";

// The dismissible notice shown when a picked photo could not be sent — the SAME
// component for the tutor chat and the quiz's photo answers, so the wording, the
// diagnostics disclosure and the copy affordance cannot drift apart.
//
// The disclosure exists because a photo bug is almost impossible to describe
// verbally: what matters is the container the bytes actually are, whether the
// platform reported a MIME type at all, and what the decoder said. All of that is
// in hand at the moment of failure, in the very document that failed — asking the
// student to re-pick the file somewhere else loses most of them. `/image-check`
// is still linked, for the other case: a photo that uploads fine and is merely
// misread, which produces no error to expand.

export function ImageErrorNotice({
  messages,
  diagnostics,
  origin,
  onDismiss,
  className,
}: {
  /** One student-facing sentence per rejected file. */
  messages: string[];
  /** What we learned about each rejected file; drives the copyable report. */
  diagnostics: ImageDiagnostics[];
  /** Which surface produced this — recorded in the report. */
  origin: string;
  onDismiss: () => void;
  /** Layout delta (margins, shrink) from the surface that mounts it. */
  className?: string;
}) {
  // Captured once, so the report is stable while the notice is open rather than
  // changing under the student between reading it and copying it.
  const [timestamp] = useState(() => new Date().toISOString());
  const report = useMemo(
    () =>
      formatImageReport({
        files: diagnostics,
        environment: collectImageEnvironment(),
        origin,
        timestamp,
      }),
    [diagnostics, origin, timestamp],
  );

  return (
    <div
      className={cn(
        "rounded-lg border border-destructive/45 bg-destructive/10 px-3 py-2 text-sm",
        className,
      )}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className="wrap-anywhere flex min-w-0 flex-1 flex-col gap-1">
          {messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>

      {diagnostics.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-foreground/70">Details for your teacher</summary>
          <p className="mt-2 text-foreground/70">
            Copy this and send it to your teacher — it describes the photo and this browser, and
            contains no part of the picture itself. You can also check another photo on the{" "}
            {/* A plain anchor, not next/link: it opens a new tab, so client-side
                navigation buys nothing, and the chat surfaces stay free of the
                router dependency. */}
            <a className="underline" href="/image-check" rel="noreferrer" target="_blank">
              photo check page
            </a>
            .
          </p>
          <div className="mt-2 flex items-start gap-2">
            <pre className="max-h-64 min-w-0 flex-1 overflow-auto rounded-md border border-foreground/15 bg-background p-2 font-mono text-xs">
              {report}
            </pre>
            <CopyIconButton
              label="Copy the details"
              promptLabel="Copy the details:"
              text={report}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}
