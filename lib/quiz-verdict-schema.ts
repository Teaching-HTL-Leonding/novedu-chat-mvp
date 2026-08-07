import { z } from "zod";

// The quiz grader's STRUCTURED-OUTPUT schema, on its own so both sides can reach it:
//
//   - the grader agent path — `submitAnswer` passes it to `generate({ structuredOutput })`
//     and `app/mastra/quiz-agents.ts` re-exports it for agent-adjacent code,
//   - the prompt dump (`lib/prompt-dump.ts`, `@novedu/cli prompts`), which converts it to
//     plain JSON Schema so teachers and the eval harness see the exact response contract.
//
// PURE / CLI-safe by design: zod only. It must NEVER move back into `app/mastra/`, whose
// module graph pulls in `app/mastra/scch.ts` (a top-level `await` network call at import
// time) via `lib/llm/model.ts` — importing that from the CLI would hang/break it.
//
// The self-hosted vLLM endpoint honors OpenAI-compatible `response_format: json_schema`
// (verified against gemma-4 at design time), which is exactly what Mastra emits for
// `structuredOutput` — so no `jsonPromptInjection` fallback is needed. Kept terse; the
// student sees the mapped wording from `verdictLabel`, never these raw values.
export const QUIZ_VERDICT_SCHEMA = z.object({
  result: z.enum(["correct", "partial", "incorrect"]),
  feedback: z.string(),
});
