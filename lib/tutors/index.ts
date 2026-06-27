// Public surface of the reusable tutor validator/builder core.

export { assembleSystemPrompt } from "./assemble";
export { type ConsistencyResult, checkConsistency, type ResolvedFragment } from "./consistency";
export type {
  BuildResult,
  ErrorCode,
  FragmentCheckResult,
  ValidationError,
  ValidationWarning,
  WarningCode,
} from "./errors";
export { error, formatZodIssues } from "./errors";
export { defaultFetcher, type Fetcher, type FetchResponse } from "./fetcher";
export {
  checkFragmentFileValue,
  checkFragmentTemplates,
  findDuplicateFragmentIds,
} from "./fragment";
export {
  type LoadOptions,
  loadAndBuildTutorPrompt,
  loadAndCheckFragmentFile,
  loadYaml,
} from "./load";
export { parseYaml, validate } from "./parse";
export { sampleExampleQuestions } from "./sample";
export {
  type ExampleQuestion,
  type Fragment,
  type FragmentFile,
  FragmentFileSchema,
  type FragmentRef,
  type InputSchema,
  type Tutor,
  TutorSchema,
  type VariableValue,
} from "./schemas";
