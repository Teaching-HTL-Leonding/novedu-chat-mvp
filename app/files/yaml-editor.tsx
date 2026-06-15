"use client";

import { yaml } from "@codemirror/lang-yaml";
import CodeMirror from "@uiw/react-codemirror";
import { type ChangeEvent, useRef } from "react";
import styles from "./files.module.css";

// CodeMirror 6 YAML editor (via @uiw/react-codemirror), shared by the create and
// edit forms. Controlled: the parent owns the text. The `yaml()` extension adds
// YAML syntax highlighting. Plus an Upload button that loads a local file's text
// into the editor (drag-and-drop is a deferred stretch goal).
//
// A "use client" component — CodeMirror touches the DOM and is created in an
// effect by the wrapper, so it hydrates fine without a dynamic import.

// Stable extension reference (created once) so CodeMirror doesn't reconfigure on
// every render.
const EXTENSIONS = [yaml()];

export function YamlEditor({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so picking the SAME file again still fires `change`.
    event.target.value = "";
    if (!file) return;
    onChange(await file.text());
  }

  return (
    <div className={styles.editorWrap}>
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
      <div className={styles.editorBox}>
        <CodeMirror
          value={value}
          height="420px"
          extensions={EXTENSIONS}
          editable={!disabled}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
