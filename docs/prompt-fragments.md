# Prompt fragments

Deep reference for the **shared prompt-fragment core**: the one home of Handlebars
handling and the load / resolve / consistency / assemble pipeline that turns a
document-level fragment block into a finished prompt string. It is not an activity
module — it is the infrastructure **all four** activity kinds (tutor, quiz, writing,
coding) build on, so a persona / safety / rules fragment written once in a fragment
library is reusable by every kind. The teacher-facing authoring guide lives in
`activities/tutors/README.md`; this file is the code reference. Read it before
touching `lib/prompt-fragments/**`, or when wiring a new consumer of the block.

## The module — `lib/prompt-fragments/`

The single owner of Handlebars: compilation, `COMPILE_OPTIONS = { strict: true,
noEscape: true }` (strict so an undeclared `{{variable}}` fails the build,
`noEscape` so text is inserted verbatim — ASCII diagrams survive), fragment schemas,
consistency checking, and assembly. Extracted out of `lib/tutors/` so no kind owns
it. The public surface is the `lib/prompt-fragments/index.ts` barrel; consumers
import from `@/lib/prompt-fragments` and never re-implement any of it.

- **`assembleFragmentPrompt(block, baseUrl, fetchImpl, opts, trailingInstructions?)`**
  (`load.ts`) — **THE orchestrator** and the sole owner of the fetch → validate →
  consistency → assemble pipeline. Given a document-level `{ fragment_files,
  fragments }` block, it fetches every declared library in parallel (relative refs
  resolved against `baseUrl` via `resolveFragmentUrl`), schema-validates each,
  optionally runs the thorough whole-library check (`validateLibraries`), runs
  `checkConsistency`, and assembles the priority-ordered plan followed by the
  optional `trailingInstructions`. Returns `{ ok: true, prompt, warnings }` or
  `{ ok: false, errors, warnings }`. A block that declares nothing resolves to just
  the trailing text (or `""`) with **no** fetch — the common case for a plain
  quiz/writing/coding activity. Tutor, quiz, writing, and coding all call this ONE
  function with a single document-level block; tutors pass `tutor_instructions` as
  the trailing text (a complete prompt), the others pass none and prepend their own
  frame around a fragment-only preamble.
- **`assembleSystemPrompt(plan, trailingInstructions?)`** — the pure assembly step
  (render in `priority` order, append the trailing text, join with blank lines).
- **`checkConsistency(block, filesByAlias)`** — the cross-reference / variable /
  duplicate-priority check over the fragments a block actually uses.
- **`loadYaml` / `LoadOptions`** — the shared front of every load: enforce the URL
  scheme allow-list (SSRF guard: http(s) on the server; the CLI adds `file:`), fetch,
  parse YAML. `LoadOptions` carries `allowedSchemes` and `validateLibraries`.
- **`loadAndCheckFragmentFile`** — the standalone fragment-library validator (a real
  validator with **no** module; the `fragment` FileKind in `docs/codes.md`).
- **`resolveFragmentUrl`, the fragment schemas** (`FragmentFileRefSchema`,
  `FragmentRefSchema`, `FragmentFileSchema`, …), the **error model**
  (`ValidationError` / `ValidationWarning`, `error`/`warning`), `Fetcher` /
  `defaultFetcher`, `getFragmentInputSchema`, `checkFragmentFileValue`.

## The isolation invariant

`handlebars` is imported by **exactly two** files, both under
`lib/prompt-fragments/`: `assemble.ts` and `fragment.ts`. `COMPILE_OPTIONS` is
referenced only within the module. A grep-guard unit test
(`lib/prompt-fragments/isolation.unit.test.ts`) enforces both: it fails the build if
`handlebars` is imported — or `assembleFragmentPrompt`/`COMPILE_OPTIONS` referenced —
outside the directory (and asserts the two real importers are present, so the guard
can't silently pass on a rename). No consumer touches Handlebars; they all go through
`assembleFragmentPrompt`.

## The document-level fragment block

Every activity kind embeds the tutor `prompt` shape **flattened to the document
root**: a top-level `fragment_files:` (each an `id` alias + an http(s)-or-relative
`url`) and `fragments:` (each a `file` alias, `id`, `variables`, an accepted-but-
ignored `bind`, and a `required` flag). Fragments render in ascending `priority`
order; a duplicate priority among the fragments a block uses is a consistency error.
`readFragmentBlock` (`block.ts`, Handlebars-free) is the **lenient** reader the
runtime `*-yaml.ts` parsers call to lift the block out of a document root without
imposing a strict schema.

## Who consumes it, and how

All four kinds resolve one document-level block through `assembleFragmentPrompt`; the
runtime seam of each is documented in its own doc.

- **Tutor** (`lib/tutors/`) — `loadAndBuildTutorPrompt` is now a thin wrapper over
  `assembleFragmentPrompt`, passing `tutor_instructions` as the trailing text.
  `lib/tutors/` holds only tutor-specific code (`TutorSchema`, the wrapper,
  `sample.ts`) and re-exports nothing from the shared core.
- **Quiz** (`docs/codes.md`) — the block is resolved **once** at load (`loadQuiz`,
  `lib/quiz-fetch.ts`) into a server-only `Quiz.fragmentPreamble`, prepended to BOTH
  the grader prompt and the discussion chat's system prompt. `toPublicQuiz` never
  copies it.
- **Writing** (`docs/writing.md`) — `loadWriting` (`lib/writing-fetch.ts`) prepends
  the assembled fragments ahead of the teacher's `instructions`.
- **Coding** (`docs/coding.md`) — `loadCoding` (`lib/coding-fetch.ts`) prepends them
  ahead of `instructions` identically. Assembly stays in the load/parse layer,
  **never** in `lib/llm/endpoint.ts` (which stays provider-blind and side-effect-free).

## Runtime vs. authoring — `validateLibraries`

`validateLibraries` (a `LoadOptions` flag, default `false`) opts a build INTO the
thorough whole-library check: **every** fragment in every referenced file is
strict-rendered against its own `input_schema`, not just the fragments the activity
uses, catching a template bug anywhere in a referenced library.

- **Runtime loaders** (`loadQuiz` / `loadWriting` / `loadCoding`, and the tutor's own
  runtime path) pass `validateLibraries: false` — the hot path (chat start, quiz
  grading, the per-request coding proxy) needs only the assembled prompt. A fragment
  fetch / consistency / assembly failure at runtime is a hard `{ ok: false }`
  (**fail closed**).
- **Authoring validators** (`loadAndCheckQuiz` / `loadAndCheckWriting` /
  `loadAndCheckCoding`, `loadAndBuildTutorPrompt` at share/validate time, and the CLI)
  default `validateLibraries: true` — the thorough gate, so a broken fragment in a
  referenced library is caught at save / share time, not when the first student opens.

Fragment fetches go through the existing loopback-avoiding `appHostedFetcher` via an
optional async post-parse `resolve` hook on `loadAppHostedYaml`
(`lib/app-hosted-yaml.ts`): an app-hosted fragment ref resolves from the database,
never a loopback fetch — preserving the `docs/files.md` invariant.

## Security posture

Assembly is server-side inside the load path; the assembled preamble, the grading
prompts, the writing instructions, and the coding system prompt never reach the
browser. The scheme gate (http(s) on the server; `file:` added only by the CLI)
applies to fragment fetches — same SSRF guard as the activity YAML itself.
