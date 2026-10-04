// The start page's per-user load cache (docs/home.md → Load protection). A
// student refreshing in a loop must not load the database: a completed result
// is reused for a TTL, and concurrent loads of one key share one promise. In
// process memory is correct because a stage runs at most one live replica.
//
// - Completed entries and in-flight loads live in SEPARATE maps; a promise's
//   cleanup removes its in-flight entry only while it is still that promise.
// - Invalidation drops both entries. A load publishes its result only while its
//   promise is still the key's in-flight entry — an invalidation (or a newer
//   load) replaced it otherwise — so a caller after an invalidation never
//   receives a load that started before the write. No per-key state outlives
//   the two bounded maps.
// - At most `maxEntries` completed entries, oldest evicted first; eviction never
//   touches in-flight loads.
// - A result the `cacheable` predicate rejects (a load with a failed fact group)
//   is returned to its callers but never stored.

export interface HomeCacheOptions<T> {
  ttlMs?: number;
  maxEntries?: number;
  cacheable: (value: T) => boolean;
  /** Clock seam for tests. */
  now?: () => number;
}

export interface HomeCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
  invalidate(key: string): void;
  /** Test seam: forget everything. */
  clear(): void;
  /** Test seam: sizes of both maps. */
  sizes(): { completed: number; inFlight: number };
}

export function createHomeCache<T>({
  ttlMs = 60_000,
  maxEntries = 2_000,
  cacheable,
  now = Date.now,
}: HomeCacheOptions<T>): HomeCache<T> {
  const completed = new Map<string, { value: T; at: number }>();
  const inFlight = new Map<string, Promise<T>>();

  function publish(key: string, value: T) {
    completed.delete(key); // re-insert at the end: Map order is age order
    completed.set(key, { value, at: now() });
    while (completed.size > maxEntries) {
      const oldest = completed.keys().next().value;
      if (oldest === undefined) break;
      completed.delete(oldest);
    }
  }

  return {
    get(key, load) {
      const hit = completed.get(key);
      if (hit) {
        if (now() - hit.at < ttlMs) return Promise.resolve(hit.value);
        completed.delete(key);
      }
      const pending = inFlight.get(key);
      if (pending) return pending;

      const promise: Promise<T> = Promise.resolve()
        .then(load)
        .then((value) => {
          // Runs before the cleanup below, so the entry is still ours unless an
          // invalidation removed it in the meantime.
          if (inFlight.get(key) === promise && cacheable(value)) publish(key, value);
          return value;
        })
        .finally(() => {
          if (inFlight.get(key) === promise) inFlight.delete(key);
        });
      inFlight.set(key, promise);
      return promise;
    },
    invalidate(key) {
      completed.delete(key);
      inFlight.delete(key);
    },
    clear() {
      completed.clear();
      inFlight.clear();
    },
    sizes() {
      return { completed: completed.size, inFlight: inFlight.size };
    },
  };
}
