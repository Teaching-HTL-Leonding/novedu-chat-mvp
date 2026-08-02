// The question-sequence builder for one quiz attempt. PURE and CLIENT-SAFE — no
// I/O, no YAML, no server imports — so the runner's randomized walk logic is
// deterministically unit-testable with a seeded RNG while `QuizRunner` only calls
// it. The sequence is built client-side from the public projection; grading stays
// per-question and stateless (a repeated question is simply graded again), and
// there is no server-side attempt enforcement.

export interface QuestionSequenceOptions {
  /** Shuffle each pass over the pool (the quiz's `shuffle` flag). */
  shuffle: boolean;
  /**
   * Questions per attempt (the effective `question_count`). Omitted ⇒ every pool
   * question exactly once. May exceed the pool size — then questions repeat
   * (drill mode), with the whole pool covered before any repeat.
   */
  count?: number;
  /** Injectable RNG in [0, 1) — defaults to `Math.random`; tests pass a seeded one. */
  rng?: () => number;
}

/** Fisher–Yates with an injected RNG. */
function shuffleWith<T>(items: readonly T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/**
 * Build the asked sequence for one attempt:
 *
 * - `shuffle: true` → repeated passes over the pool, each pass independently
 *   shuffled, with no immediate repeat across a pass boundary (unless the pool has
 *   one question); truncated to `count`. Count < pool thus yields a random subset
 *   per attempt; count > pool yields even coverage before any repeat.
 * - `shuffle: false` → sequential cycling (`1…N, 1…N, …`) truncated to `count`;
 *   count < pool means "the first N, in authored order" (predictable for authors).
 */
export function buildQuestionSequence<T>(
  pool: readonly T[],
  { shuffle, count, rng = Math.random }: QuestionSequenceOptions,
): T[] {
  if (pool.length === 0) return [];
  const total = count ?? pool.length;

  if (!shuffle) {
    return Array.from({ length: total }, (_, i) => pool[i % pool.length] as T);
  }

  const out: T[] = [];
  while (out.length < total) {
    const pass = shuffleWith(pool, rng);
    // No immediate repeat across the pass boundary: if the new pass would open with
    // the question just asked, swap its head with a random later element. Impossible
    // to avoid with a single-question pool — there, repeats are inherent.
    if (out.length > 0 && pool.length > 1 && pass[0] === out[out.length - 1]) {
      const j = 1 + Math.floor(rng() * (pass.length - 1));
      [pass[0], pass[j]] = [pass[j] as T, pass[0] as T];
    }
    out.push(...pass);
  }
  return out.slice(0, total);
}
