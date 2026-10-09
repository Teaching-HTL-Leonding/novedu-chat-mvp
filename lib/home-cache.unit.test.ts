import { describe, expect, it, vi } from "vitest";
import { createHomeCache } from "./home-cache";

interface Result {
  n: number;
  complete: boolean;
}

/** A load whose promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(opts: { ttlMs?: number; maxEntries?: number } = {}) {
  let clock = 0;
  const cache = createHomeCache<Result>({
    ...opts,
    cacheable: (r) => r.complete,
    now: () => clock,
  });
  return { cache, advance: (ms: number) => (clock += ms) };
}

const ok = (n: number): Result => ({ n, complete: true });

describe("home cache", () => {
  it("reuses a completed result inside the TTL and reloads after it", async () => {
    const { cache, advance } = setup({ ttlMs: 60_000 });
    const load = vi.fn().mockResolvedValueOnce(ok(1)).mockResolvedValueOnce(ok(2));
    expect(await cache.get("u", load)).toEqual(ok(1));
    advance(59_999);
    expect(await cache.get("u", load)).toEqual(ok(1));
    expect(load).toHaveBeenCalledTimes(1);
    advance(1);
    expect(await cache.get("u", load)).toEqual(ok(2));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight load between concurrent callers (single flight)", async () => {
    const { cache } = setup();
    const d = deferred<Result>();
    const load = vi.fn(() => d.promise);
    const a = cache.get("u", load);
    const b = cache.get("u", load);
    expect(cache.sizes().inFlight).toBe(1);
    d.resolve(ok(1));
    expect(await a).toEqual(ok(1));
    expect(await b).toEqual(ok(1));
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.sizes()).toEqual({ completed: 1, inFlight: 0 });
  });

  it("keys are independent", async () => {
    const { cache } = setup();
    await cache.get("a", async () => ok(1));
    expect(await cache.get("b", async () => ok(2))).toEqual(ok(2));
  });

  it("never caches a result with a failed group", async () => {
    const { cache } = setup();
    const load = vi.fn().mockResolvedValue({ n: 1, complete: false });
    await cache.get("u", load);
    await cache.get("u", load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.sizes().completed).toBe(0);
  });

  it("a rejected load is not cached and frees its in-flight slot", async () => {
    const { cache } = setup();
    await expect(cache.get("u", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(cache.sizes()).toEqual({ completed: 0, inFlight: 0 });
    expect(await cache.get("u", async () => ok(2))).toEqual(ok(2));
  });

  it("invalidation drops the completed entry", async () => {
    const { cache } = setup();
    await cache.get("u", async () => ok(1));
    cache.invalidate("u");
    expect(await cache.get("u", async () => ok(2))).toEqual(ok(2));
  });

  it("a load that started before an invalidation never publishes; a later caller starts a newer one", async () => {
    const { cache } = setup();
    const stale = deferred<Result>();
    const first = cache.get("u", () => stale.promise);

    cache.invalidate("u");
    const fresh = deferred<Result>();
    const second = cache.get("u", () => fresh.promise);
    expect(second).not.toBe(first);

    // The stale load finishes first: its caller gets it, the cache does not.
    stale.resolve(ok(1));
    expect(await first).toEqual(ok(1));
    expect(cache.sizes()).toEqual({ completed: 0, inFlight: 1 });

    fresh.resolve(ok(2));
    expect(await second).toEqual(ok(2));
    expect(await cache.get("u", async () => ok(3))).toEqual(ok(2));
  });

  it("an old promise's cleanup never removes a newer in-flight entry", async () => {
    const { cache } = setup();
    const stale = deferred<Result>();
    const first = cache.get("u", () => stale.promise);
    cache.invalidate("u");
    const fresh = deferred<Result>();
    const loadFresh = vi.fn(() => fresh.promise);
    const second = cache.get("u", loadFresh);

    stale.resolve(ok(1));
    await first;
    // A third caller still joins the newer load.
    const third = cache.get("u", vi.fn());
    expect(cache.sizes().inFlight).toBe(1);
    fresh.resolve(ok(2));
    expect(await third).toEqual(ok(2));
    expect(await second).toEqual(ok(2));
    expect(loadFresh).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest completed entry beyond the bound, never an in-flight load", async () => {
    const { cache } = setup({ maxEntries: 2 });
    const pending = deferred<Result>();
    const inFlight = cache.get("p", () => pending.promise);
    await cache.get("a", async () => ok(1));
    await cache.get("b", async () => ok(2));
    await cache.get("c", async () => ok(3));
    expect(cache.sizes()).toEqual({ completed: 2, inFlight: 1 });

    const reloadA = vi.fn(async () => ok(10));
    expect(await cache.get("a", reloadA)).toEqual(ok(10)); // evicted → reloaded
    expect(reloadA).toHaveBeenCalledTimes(1);

    pending.resolve(ok(4));
    expect(await inFlight).toEqual(ok(4));
  });

  it("churning invalidations of many users leave no entries; an invalidation during a load wins", async () => {
    const { cache } = setup();
    for (let i = 0; i < 1_000; i++) {
      await cache.get(`u${i}`, async () => ok(i));
      cache.invalidate(`u${i}`);
      cache.invalidate(`never-loaded-${i}`);
    }
    expect(cache.sizes()).toEqual({ completed: 0, inFlight: 0 });
    // Invalidation still wins over a load that was in flight before it.
    const stale = deferred<Result>();
    const first = cache.get("x", () => stale.promise);
    cache.invalidate("x");
    stale.resolve(ok(1));
    await first;
    const reload = vi.fn(async () => ok(2));
    expect(await cache.get("x", reload)).toEqual(ok(2));
  });
});
