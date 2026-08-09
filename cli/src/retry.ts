// Two tiny, CLI-LOCAL primitives the eval run needs and nothing else in the repo has:
// a retry with linear backoff, and an order-preserving bounded worker pool. Both take
// their timing/parallelism seams as parameters so unit tests need no timers.
//
// They are deliberately VALUE-based rather than exception-based: the CLI's HTTP helper
// (`performApiRequest`) reports failures as result objects, so `shouldRetry` inspects a
// value instead of catching. A thrown error is a bug, not a retryable condition, and
// propagates untouched.

export interface RetryOptions<T> {
  /** Total attempts including the first (PoC parity: 4). */
  attempts?: number;
  /** Backoff base; the delay before attempt N is `baseDelayMs × (N − 1)` (5 s, 10 s, 15 s). */
  baseDelayMs?: number;
  /** Whether THIS outcome is worth another attempt (5xx / true network failures only). */
  shouldRetry: (value: T) => boolean;
  /** Injected so tests run instantly. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `work` up to `attempts` times, waiting a LINEARLY growing delay between tries
 * (the shape the Python PoC used against SCCH's occasional 504s). Returns the first
 * outcome `shouldRetry` rejects, or the last outcome when the budget runs out.
 */
export async function withRetry<T>(
  work: (attempt: number) => Promise<T>,
  options: RetryOptions<T>,
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const baseDelayMs = options.baseDelayMs ?? 5000;
  const sleep = options.sleep ?? defaultSleep;

  let last: T | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(baseDelayMs * (attempt - 1));
    last = await work(attempt);
    if (!options.shouldRetry(last)) return last;
  }
  // `attempts >= 1`, so the loop always assigned at least once.
  return last as T;
}

/**
 * Maps `items` through `fn` with at most `limit` in flight, preserving INPUT order in
 * the result (a worker pool, not `Promise.all` in chunks — a slow item never stalls the
 * pool behind it). `fn` receives the item's original index so callers can report
 * progress meaningfully.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
