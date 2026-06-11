// Display-time sampling for the welcome screen's example questions. Tutors may
// define any number of questions; the chat shows at most `max`, picked uniformly
// at random but presented in DEFINITION order — authors sequence their questions
// deliberately (e.g. easy → hard), so only the selection is random.
//
// Runs server-side (app/page.tsx): the client component is SSR'd, and calling
// Math.random() during render would cause hydration mismatches.

/**
 * Pick at most `max` items uniformly at random, preserving the input order.
 * The RNG is injectable so tests can run deterministically.
 */
export function sampleExampleQuestions<T>(
  items: readonly T[],
  max = 5,
  random: () => number = Math.random,
): T[] {
  if (items.length <= max) return [...items];
  // Partial Fisher-Yates over indices: the first `max` slots end up holding a
  // uniform random subset; filtering by that subset restores definition order.
  // (The `?? i` / `?? j` fallbacks never fire — both indices are in bounds —
  // they only satisfy noUncheckedIndexedAccess without an assertion.)
  const indices = items.map((_, i) => i);
  for (let i = 0; i < max; i++) {
    const j = Math.min(i + Math.floor(random() * (indices.length - i)), indices.length - 1);
    const swapped = indices[i] ?? i;
    indices[i] = indices[j] ?? j;
    indices[j] = swapped;
  }
  const picked = new Set(indices.slice(0, max));
  return items.filter((_, i) => picked.has(i));
}
