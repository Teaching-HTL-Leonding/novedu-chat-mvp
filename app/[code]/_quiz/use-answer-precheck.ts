"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { precheckAnswer } from "@/lib/quiz-actions";
import { PRECHECK_DEBOUNCE_MS, PRECHECK_MAX_ANSWER_CHARS } from "@/lib/quiz-precheck";
import type { PrecheckVerdict } from "@/lib/quiz-types";

// The live pre-check's CLIENT half: debounce, in-flight sequencing and the tiny
// state machine the indicator renders (app/[code]/_quiz/precheck-indicator.tsx).
// The hint is a courtesy while the student types — never the grade — so every
// rule here errs towards asking LESS: never for an empty or over-long answer,
// never before the text has been quiet for a full window, never twice for the
// same text, and never while the answer is being graded.
//
// The limits come from `lib/quiz-precheck.ts` rather than being re-typed here:
// the server action enforces its own copy of the same rules, and one definition
// cannot drift. The server re-derives the feature gate too, so `enabled` is a
// UI convenience, not the authorization.

/** What the indicator draws: nothing, a spinner, or a hint that may be out of date. */
export type PrecheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "hint"; verdict: PrecheckVerdict; stale: boolean };

// One shared object so the frequent `setState(IDLE)` (every keystroke while the
// feature is off, every cleared box) bails out of re-rendering on identity.
const IDLE: PrecheckState = { kind: "idle" };

export function useAnswerPrecheck({
  enabled,
  code,
  questionId,
  slot,
  text,
  suspended,
}: {
  /** The effective server flag AND the quiz's opt-in; false keeps the hook inert. */
  enabled: boolean;
  code: string;
  questionId: string;
  /** The attempt SLOT, not just the question: drill mode asks one question in several. */
  slot: number;
  /** The raw textarea value — trimming is this hook's job. */
  text: string;
  /** Grading (or showing a verdict): cancel the timer, keep what is on screen. */
  suspended: boolean;
}): PrecheckState {
  const [state, setState] = useState<PrecheckState>(IDLE);
  // A mirror of `state` for the effect below, so it can DECIDE without dispatching.
  // This is load-bearing, not an optimisation: the effect runs on every keystroke,
  // and React counts an update scheduled from inside a passive-effect flush as a
  // NESTED update — a setState per keystroke, even a no-op one, accumulates
  // across fast typing until React's nested-update limit turns it into a hard
  // "Maximum update depth exceeded" error (seen live with burst typing). So the
  // effect writes state only on a real transition, never to "make sure".
  const stateRef = useRef<PrecheckState>(IDLE);
  const transition = useCallback((next: PrecheckState) => {
    const prev = stateRef.current;
    if (
      prev === next ||
      (prev.kind === "hint" &&
        next.kind === "hint" &&
        prev.verdict === next.verdict &&
        prev.stale === next.stale) ||
      (prev.kind === "checking" && next.kind === "checking")
    ) {
      return;
    }
    stateRef.current = next;
    setState(next);
  }, []);
  // Every call carries the sequence number it was started with; a response whose
  // number is no longer current is DROPPED. A server action cannot be aborted —
  // there is no signal to pass and no request handle to cancel — so "cancelled"
  // here always means "the answer still arrives server-side and is ignored".
  const seq = useRef(0);
  // The last text we got a hint for, so returning to it (undo, retyping the same
  // word) restores the hint instead of spending another call on it.
  const lastChecked = useRef<{ text: string; verdict: PrecheckVerdict } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The question+slot this hook is currently tracking, to notice a move.
  const tracking = useRef(`${questionId}\u0000${slot}`);

  useEffect(() => {
    const clearTimer = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };

    // Moved to another question (Next, Skip, or a repeat in another slot): forget
    // everything. A restored draft is deliberately NOT remembered per slot — it is
    // simply re-checked after one quiet window, which the fall-through below does.
    const key = `${questionId}\u0000${slot}`;
    if (tracking.current !== key) {
      tracking.current = key;
      lastChecked.current = null;
      seq.current += 1;
      transition(IDLE);
    }

    const trimmed = text.trim();
    if (!enabled || trimmed === "" || trimmed.length > PRECHECK_MAX_ANSWER_CHARS) {
      // Nothing worth asking about. An over-long answer is treated exactly like an
      // empty one — the action would refuse it anyway.
      clearTimer();
      seq.current += 1;
      transition(IDLE);
      return;
    }

    if (suspended) {
      // The answer is on its way to the grader; a hint about it would be noise.
      // What is on screen stays until the verdict card replaces the editing card.
      clearTimer();
      return;
    }

    if (lastChecked.current?.text === trimmed) {
      clearTimer();
      seq.current += 1; // whatever is in flight is about older text than this
      transition({ kind: "hint", verdict: lastChecked.current.verdict, stale: false });
      return;
    }

    // The text moved on, so any hint on screen describes something the student has
    // already changed: dim it rather than hide it (a dimmed answer-shaped hint
    // beats an empty slot, and beats a spinner that throws it away).
    const shown = stateRef.current;
    if (shown.kind === "hint") transition({ ...shown, stale: true });

    timer.current = setTimeout(() => {
      timer.current = null;
      seq.current += 1;
      const mine = seq.current;
      // Only ever show the spinner when there is nothing better to show.
      if (stateRef.current.kind !== "hint") transition({ kind: "checking" });
      // Fail quiet, both for a refusal and for a transport error: the hint has no
      // error UI and no retry loop — the next pause simply asks again. A stale
      // hint stays; a spinner gives way to nothing.
      const keep = () => {
        if (stateRef.current.kind !== "hint") transition(IDLE);
      };
      precheckAnswer({ code, questionId, answer: trimmed }).then(
        (result) => {
          if (mine !== seq.current) return;
          if (!result.ok) {
            keep();
            return;
          }
          lastChecked.current = { text: trimmed, verdict: result.hint.verdict };
          transition({ kind: "hint", verdict: result.hint.verdict, stale: false });
        },
        () => {
          if (mine === seq.current) keep();
        },
      );
    }, PRECHECK_DEBOUNCE_MS);

    return clearTimer;
  }, [enabled, code, questionId, slot, text, suspended, transition]);

  // Unmounting invalidates whatever is in flight (see `seq` above) — the runner
  // may already be showing the summary when the response lands.
  useEffect(() => {
    return () => {
      seq.current += 1;
    };
  }, []);

  return state;
}
