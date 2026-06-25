"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeHeaders } from "@/lib/runtime-headers";
import { saveWriting } from "@/lib/writing-actions";
import type { WritingPublic } from "@/lib/writing-types";
import { YamlEditor } from "../../files/yaml-editor";
import { MarkdownRenderer } from "../../markdown-renderer";
import { WritingChat } from "./writing-chat";
import styles from "./writing-surface.module.css";

// The student-facing writing surface: a split screen filling the viewport, with
// the Markdown editor on the left and a collapsible feedback chat on the right.
// The two columns are separated by a vertical bar that both toggles the assistant
// (the ›/‹ button) and resizes the split (drag). The editor buffer is the single
// source of truth for the student's draft — mirrored into a ref the chat's
// read-only `getCurrentText` tool reads, so the agent sees the live draft without
// it ever being typed into the chat.
//
// Saving (only for an ATTRIBUTED activity — anonymous gets no Save button, no
// prefill, no unsaved-changes warning) goes through the `saveWriting` action,
// which re-verifies the code + the session oid and re-rejects anonymous codes
// server-side. Both lightboxes (the formatted draft preview and the full activity
// prompt) render Markdown through the sanitized MarkdownRenderer (no rehype-raw) —
// student Markdown is untrusted.

// Collapse the activity prompt to a teaser past this many characters; the "more"
// link opens the full text in a lightbox. Keeps vertical space for the editor.
const DESCRIPTION_PREVIEW_CHARS = 250;
// Drag-resize bounds for the editor column (fraction of the split width), so
// neither column can be dragged unusably narrow.
const MIN_EDITOR_FRACTION = 0.25;
const MAX_EDITOR_FRACTION = 0.75;
// At/above this the editor and chat sit side by side with the divider (toggle +
// drag-resize). Below it they stack vertically, each with a min height, and the
// divider is gone — no collapse, no resize. Must match the CSS breakpoint
// (`max-width: 47.99rem` there, complementary to this `min-width: 48rem`).
const SIDE_BY_SIDE_QUERY = "(min-width: 48rem)";

// A modal lightbox shared by the formatted-draft preview and the full-prompt
// view. Drives the native <dialog> from React state (showModal/close) and closes
// on Escape (the dialog's onClose), the Close button, or a backdrop click.
function Lightbox({
  open,
  heading,
  onClose,
  children,
}: {
  open: boolean;
  heading: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-dismiss is mouse-only; the native <dialog> already closes on Escape (onClose), and the Close button covers keyboard users.
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      // Clicking the backdrop (the dialog element itself, not its content) closes it.
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className={styles.dialogInner}>
        <div className={styles.dialogHeader}>
          <h3 className={styles.dialogHeading}>{heading}</h3>
          <button type="button" className={styles.secondaryButton} onClick={onClose}>
            Close
          </button>
        </div>
        <div className={styles.dialogBody}>{children}</div>
      </div>
    </dialog>
  );
}

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
  runtimeHeaders: RuntimeHeaders;
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);

  // Side-by-side vs stacked layout (tracks the CSS breakpoint). Below it the
  // divider is gone, so the chat must always render — otherwise a chat collapsed
  // on a wide screen would be stranded after shrinking to a narrow one, with no
  // toggle to bring it back.
  const [sideBySide, setSideBySide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia(SIDE_BY_SIDE_QUERY);
    const sync = () => setSideBySide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Editor share of the split width; the chat takes the rest. Adjusted by
  // dragging the divider (side-by-side layout only).
  const [editorFraction, setEditorFraction] = useState(0.5);
  const splitRef = useRef<HTMLDivElement>(null);

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

  // Drag the divider to resize the columns. Mouse-only progressive enhancement
  // on top of the toggle: pointer-move updates the editor's width fraction while
  // the button is held, clamped so both columns stay usable. Skipped when the
  // chat is collapsed or the layout has stacked (no horizontal split to resize).
  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!chatOpen) return;
      if (!window.matchMedia(SIDE_BY_SIDE_QUERY).matches) return;
      const split = splitRef.current;
      if (!split) return;
      event.preventDefault();
      const rect = split.getBoundingClientRect();

      function onMove(moveEvent: PointerEvent) {
        const fraction = (moveEvent.clientX - rect.left) / rect.width;
        setEditorFraction(Math.min(MAX_EDITOR_FRACTION, Math.max(MIN_EDITOR_FRACTION, fraction)));
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      }
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [chatOpen],
  );

  const longDescription =
    !!writing.description && writing.description.length > DESCRIPTION_PREVIEW_CHARS;

  return (
    <div className={styles.surface}>
      <div
        ref={splitRef}
        className={`${styles.split} ${chatOpen ? "" : styles.chatCollapsed}`}
        // The editor/chat width split; ignored by the stacked (narrow) layout.
        // Scaled to whole numbers summing to 100 so that when one column is
        // collapsed the other still has flex-grow >= 1 and fills ALL the freed
        // space — grow factors summing to < 1 leave the remainder empty.
        style={
          {
            "--editor-grow": Math.round(editorFraction * 100),
            "--chat-grow": Math.round((1 - editorFraction) * 100),
          } as React.CSSProperties
        }
      >
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
            </div>
          </div>
          {writing.description ? (
            <div className={styles.description}>
              {longDescription ? (
                <>
                  <MarkdownRenderer
                    content={`${writing.description.slice(0, DESCRIPTION_PREVIEW_CHARS).trimEnd()}…`}
                  />
                  <button
                    type="button"
                    className={styles.moreLink}
                    onClick={() => setDescriptionOpen(true)}
                  >
                    more
                  </button>
                </>
              ) : (
                <MarkdownRenderer content={writing.description} />
              )}
            </div>
          ) : null}
          {saveError ? (
            <p className={styles.error} role="alert">
              {saveError}
            </p>
          ) : null}
          <div className={styles.editorHost}>
            <YamlEditor value={buffer} onChange={onEdit} language="markdown" upload={false} fill />
          </div>
        </section>

        {/* The divider: drag to resize, and the ›/‹ button toggles the assistant.
            It stays visible when the chat is collapsed (then showing ‹ to reopen).
            The drag is a mouse-only enhancement; the nested button is the
            accessible control, so the bar carries no role of its own. Only in the
            side-by-side layout — stacked has no collapse/resize. */}
        {sideBySide ? (
          <div className={styles.divider} onPointerDown={onResizePointerDown}>
            <button
              type="button"
              className={styles.dividerToggle}
              // Toggling must not also start a resize drag.
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setChatOpen((open) => !open)}
              aria-expanded={chatOpen}
              aria-label={chatOpen ? "Hide assistant" : "Show assistant"}
            >
              <span aria-hidden="true">{chatOpen ? "›" : "‹"}</span>
            </button>
          </div>
        ) : null}

        {/* Stacked layout always shows the chat (no toggle to reopen it). */}
        {!sideBySide || chatOpen ? (
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

      <Lightbox
        open={previewOpen}
        heading="Formatted preview"
        onClose={() => setPreviewOpen(false)}
      >
        <MarkdownRenderer content={buffer} />
      </Lightbox>

      {longDescription ? (
        <Lightbox
          open={descriptionOpen}
          heading={writing.title ?? "Activity prompt"}
          onClose={() => setDescriptionOpen(false)}
        >
          <MarkdownRenderer content={writing.description ?? ""} />
        </Lightbox>
      ) : null}
    </div>
  );
}
