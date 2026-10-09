"use client";

import { useState } from "react";
import { HistoryIcon } from "@/components/icons";
import { Spinner } from "@/components/spinner";
import { Button } from "@/components/ui/button";
import { DIALOG_BODY, DialogShell } from "@/components/ui/dialog-shell";
import { FieldError } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { formatConversationTime } from "@/lib/conversation-time";
import { listTutorThreads, openTutorThread } from "@/lib/tutor-actions";
import type { TutorThreadSummary } from "@/lib/tutor-history-types";
import { cn } from "@/lib/utils";

// "Previous conversations" — a per-user tutor's history (rendered only when the
// code's frozen AND live `anonymous` flags are both false; lib/tutor-history-gate.ts).
// The list is the session user's own conversations with THIS tutor code, fetched
// fresh each time the dialog opens (`listTutorThreads`). Picking one asks the
// server for its token (`openTutorThread`, which re-checks ownership) and hands
// the pair to the chat, which switches to that thread; its messages arrive with
// the chat's `connect`. Rows are real buttons (the student-conversations
// pattern), so keyboard and focus come from the native <dialog> and the buttons.

type ListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; threads: TutorThreadSummary[]; more: boolean };

export function PreviousConversationsButton({
  code,
  currentThreadId,
  onOpened,
}: {
  /** The tutor code — every action re-verifies it server-side. */
  code: string;
  /** The chat's current thread: marked "Current" and not openable. */
  currentThreadId: string;
  /** Hands the caller the reopened thread to swap into the chat surface. */
  onOpened: (thread: { threadId: string; threadToken: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ListState>({ status: "loading" });
  // The row being opened (spinner there, every other row disabled).
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  async function load() {
    setList({ status: "loading" });
    try {
      const result = await listTutorThreads({ code });
      setList(
        result.ok
          ? { status: "ready", threads: result.threads, more: result.more }
          : { status: "error" },
      );
    } catch {
      setList({ status: "error" });
    }
  }

  function show() {
    setOpen(true);
    setOpening(null);
    setOpenError(null);
    void load();
  }

  async function reopen(threadId: string) {
    if (opening) return;
    setOpening(threadId);
    setOpenError(null);
    let result: Awaited<ReturnType<typeof openTutorThread>>;
    try {
      result = await openTutorThread({ code, threadId });
    } catch {
      result = { ok: false, message: "This conversation can't be opened." };
    }
    setOpening(null);
    if (!result.ok) {
      setOpenError(result.message);
      return;
    }
    setOpen(false);
    onOpened({ threadId, threadToken: result.threadToken });
  }

  const now = new Date();

  return (
    <>
      <IconButton
        aria-label="Previous conversations"
        title="Previous conversations"
        className="text-foreground/70"
        onClick={show}
      >
        <HistoryIcon />
      </IconButton>

      <DialogShell
        open={open}
        onClose={() => setOpen(false)}
        title="Previous conversations"
        size="fit"
        className="w-[min(36rem,92vw)]"
      >
        <div className={cn(DIALOG_BODY, "flex flex-col gap-3")}>
          <p className="text-foreground/70 text-sm">
            This tutor is not anonymous: your teacher can see your conversations and that they are
            yours.
          </p>

          {openError ? <FieldError>{openError}</FieldError> : null}

          {list.status === "loading" ? (
            <p className="flex items-center gap-2 text-foreground/70">
              <Spinner /> Loading your conversations…
            </p>
          ) : list.status === "error" ? (
            <div className="flex flex-col items-start gap-2">
              <p>Couldn't load your conversations.</p>
              <Button variant="outline" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : list.threads.length === 0 ? (
            <p className="text-foreground/70">No earlier conversations with this tutor yet.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {list.threads.map((thread) => {
                  const current = thread.threadId === currentThreadId;
                  return (
                    <li key={thread.threadId}>
                      <button
                        type="button"
                        className="flex w-full cursor-pointer flex-col gap-1 rounded-lg border border-foreground/15 bg-background px-3.5 py-2.5 text-left text-sm hover:bg-foreground/5 disabled:cursor-default disabled:hover:bg-background"
                        data-testid="previous-conversation"
                        disabled={current || opening !== null}
                        aria-busy={opening === thread.threadId}
                        onClick={() => void reopen(thread.threadId)}
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-semibold">
                            {formatConversationTime(thread.lastActivityAt, now)}
                          </span>
                          {current ? (
                            <span className="rounded-full border border-foreground/20 px-2 py-0.5 text-foreground/70 text-xs">
                              Current
                            </span>
                          ) : null}
                          {opening === thread.threadId ? <Spinner /> : null}
                          <span className="ml-auto whitespace-nowrap text-foreground/65">
                            {thread.userMessageCount}{" "}
                            {thread.userMessageCount === 1 ? "message" : "messages"}
                          </span>
                        </span>
                        <span className="line-clamp-2 text-foreground/80">
                          {thread.preview.kind === "photo"
                            ? "📷 Photo"
                            : thread.preview.text || "(no text)"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {list.more ? (
                <p className="text-foreground/65 text-sm">
                  Showing your 50 most recent conversations.
                </p>
              ) : null}
            </>
          )}
        </div>
      </DialogShell>
    </>
  );
}
