// Public surface of the shared prompt-fragment core: the ONE home of Handlebars
// handling (compilation, COMPILE_OPTIONS, consistency, assembly) and the
// load/validate infrastructure every activity kind (tutor, quiz, writing, coding)
// consumes. No consumer imports `handlebars` or re-implements any of this.

export { assembleSystemPrompt, COMPILE_OPTIONS } from "./assemble";
export { EMPTY_FRAGMENT_BLOCK } from "./block";
export { type ConsistencyResult, checkConsistency, type ResolvedFragment } from "./consistency";
export type {
  BuildResult,
  ErrorCode,
  FragmentCheckResult,
  ValidationError,
  ValidationWarning,
  WarningCode,
} from "./errors";
export { error, formatZodIssues, warning } from "./errors";
export { defaultFetcher, type Fetcher, type FetchResponse } from "./fetcher";
export {
  checkFragmentFileValue,
  checkFragmentTemplates,
  findDuplicateFragmentIds,
} from "./fragment";
export { getFragmentInputSchema } from "./fragment-inputs";
export {
  type AssembleResult,
  assembleFragmentPrompt,
  type LoadOptions,
  loadAndCheckFragmentFile,
  loadYaml,
  prependPreamble,
  resolveFragmentPreamble,
  resolveFragmentUrl,
} from "./load";
export { parseYaml, validate } from "./parse";
export {
  type Fragment,
  type FragmentBlock,
  type FragmentFile,
  type FragmentFileRef,
  FragmentFileRefSchema,
  FragmentFileSchema,
  type FragmentRef,
  FragmentRefSchema,
  FragmentSchema,
  InputSchema,
  type VariableValue,
  VariableValueSchema,
} from "./schemas";
