// The pure tutor-tool catalog: for every name in `names.ts`, the model-facing
// description, the zod input/output schemas, and the pure `execute` logic.
// Framework-agnostic on purpose — the Mastra `createTool` binding lives in
// `app/mastra/tutor-tools.ts`, NOT here: this module may end up in the CLI
// bundle's transitive closure and must import nothing from `app/**`, the DB,
// or `lib/llm/model.ts` (node builtins are fine). Randomness is injected via
// `TutorToolDeps` so unit tests are deterministic; the crypto-backed default
// lives in `defaultTutorToolDeps`.

import { randomInt } from "node:crypto";
import { z } from "zod";
import type { TutorToolName } from "./names";

/**
 * `min`/`max` bounds for `random_number`. ±2^31 keeps every value an exact
 * integer for the model and the range far below node's `randomInt` limit (2^48).
 */
export const RANDOM_NUMBER_BOUND = 2 ** 31;

/** Uniform integer in [minInclusive, maxInclusive]. */
export type RandomIntFn = (minInclusive: number, maxInclusive: number) => number;

/** Injected effects for tool executors — swap in tests for determinism. */
export interface TutorToolDeps {
  randomInt: RandomIntFn;
}

export const defaultTutorToolDeps: TutorToolDeps = {
  // node's crypto.randomInt is rejection-sampled (no modulo bias); its upper
  // bound is exclusive, the tool contract is inclusive.
  randomInt: (min, max) => randomInt(min, max + 1),
};

export interface TutorToolDef<In, Out> {
  name: TutorToolName;
  /** Wire-level tool description, written FOR the model. */
  description: string;
  inputSchema: z.ZodType<In>;
  outputSchema: z.ZodType<Out>;
  execute: (input: In, deps: TutorToolDeps) => Out;
}

// Erased-generics alias for heterogeneous collections of tool defs; per-tool
// input/output types live on each concrete entry.
// biome-ignore lint/suspicious/noExplicitAny: variance — `unknown` would reject every concrete def.
export type AnyTutorToolDef = TutorToolDef<any, any>;

const randomNumberInput = z
  .strictObject({
    min: z
      .number()
      .int()
      .min(-RANDOM_NUMBER_BOUND)
      .max(RANDOM_NUMBER_BOUND)
      .describe("Lower bound, inclusive."),
    max: z
      .number()
      .int()
      .min(-RANDOM_NUMBER_BOUND)
      .max(RANDOM_NUMBER_BOUND)
      .describe("Upper bound, inclusive."),
  })
  .refine((v) => v.min <= v.max, { message: "min must be <= max" });

const randomNumberOutput = z.strictObject({
  value: z.number().int().describe("The uniformly random integer, min <= value <= max."),
});

export const randomNumberTool: TutorToolDef<
  z.infer<typeof randomNumberInput>,
  z.infer<typeof randomNumberOutput>
> = {
  name: "random_number",
  description:
    "Returns a uniformly random integer between min and max (both inclusive). " +
    "Use it whenever you need to generate a practice problem, pick a random value, " +
    "or choose randomly between alternatives — do not invent 'random' numbers yourself.",
  inputSchema: randomNumberInput,
  outputSchema: randomNumberOutput,
  execute: (input, deps) => ({ value: deps.randomInt(input.min, input.max) }),
};

/**
 * Every tool, keyed by name. The `satisfies` clause forces this record to stay
 * in lockstep with `TUTOR_TOOL_NAMES`: adding a name without a catalog entry
 * (or vice versa) is a type error.
 */
export const tutorToolCatalog = {
  random_number: randomNumberTool,
} satisfies Record<TutorToolName, AnyTutorToolDef>;

/** Resolve a validated `tools:` selection to its catalog entries, in YAML order. */
export function resolveTutorTools(names: readonly TutorToolName[]): AnyTutorToolDef[] {
  return names.map((name) => tutorToolCatalog[name]);
}
