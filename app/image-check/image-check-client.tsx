"use client";

import { useState } from "react";
import { CopyIconButton } from "@/components/copy-icon-button";
import { Button } from "@/components/ui/button";
import {
  IMAGE_ACCEPT_WITH_EXTENSIONS,
  type ImageDiagnostics,
  type NormalizeImageResult,
  normalizeStudentImage,
} from "@/lib/image-normalize";
import { collectImageEnvironment, formatImageReport, verdictFor } from "@/lib/image-report";

// The client half of /image-check. Deliberately a thin shell over the SAME
// `normalizeStudentImage` the chat calls, with NO option overrides: a parallel
// re-implementation would eventually disagree with production, and a diagnostics
// tool that lies is worse than none.

interface Checked {
  /** The picked file's name — shown on screen only, never in the copyable report. */
  name: string;
  diagnostics: ImageDiagnostics;
  /** Data URL of the normalized result, so the visitor can see what the model would see. */
  previewDataUrl?: string;
  message?: string;
}

const ROW = "rounded-lg border border-foreground/15 bg-card p-4";
const LABEL = "text-foreground/55 text-xs uppercase tracking-wide";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={LABEL}>{label}</span>
      <span className="wrap-anywhere font-mono text-sm">{value}</span>
    </div>
  );
}

export function ImageCheckClient({ appVersion }: { appVersion: string }) {
  const [checked, setChecked] = useState<Checked[]>([]);
  const [busy, setBusy] = useState(false);
  const [timestamp, setTimestamp] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    const results: Checked[] = [];
    for (const file of Array.from(files)) {
      const result: NormalizeImageResult = await normalizeStudentImage(file);
      results.push({
        name: file.name,
        diagnostics: result.diagnostics,
        ...(result.ok ? { previewDataUrl: result.dataUrl } : { message: result.message }),
      });
    }
    setChecked(results);
    setTimestamp(new Date().toISOString());
    setBusy(false);
  }

  const report =
    timestamp === null
      ? ""
      : formatImageReport({
          files: checked.map((entry) => entry.diagnostics),
          environment: collectImageEnvironment(),
          origin: "image check page",
          appVersion,
          timestamp,
        });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-bold text-2xl">Photo check</h1>
        <p className="text-foreground/70">
          If a photo did not work in an activity, pick it here. This page shows what the photo
          really is and how it would be prepared before a tutor sees it, then gives you a short text
          you can send to your teacher.
        </p>
        <p className="rounded-lg border border-foreground/15 bg-foreground/5 px-3 py-2 text-sm">
          Your photo stays on this device. It is opened and measured in your browser — it is never
          uploaded, and the text you copy describes the file and this browser only, never the
          picture itself.
        </p>
      </header>

      <div>
        <label className="inline-flex cursor-pointer">
          <input
            accept={IMAGE_ACCEPT_WITH_EXTENSIONS}
            className="sr-only"
            multiple
            onChange={(event) => {
              void handleFiles(event.target.files);
              // Allow re-picking the same file after a change of settings.
              event.target.value = "";
            }}
            type="file"
          />
          <span className="rounded-md border border-foreground/25 px-4 py-2 text-sm">
            {busy ? "Checking…" : "Choose a photo…"}
          </span>
        </label>
      </div>

      {checked.map((entry) => {
        const d = entry.diagnostics;
        return (
          <section className={ROW} key={`${entry.name}-${d.rawBytes}`}>
            <h2 className="wrap-anywhere mb-3 font-semibold">{entry.name}</h2>
            <p
              className={
                d.failureReason === undefined
                  ? "mb-4 text-sm text-success"
                  : "mb-4 text-destructive text-sm"
              }
            >
              {verdictFor(d)}
            </p>
            {entry.message ? <p className="mb-4 text-sm">{entry.message}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact label="File type reported" value={d.reportedType || "(none given)"} />
              <Fact label="Actual format" value={d.sniffedContainer} />
              <Fact label="Size" value={`${(d.rawBytes / (1024 * 1024)).toFixed(2)} MB`} />
              <Fact
                label="Dimensions"
                value={
                  d.decodedWidth === undefined
                    ? `could not open (${d.decodeError ?? "unknown"})`
                    : `${d.decodedWidth} × ${d.decodedHeight}`
                }
              />
              <Fact
                label="Rotation tag"
                value={
                  d.exifOrientation === undefined
                    ? d.hasExif
                      ? "none (other photo data present)"
                      : "none"
                    : `${d.exifOrientation}${d.exifOrientation === 1 ? "" : " (upright only after correction)"}`
                }
              />
              <Fact
                label="Prepared result"
                value={
                  d.outputBytes === undefined
                    ? "—"
                    : `${d.outputWidth} × ${d.outputHeight}, ${(d.outputBytes / 1024).toFixed(0)} KB${d.passedThrough ? " (unchanged)" : ""}`
                }
              />
            </div>
            {entry.previewDataUrl ? (
              <figure className="mt-4">
                <figcaption className={`${LABEL} mb-1`}>What the tutor would see</figcaption>
                {/* Not next/image: this is a local data URL produced in the browser. */}
                {/* biome-ignore lint/performance/noImgElement: client-side data URL, no loader applies */}
                <img
                  alt="Your file, as an activity would receive it"
                  className="max-h-80 w-auto rounded-md border border-foreground/15"
                  src={entry.previewDataUrl}
                />
              </figure>
            ) : null}
          </section>
        );
      })}

      {report ? (
        <section className={ROW}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="font-semibold">Send this to your teacher</h2>
            <CopyIconButton
              label="Copy the details"
              promptLabel="Copy the details:"
              text={report}
            />
          </div>
          <pre className="max-h-96 overflow-auto rounded-md border border-foreground/15 bg-background p-3 font-mono text-xs">
            {report}
          </pre>
        </section>
      ) : null}

      {checked.length > 0 ? (
        <div>
          <Button
            onClick={() => {
              setChecked([]);
              setTimestamp(null);
            }}
            variant="outline"
          >
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}
