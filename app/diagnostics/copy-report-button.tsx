"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDiagnosticsReport } from "@/lib/diagnostics-report";
import type { DiagnosticsDto } from "@/lib/diagnostics-shape";

// Puts the plain-text diagnostics report on the clipboard (docs/diagnostics.md).
// It formats the DTO the page already rendered — no second query — in the
// viewer's zone. Where the clipboard is refused (an insecure origin, a denied
// permission) the text appears in a pre-selected read-only field to copy by hand;
// `window.prompt` would truncate it.

export function CopyReportButton({ dto }: { dto: DiagnosticsDto }) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (fallback !== null) area.current?.select();
  }, [fallback]);

  async function copy() {
    const text = formatDiagnosticsReport(dto, {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    try {
      await navigator.clipboard.writeText(text);
      setFallback(null);
      setCopied(true);
    } catch {
      setFallback(text);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={copy} data-testid="diagnostics-copy-report">
          {copied ? "Copied" : "Copy report"}
        </Button>
        <span className="text-foreground/60 text-xs">
          A plain-text summary for a support case — provider names, statuses and timings only.
        </span>
      </div>
      {fallback !== null ? (
        <textarea
          ref={area}
          readOnly
          value={fallback}
          aria-label="Diagnostics report"
          className="h-64 w-full rounded-lg border border-foreground/25 bg-background p-2 font-mono text-xs"
        />
      ) : null}
    </div>
  );
}
