"use client";

import { useState } from "react";
import { RotateCcwIcon } from "@/components/icons";
import { Spinner } from "@/components/spinner";
import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";
import { FieldError } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { startNewTutorThread } from "@/lib/tutor-actions";

// The tutor chat's "start over" control: abandon this conversation and continue
// in a fresh thread. Clearing is confirmed first — a student can lose a long
// tutoring session with one mis-click, and there is no undo.
//
// The new thread comes from the server (lib/tutor-actions.ts): its ownership
// token is an HMAC the browser cannot compute, and a client-side transcript wipe
// would leave the same threadId — whose last 40 messages the tutor still recalls.
// On success the caller swaps the pair in and the chat provider remounts; a
// failure keeps the dialog open with its message and leaves the chat untouched.
//
// The icon is decorative (see components/icons.tsx): `aria-label` carries the
// accessible name and `title` doubles as the resting tooltip, the same pairing
// app/images/view-image-button.tsx uses — the app has no tooltip component.

export function StartOverButton({
  code,
  onStarted,
}: {
  /** The tutor code — re-verified server-side before a thread is minted. */
  code: string;
  /** Hands the caller the fresh thread to swap into the chat surface. */
  onStarted: (thread: { threadId: string; threadToken: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    // Reset so reopening starts clean (a stale error must not greet the student).
    setPending(false);
    setError(null);
  }

  async function onConfirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await startNewTutorThread({ code });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    close();
    onStarted({ threadId: result.threadId, threadToken: result.threadToken });
  }

  return (
    <>
      <IconButton
        aria-label="Start over"
        title="Start over"
        className="text-foreground/70"
        onClick={() => setOpen(true)}
      >
        <RotateCcwIcon />
      </IconButton>

      <DialogShell
        open={open}
        onClose={close}
        title="Start over?"
        // size="fit" shrink-wraps the short confirmation and centers it (see
        // the variant in components/ui/dialog-shell.tsx for why h-auto can't).
        size="fit"
        className="w-[min(32rem,92vw)]"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <p>
            Your conversation so far will be cleared and the tutor starts fresh — it will not
            remember what you have discussed. Your teacher can still see the earlier conversation.
          </p>

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onConfirm} disabled={pending}>
              {pending ? (
                <>
                  <Spinner /> Starting over…
                </>
              ) : (
                "Start over"
              )}
            </Button>
          </div>

          {error ? <FieldError>{error}</FieldError> : null}
        </div>
      </DialogShell>
    </>
  );
}
