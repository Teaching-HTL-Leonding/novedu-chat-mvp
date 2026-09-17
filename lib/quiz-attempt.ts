// The walk through one quiz attempt, including SKIPPING. PURE and CLIENT-SAFE — no
// I/O, no React — so `QuizRunner` only calls it and the rules are unit-testable.
//
// The attempt's sequence (built once by `buildQuestionSequence`,
// lib/quiz-sequence.ts) is treated as N SLOTS `0…N-1`. State is tracked per slot,
// not per question: in drill mode (`question_count` > pool) the same question
// fills several slots, and skipping one of them must not touch the others.
//
// "Back of the line": `pending` is the queue of slots still to ask, its head the
// current one. Answering removes the head; skipping moves it to the tail, so
// skipped questions return after every question not yet seen, in the order they
// were skipped, and may be skipped again. The attempt length never changes.
// Nothing here is stored or sent anywhere — a skip is not an answer.

export interface AttemptState {
  /** Slots still to ask; the head is the current slot. */
  readonly pending: readonly number[];
  /** Slots the student has skipped at least once. */
  readonly skipped: ReadonlySet<number>;
}

/** Identifies the QUESTION behind a slot, for the no-immediate-repeat rule. */
export type SlotKey = (slot: number) => unknown;

export function startAttempt(length: number): AttemptState {
  return { pending: Array.from({ length }, (_, i) => i), skipped: new Set() };
}

/** The current slot, or `undefined` once every slot is done. */
export function currentSlot(state: AttemptState): number | undefined {
  return state.pending[0];
}

/** A skip needs somewhere to go: the last pending slot cannot be skipped. */
export function canSkip(state: AttemptState): boolean {
  return state.pending.length >= 2;
}

/**
 * No immediate repeat (the guarantee `buildQuestionSequence` gives, kept across
 * skips): when the new head asks the question just shown, the first later slot
 * asking a different question moves to the front. Only drill mode can hit this;
 * with nothing different left, the repeat is unavoidable and stays.
 */
function avoidRepeat(pending: number[], shownKey: unknown, keyOf: SlotKey): number[] {
  if (pending.length < 2 || keyOf(pending[0] as number) !== shownKey) return pending;
  const i = pending.findIndex((slot) => keyOf(slot) !== shownKey);
  if (i < 0) return pending;
  const [moved] = pending.splice(i, 1);
  return [moved as number, ...pending];
}

/** Skip the current slot: it moves to the back of the line. */
export function skipCurrent(state: AttemptState, keyOf: SlotKey): AttemptState {
  const [head, ...rest] = state.pending;
  if (head === undefined || rest.length === 0) return state;
  return {
    pending: avoidRepeat([...rest, head], keyOf(head), keyOf),
    skipped: new Set(state.skipped).add(head),
  };
}

/** The current slot is answered and done. */
export function completeCurrent(state: AttemptState, keyOf: SlotKey): AttemptState {
  const [head, ...rest] = state.pending;
  if (head === undefined) return state;
  return { pending: avoidRepeat(rest, keyOf(head), keyOf), skipped: state.skipped };
}

/** 1-based position of the current slot among all slots (skips don't advance it). */
export function progressPosition(state: AttemptState, total: number): number {
  return total - state.pending.length + 1;
}

/** Skipped slots still waiting behind the current one. */
export function skippedWaiting(state: AttemptState): number {
  return state.pending.slice(1).filter((slot) => state.skipped.has(slot)).length;
}

/** Skipped slots never answered (for the summary after Finish). */
export function skippedUnanswered(state: AttemptState): number {
  return state.pending.filter((slot) => state.skipped.has(slot)).length;
}
