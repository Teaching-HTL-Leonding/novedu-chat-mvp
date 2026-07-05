// Generic promise timeout: race `work` against a bounded clock. Used by the
// health probes and by `foundryBearerToken` — anywhere an upstream dependency
// (SQL, DNS, Entra) must never be allowed to stall a caller indefinitely.
export async function withTimeout<T>(work: Promise<T>, what: string, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
