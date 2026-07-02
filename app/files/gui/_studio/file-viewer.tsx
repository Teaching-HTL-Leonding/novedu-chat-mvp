"use client";

import type { FileKind } from "@/lib/yaml-files";

// ============================================================================
// 👩‍💻 STUDENTS START HERE — this component is YOURS to build.
// ============================================================================
// Goal: a READ-ONLY version of your GUI that renders a YAML loaded from an
// external URL (e.g. GitHub), reached via the "View in GUI" button on the
// /validate-tutor page. The app-owned shell (app/files/gui/view/page.tsx) has
// already fetched the YAML and passes it as `initialContent` (or a `loadError`).
// No saving here. Full brief + API reference + examples:
//   docs/yaml-gui-student-contribution.md

export interface StudentFileViewerProps {
  /** The source YAML URL. Use it as the `baseUrl` to resolve referenced fragments. */
  url: string;
  /** "tutor" or "fragment" — the caller declared which it is (no auto-detection). */
  kind: FileKind;
  /** The fetched YAML, or null if it could not be loaded (see `loadError`). */
  initialContent: string | null;
  /** Set when the YAML could not be loaded — show it instead of content. */
  loadError?: string;
}

export function StudentFileViewer({
  url,
  kind,
  initialContent,
  loadError,
}: StudentFileViewerProps) {
  return (
    <div className="mx-auto flex max-w-240 flex-col gap-3 py-6">
      <h1 className="font-semibold text-2xl">GUI viewer — coming soon</h1>
      <p className="text-foreground/60">
        Read-only student GUI. Start in <code>app/files/gui/_studio/file-viewer.tsx</code>.
      </p>
      <dl className="my-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 [&_dd]:[overflow-wrap:anywhere] [&_dt]:font-semibold">
        <dt>kind</dt>
        <dd>
          <code>{kind}</code>
        </dd>
        <dt>url</dt>
        <dd>
          <code>{url || "—"}</code>
        </dd>
      </dl>
      {loadError ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800">
          {loadError}
        </p>
      ) : (
        <>
          <p className="text-foreground/60">Loaded YAML (what your GUI will parse):</p>
          <pre className="max-h-112 overflow-auto whitespace-pre-wrap rounded-lg border border-foreground/15 bg-foreground/5 p-4 text-sm [overflow-wrap:anywhere]">
            {initialContent}
          </pre>
        </>
      )}
    </div>
  );
}
