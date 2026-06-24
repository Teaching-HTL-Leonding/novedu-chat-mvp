"use client";

import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { type ChangeEvent, useMemo, useRef } from "react";
import styles from "./files.module.css";

// CodeMirror 6 editor (via @uiw/react-codemirror), shared by the `/files` create
// and edit forms and the writing student surface. Controlled: the parent owns the
// text. The language extension adds syntax highlighting — `yaml()` for hosted YAML
// files (the default) or `markdown()` for writing. The `/files` forms also show an
// Upload button that loads a local file's text into the editor; writing turns it
// off with `upload={false}` (a student writes prose in place, not by uploading).
//
// A "use client" component — CodeMirror touches the DOM and is created in an
// effect by the wrapper, so it hydrates fine without a dynamic import.

// Stable per-language extension references (created once) so CodeMirror doesn't
// reconfigure on every render; the editor picks one by the `language` prop.
// Markdown is prose, so it WRAPS long lines (`EditorView.lineWrapping` →
// `white-space: pre-wrap`) instead of scrolling horizontally; YAML keeps the
// default no-wrap so its indentation structure stays aligned.
const YAML_EXTENSIONS = [yaml()];
const MARKDOWN_EXTENSIONS = [markdown(), EditorView.lineWrapping];

export function YamlEditor({
  value,
  onChange,
  disabled,
  language = "yaml",
  upload = true,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  language?: "yaml" | "markdown";
  /** Show the "Upload file…" button (load a local file into the editor). The
   * `/files` forms keep it (default); the writing surface passes `false`. */
  upload?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extensions = useMemo(
    () => (language === "markdown" ? MARKDOWN_EXTENSIONS : YAML_EXTENSIONS),
    [language],
  );

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so picking the SAME file again still fires `change`.
    event.target.value = "";
    if (!file) return;
    onChange(await file.text());
  }

  return (
    <div className={styles.editorWrap}>
      {upload ? (
        <div className={styles.editorToolbar}>
          <button
            type="button"
            className={styles.uploadButton}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
          >
            Upload file…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml,.txt,text/yaml,application/yaml,text/plain"
            className={styles.hiddenFileInput}
            onChange={onUpload}
          />
          <span className={styles.editorHint}>Uploading replaces the editor contents.</span>
        </div>
      ) : null}
      <div className={styles.editorBox}>
        <CodeMirror
          value={value}
          height="420px"
          extensions={extensions}
          editable={!disabled}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
