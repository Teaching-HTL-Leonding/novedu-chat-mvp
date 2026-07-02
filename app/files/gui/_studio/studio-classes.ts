// Shared studio recipes, used by BOTH file-editor.tsx and file-viewer.tsx so
// the editor and the read-only viewer can't drift apart. Pure class strings —
// safe to import from any "use client" studio component.

/** The studio page column: centered, capped width, vertical rhythm. */
export const STUDIO_COLUMN = "mx-auto flex max-w-240 flex-col gap-3 py-6";

/** The metadata <dl>: a two-column term/value grid that wraps long values. */
export const STUDIO_META_GRID =
  "my-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 [&_dd]:[overflow-wrap:anywhere] [&_dt]:font-semibold";

/** The raw-YAML <pre> panel: capped height, scrolls, wraps long lines. */
export const STUDIO_YAML_PANEL =
  "max-h-112 overflow-auto whitespace-pre-wrap rounded-lg border border-foreground/15 bg-foreground/5 p-4 text-sm [overflow-wrap:anywhere]";
