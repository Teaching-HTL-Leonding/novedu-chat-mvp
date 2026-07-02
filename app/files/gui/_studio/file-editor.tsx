"use client";

import type { FileKind } from "@/lib/yaml-files";
import { STUDIO_COLUMN, STUDIO_META_GRID, STUDIO_YAML_PANEL } from "./studio-classes";

// ============================================================================
// 👩‍💻 STUDENTS START HERE — this component is YOURS to build.
// ============================================================================
// Goal: replace this placeholder with a form-based GUI that edits a tutor or
// fragment YAML file (no hand-written YAML). The app-owned route shell
// (app/files/gui/edit/[...name]/page.tsx) loads the file and gives you these
// props; you build the UI and call the API in `@/lib/yaml-files` to validate and
// save. Full brief + API reference + examples:
//   docs/yaml-gui-student-contribution.md
//
// Rules of the road (see the brief): import ONLY from `@/lib/yaml-files`, your
// own `_studio/` files, and npm packages — never `@/components/*`, `@/app/*`, or
// other `@/lib/*`. Everything you write is a "use client" component.

export interface StudentFileEditorProps {
  /** The file's stable name (its identity across versions). */
  name: string;
  /** "tutor" or "fragment" — frozen at create time; you cannot change it here. */
  kind: FileKind;
  /** The active version's YAML, to parse into your form on mount. */
  initialContent: string;
  /**
   * The file's public URL. Use it as the `baseUrl` when loading a tutor's
   * referenced fragment files with `loadYamlFromUrlAction({ url, baseUrl })`.
   */
  publicUrl: string;
}

export function StudentFileEditor({
  name,
  kind,
  initialContent,
  publicUrl,
}: StudentFileEditorProps) {
  return (
    <div className={STUDIO_COLUMN}>
      <h1 className="font-semibold text-2xl">GUI editor — coming soon</h1>
      <p className="text-foreground/60">
        This is the student-built GUI. Start in <code>app/files/gui/_studio/file-editor.tsx</code>{" "}
        and read <code>docs/yaml-gui-student-contribution.md</code>.
      </p>
      <dl className={STUDIO_META_GRID}>
        <dt>name</dt>
        <dd>
          <code>{name}</code>
        </dd>
        <dt>kind</dt>
        <dd>
          <code>{kind}</code>
        </dd>
        <dt>publicUrl</dt>
        <dd>
          <code>{publicUrl}</code>
        </dd>
      </dl>
      <p className="text-foreground/60">Loaded YAML (what your GUI will parse):</p>
      <pre className={STUDIO_YAML_PANEL}>{initialContent}</pre>
    </div>
  );
}
