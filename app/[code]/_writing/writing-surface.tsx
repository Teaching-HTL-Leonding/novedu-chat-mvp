"use client";

import { useEffect, useRef, useState } from "react";
import { saveWriting } from "@/lib/writing-actions";
import type { WritingPublic } from "@/lib/writing-types";
import { YamlEditor } from "../../files/yaml-editor";
import { MarkdownRenderer } from "../../markdown-renderer";
import { WritingChat } from "./writing-chat";
import styles from "./writing-surface.module.css";

// The student-facing writing surface: a split screen with the Markdown editor on
// the left and a collapsible feedback chat on the right. The editor buffer is the
// single source of truth for the student's draft — it is mirrored into a ref the
// chat's read-only `getCurrentText` tool reads, so the agent can see the live
// draft without it ever being typed into the chat.
//
// Saving (only for an ATTRIBUTED activity — anonymous gets no Save button, no
// prefill, no unsaved-changes warning) goes through the `saveWriting` action,
// which re-verifies the code + the session oid and re-rejects anonymous codes
// server-side. The "Read formatted" lightbox renders the current buffer through
// the sanitized MarkdownRenderer (no rehype-raw) — student Markdown is untrusted.

export function WritingSurface({
  code,
  threadId,
  runtimeHeaders,
  writing,
  anonymous,
  initialText,
}: {
  code: string;
  threadId: string;
  runtimeHeaders: Record<string, string>;
  writing: WritingPublic;
  /** Read LIVE from the YAML server-side. `true` disables saving + prefill. */
  anonymous: boolean;
  /** The student's previously saved text, or "" (always "" when anonymous). */
  initialText: string;
}) {
  // The editor buffer. For an attributed activity it starts from the saved text;
  // otherwise from the activity's optional placeholder.
  const [buffer, setBuffer] = useState(() => initialText || writing.placeholder || "");
  // The chat's read-only tool reads the LIVE buffer through this ref (never a
  // stale closure). Kept in sync on every edit below.
  const currentTextRef = useRef(buffer);

  // Save baseline: the dirty flag is buffer !== lastSaved. Seeded from the same
  // initial buffer value so an untouched prefilled placeholder is not counted as
  // a pending change. Anonymous activities never save, so they are never dirty
  // (no beforeunload warning).
  const [lastSaved, setLastSaved] = useState(() => initialText || writing.placeholder || "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [chatOpen, setChatOpen] = useState(true);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (previewOpen && !dialog.open) dialog.showModal();
    else if (!previewOpen && dialog.open) dialog.close();
  }, [previewOpen]);

  const dirty = !anonymous && buffer !== lastSaved;

  // Warn before leaving with unsaved changes — only for an attributed activity.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Some browsers require a returnValue to show the prompt.
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function onEdit(value: string) {
    setBuffer(value);
    currentTextRef.current = value;
    setSaveError(null);
  }

  async function onSave() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    const res = await saveWriting({ code, text: buffer });
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.message);
      return;
    }
    // The action trims the text before storing; mirror that so the dirty flag
    // settles instead of staying dirty over trailing whitespace.
    setLastSaved(buffer.trim());
  }

  return (
    <div className={styles.surface}>
      <div className={`${styles.split} ${chatOpen ? "" : styles.chatCollapsed}`}>
        <section className={styles.editorPane}>
          <div className={styles.editorToolbar}>
            {writing.title ? <h1 className={styles.title}>{writing.title}</h1> : null}
            <div className={styles.editorActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setPreviewOpen(true)}
              >
                Read formatted
              </button>
              {!anonymous ? (
                <button
                  type="button"
                  className={styles.button}
                  onClick={onSave}
                  disabled={saving || !dirty}
                >
                  {saving ? "Saving…" : dirty ? "Save" : "Saved"}
                </button>
              ) : null}
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setChatOpen((open) => !open)}
                aria-expanded={chatOpen}
              >
                {chatOpen ? "Hide assistant" : "Show assistant"}
              </button>
            </div>
          </div>
          {writing.description ? (
            <div className={styles.description}>
              <MarkdownRenderer content={writing.description} />
            </div>
          ) : null}
          {saveError ? (
            <p className={styles.error} role="alert">
              {saveError}
            </p>
          ) : null}
          <YamlEditor value={buffer} onChange={onEdit} language="markdown" upload={false} />
        </section>

        {chatOpen ? (
          <aside className={styles.chatPane}>
            <WritingChat
              code={code}
              threadId={threadId}
              runtimeHeaders={runtimeHeaders}
              currentTextRef={currentTextRef}
            />
          </aside>
        ) : null}
      </div>

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-dismiss is mouse-only; the native <dialog> already closes on Escape (onClose), and a Close button covers keyboard users. */}
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onClose={() => setPreviewOpen(false)}
        // Clicking the backdrop (the dialog element itself, not its content) closes it.
        onClick={(event) => {
          if (event.target === dialogRef.current) setPreviewOpen(false);
        }}
      >
        <div className={styles.dialogInner}>
          <div className={styles.dialogHeader}>
            <h3 className={styles.dialogHeading}>Formatted preview</h3>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setPreviewOpen(false)}
            >
              Close
            </button>
          </div>
          <div className={styles.dialogBody}>
            <MarkdownRenderer content={buffer} />
          </div>
        </div>
      </dialog>
    </div>
  );
}
