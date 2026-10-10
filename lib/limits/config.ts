import { z } from "zod";
import type { LlmProvider } from "@/lib/llm/provider";

// The ONE home of the student limits (spam + cost protection, docs/usage-metering.md
// "Limits"). Typed and versioned in the repo rather than in `.env`: a limit is a
// product decision reviewed in a PR, and only the environment-dependent switches
// (`LIMITS_ENABLED`, lib/limits/enabled.ts) live in the environment.
//
// RESOLUTION ORDER for every per-provider value: the EFFECTIVE provider's entry
// (after a code's LLM override — otherwise an override could dodge a limit), then
// `defaults`. The resolvers in lib/limits/resolve.ts are the only readers.
//
// SERVER-ONLY and APP-ONLY: never imported by the CLI-bundled `lib/**` closure
// (grep-guarded in lib/limits/isolation.unit.test.ts).

const positiveInt = z.number().int().positive();

const providerLimitsSchema = z.strictObject({
  /** Multiplier on a request's tokens when they are charged to the daily budget; 0 = free. */
  budgetWeight: z.number().nonnegative(),
  chatMessagesPerMinute: positiveInt.optional(),
  codingRequestsPerMinute: positiveInt.optional(),
  chatMaxOutputTokens: positiveInt.optional(),
  codingMaxOutputTokens: positiveInt.optional(),
});

export const limitsConfigSchema = z
  .strictObject({
    /** Effective teachers (view-as-student excluded) are never limited. */
    exemptTeachers: z.boolean(),
    defaults: z.strictObject({
      chatMessagesPerMinute: positiveInt,
      codingRequestsPerMinute: positiveInt,
      chatMaxContextTokens: positiveInt,
      /** Per-response output cap of the student-facing chat agents. */
      chatMaxOutputTokens: positiveInt,
      /** The highest output cap an activity may raise its chat to (reasoning models). */
      chatMaxOutputTokensCeiling: positiveInt,
      /** Upper bound on the coding proxy's `max_tokens` / `max_completion_tokens`. */
      codingMaxOutputTokens: positiveInt,
      /** Text characters one student turn may carry (images not counted). */
      chatMaxInputChars: positiveInt,
      dailyBudgetUnits: positiveInt,
      cachedTokenWeight: z.number().min(0).max(1),
    }),
    providers: z.record(z.string(), providerLimitsSchema),
  })
  .refine((c) => c.defaults.chatMaxOutputTokens <= c.defaults.chatMaxOutputTokensCeiling, {
    message: "chatMaxOutputTokens must not exceed chatMaxOutputTokensCeiling",
  });

type ProviderLimits = z.infer<typeof providerLimitsSchema>;

// `Record<LlmProvider, …>` (not the schema's string record) so adding a provider
// to `LLM_PROVIDERS` is a compile error here until it gets its limits.
export type LimitsConfig = Omit<z.infer<typeof limitsConfigSchema>, "providers"> & {
  providers: Record<LlmProvider, ProviderLimits>;
};

const config = {
  exemptTeachers: true,
  defaults: {
    chatMessagesPerMinute: 10,
    codingRequestsPerMinute: 60,
    chatMaxContextTokens: 32_000,
    chatMaxOutputTokens: 6_000,
    chatMaxOutputTokensCeiling: 16_000,
    codingMaxOutputTokens: 16_000,
    chatMaxInputChars: 8_000,
    // Placeholder — calibrate from production usage before enforcing it.
    dailyBudgetUnits: 300_000,
    cachedTokenWeight: 0.1,
  },
  providers: {
    // The school's own GPU: free for the budget, but shared by every class.
    SCCH: { budgetWeight: 0, chatMessagesPerMinute: 20 },
    "Azure Foundry": { budgetWeight: 1 },
    OpenRouter: { budgetWeight: 1 },
  },
} satisfies LimitsConfig;

// Parsed once at module load: a broken edit fails the first import (and the unit
// test) instead of surfacing as a wrong limit at runtime.
limitsConfigSchema.parse(config);

export const LIMITS: Readonly<LimitsConfig> = config;
