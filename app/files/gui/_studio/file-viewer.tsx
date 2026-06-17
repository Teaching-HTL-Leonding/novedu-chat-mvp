"use client";

import type { FileKind } from "@/lib/yaml-files";
import styles from "./studio.module.css";

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
    <div className={styles.placeholder}>
      <h1 className={styles.heading}>GUI viewer — coming soon</h1>
      <p className={styles.lead}>
        Read-only student GUI. Start in <code>app/files/gui/_studio/file-viewer.tsx</code>.
      </p>
      <dl className={styles.props}>
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
        <p className={styles.error}>{loadError}</p>
      ) : (
        <>
          <p className={styles.lead}>Loaded YAML (what your GUI will parse):</p>
          <pre className={styles.code}>{initialContent}</pre>
        </>
      )}
    </div>
  );
}
