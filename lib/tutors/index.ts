// Public surface of the tutor builder. The shared prompt-fragment core it builds on
// lives in `@/lib/prompt-fragments`; consumers import fragment infrastructure from
// there directly (there are no compatibility re-exports here).

export { loadAndBuildTutorPrompt } from "./load";
export { sampleExampleQuestions } from "./sample";
export { type ExampleQuestion, type Tutor, TutorSchema } from "./schemas";
