// Helpers the two eval routes share (docs/cli-eval.md). Grade and judge are siblings in
// every wire respect, so what they derive identically lives here — identical by
// construction, not by vigilance.

/**
 * The token usage of ONE agent call, in the shape both eval routes report it: Mastra's
 * `totalUsage` (across all steps) with the last step's `usage` as the fallback, both the
 * AI-SDK v5 `{ inputTokens, outputTokens, cachedInputTokens }` shape. `input` is the
 * total input INCLUDING the cached part. A result carrying no usage at all yields
 * `undefined` and the routes then OMIT the field — a missing measurement must never read
 * as "zero tokens".
 */
export function llmCallUsage(
  result: unknown,
): { input: number; cachedInput: number; output: number } | undefined {
  const holder = result as { totalUsage?: unknown; usage?: unknown } | null | undefined;
  const source = (holder?.totalUsage ?? holder?.usage) as
    | { inputTokens?: unknown; outputTokens?: unknown; cachedInputTokens?: unknown }
    | undefined;
  if (!source || typeof source !== "object") return undefined;
  const reported = [source.inputTokens, source.outputTokens, source.cachedInputTokens];
  if (!reported.some((value) => typeof value === "number" && Number.isFinite(value))) {
    return undefined;
  }
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return {
    input: count(source.inputTokens),
    cachedInput: count(source.cachedInputTokens),
    output: count(source.outputTokens),
  };
}
