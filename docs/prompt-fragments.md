# Prompt fragments

Deep reference for the **shared prompt-fragment core**: the one home of Handlebars
handling and the load / fetch / placement-check / render pipeline that turns an
activity's **host text** (with inline `{{fragment}}` markers) plus its declared
fragment **libraries** into a finished prompt string. It is not an activity module —
it is the infrastructure **all four** activity kinds (tutor, quiz, writing, coding)
build on, so a persona / safety / rules fragment written once in a fragment library is
reusable by every kind. The teacher-facing authoring guides live in
`activities/tutors/README.md` (the full fragment format) and
`activities/fragments/README.md` (the library editor schema); this file is the code
reference. Read it before touching `lib/prompt-fragments/**`, or when wiring a new
consumer of the block.

## Inline placement — the model

An activity does **not** list which fragments it uses in a document-level `fragments:`
array (there is no such list, and no `priority`). Instead the activity's own host text
is a Handlebars template, and the author places each fragment exactly where they want
it with an inline marker:

```yaml
fragment_files:
  - id: shared
    url: ./general-fragments.yaml
tutor_instructions: |
  {{fragment "shared.persona" level="beginner" topics=(array "loops" "arrays")}}

  You are helping students with...

  {{fragment "shared.hint-style" tone="strict"}}
```

- The reference is a **quoted string literal** `"alias.id"`, split at the **first** dot:
  the alias (which cannot contain a dot) before, the fragment id (which may) after.
- Inline hash args are the only variable source: strings and booleans as native hash
  args, string arrays via the registered `array` subexpression helper — `items=(array
  "a" "b")`. Per placement, effective variables = the fragment's `input_schema`
  defaults overridden by the inline args.
- The **same fragment may be placed multiple times** with different args. Fragments
  appear **only where placed** — order is textual position, nothing else.

## The module — `lib/prompt-fragments/`

The single owner of Handlebars: fragment-content rendering, the isolated host-template
engine, placement checking, fragment schemas, and the load pipeline. Extracted out of
`lib/tutors/` so no kind owns it. The public surface is the
`lib/prompt-fragments/index.ts` barrel; consumers import from `@/lib/prompt-fragments`
and never re-implement any of it.

- **`assembleFragmentPrompt(block, baseUrl, fetchImpl, opts, hostText)`** (`load.ts`) —
  **THE orchestrator** and the sole owner of the fetch → validate → check → render
  pipeline. Given a document-level `{ fragment_files }` block, a base URL, a `Fetcher`,
  `LoadOptions`, and the activity's **host text**, it:
  1. **Template-semantics opt-in:** if the block declares **no `fragment_files`**, it
     returns `hostText` **byte-verbatim** — never compiled, no fetch. This protects
     plain activities and the authoring tutors whose prose contains sample markers as
     teaching content.
  2. Otherwise fetches every declared library in parallel (relative refs resolved
     against `baseUrl` via `resolveFragmentUrl`), schema-validates each, and optionally
     runs the thorough whole-library check (`validateLibraries`).
  3. `parseHostPlacements(hostText)` → `checkPlacements(...)`.
  4. Renders the host template under strict Handlebars; any throw is the fail-closed
     `ASSEMBLY_ERROR` backstop.
  Returns `{ ok: true, prompt, warnings }` or `{ ok: false, errors, warnings }`. Every
  kind funnels through this ONE pipeline — the tutor passes `tutor_instructions`,
  writing/coding pass `instructions`, and quiz passes its optional top-level
  `instructions`.
- **`host-template.ts`** — owns the **isolated `Handlebars.create()` instance** with
  the `fragment` + `array` helpers, so those helpers exist ONLY when rendering host
  text. Exposes `parseHostPlacements(text)` (a `Handlebars.parse()` AST walk producing
  the placement list `{ ref, args, line, column }` plus findings) and
  `renderHostTemplate(text, resolver)` (compile + run under `{ strict: true, noEscape:
  true }`). Host-template **parse errors** carry no structured position, so the line is
  regexed out of the message (`/line (\d+)/`) — `HOST_TEMPLATE_PARSE_ERROR`; a marker
  whose reference is not a quoted literal is `FRAGMENT_REF_NOT_LITERAL`.
- **`assemble.ts`** — `renderFragmentContent(content, variables)`: renders ONE
  fragment's `content` with `COMPILE_OPTIONS = { strict: true, noEscape: true }` on the
  **default** Handlebars instance (which has no `fragment` helper — so a fragment that
  tries to call `{{fragment}}` itself fails closed under strict mode; nesting is out of
  scope by design).
- **`consistency.ts`** — `checkPlacements(placements, filesByAlias, fileRefs)` resolves
  each `alias.id` and validates its args (required / type / undeclared / defaults);
  warns on a declared library no marker uses (`UNUSED_FRAGMENT_FILE`). The shared
  **`resolveAndMerge(ref, args, filesByAlias)`** is used by BOTH `checkPlacements`
  (validation) and the `fragment` helper (render), so the two cannot drift on which
  fragment, which defaults, which types.
- **`loadYaml` / `LoadOptions`** — the shared front of every load: enforce the URL
  scheme allow-list (SSRF guard: http(s) on the server; the CLI adds `file:`), fetch,
  parse YAML. `LoadOptions` carries `allowedSchemes` and `validateLibraries`.
- **`loadAndCheckFragmentFile`** — the standalone fragment-library validator (a real
  validator with **no** module; the `fragment` FileKind in `docs/codes.md`).
- **`resolveFragmentUrl`, the fragment schemas** (`FragmentFileRefSchema`,
  `FragmentFileSchema`, `FragmentSchema`, …), the **error model**
  (`ValidationError` / `ValidationWarning`, `error`/`warning`), `Fetcher` /
  `defaultFetcher`, `getFragmentInputSchema`, `checkFragmentFileValue`.

## The isolation invariant

`handlebars` is imported by **exactly three** files, all under
`lib/prompt-fragments/`: `assemble.ts` (fragment-content render), `fragment.ts`
(standalone whole-library check), and `host-template.ts` (the isolated host-template
instance). `COMPILE_OPTIONS` is referenced only within the module. A grep-guard unit
test (`lib/prompt-fragments/isolation.unit.test.ts`) enforces both: it fails the build
if `handlebars` is imported — or `COMPILE_OPTIONS` referenced — outside the directory
(and asserts the three real importers are present, so the guard can't silently pass on
a rename). No consumer touches Handlebars; they all go through
`assembleFragmentPrompt`.

## The document-level fragment block

Every activity kind embeds the same block shape: **`fragment_files:`** only — each an
`id` alias (which **cannot contain a dot**) + an http(s)-or-relative `url`. The tutor
keeps it **nested under `prompt:`** (the `FragmentBlock` IS `tutor.prompt`); quiz /
writing / coding embed it **flattened to the document root**. `readFragmentBlock`
(`block.ts`, Handlebars-free) is the **lenient** reader the runtime `*-yaml.ts` parsers
call to lift the block out of a document root without imposing a strict schema.

### Variables, defaults, and severity

A fragment's `input_schema` is a constrained mini JSON-schema: properties typed
`string` / `boolean` / `array`-of-strings, a `required` list, and an optional typed
**`default`** per property. `resolveAndMerge` injects a default when the placement
omits an optional variable (a supplied value always wins); a `default` on a *required*
property can never apply and draws the `REQUIRED_PROPERTY_HAS_DEFAULT` warning. The
severity split: missing required variable, type mismatch, unknown alias/fragment,
duplicate alias, and duplicate id-in-file are **errors**; supplying an *undeclared*
variable and declaring a library no marker uses are **warnings**. The whole-library
check (`checkFragmentTemplates`) strict-renders against typed *placeholders* and
deliberately ignores real defaults — it only proves every declared variable renders.

### Accepted-but-inert fields

The fragment library's per-fragment **`version`** (now **optional**, consumed by
nothing) and the optional **`classification`** block (`type` + `override_allowed`)
validate but drive nothing. Don't assume versioning or override semantics exist — none
do today. (`priority`, the document-level `fragments:` list, and its `bind` / `required`
/ `variables` are **gone** — replaced by inline placement.)

## Error model

| Code | Severity | Meaning |
|------|----------|---------|
| `HOST_TEMPLATE_PARSE_ERROR` | error | The host text did not parse — a malformed marker or an unescaped literal `{{`. Carries the `line`. |
| `FRAGMENT_REF_NOT_LITERAL` | error | A `{{fragment}}` marker whose reference is not a quoted `"alias.id"` string literal. |
| `FRAGMENT_MARKER_INVALID` | error | A structurally wrong marker that would render differently than it validates: a block `{{#fragment}}…{{/fragment}}`, a `(fragment …)` subexpression, extra positional args, or a hash arg that is not a string / boolean / `(array "…" …)`. |
| `UNKNOWN_FRAGMENT_FILE_ALIAS` | error | A marker's alias is not a declared `fragment_files` id. |
| `FRAGMENT_NOT_FOUND` | error | The fragment id does not exist in the aliased library. |
| `MISSING_REQUIRED_VARIABLE` / `VARIABLE_TYPE_MISMATCH` | error | Placement args fail the fragment's `input_schema`. |
| `DUPLICATE_FRAGMENT_FILE_ALIAS` / `DUPLICATE_FRAGMENT_ID_IN_FILE` | error | An alias / a fragment id is declared twice. |
| `UNUSED_FRAGMENT_FILE` | warning | A declared library that no marker draws from. |
| `UNDECLARED_VARIABLE` / `REQUIRED_PROPERTY_HAS_DEFAULT` | warning | Extra arg / a required prop with a futile default. |
| `ASSEMBLY_ERROR` | error | The strict host-template render threw (the fail-closed backstop). |

Runtime loaders stay fail-closed (`{ ok: false }` on any error); authoring validators
keep `validateLibraries: true`.

## Who consumes it, and how

All four kinds resolve one document-level block + their host text through the shared
`assembleFragmentPrompt`; the runtime seam of each is documented in its own doc.

- **Tutor** (`lib/tutors/`) — `loadAndBuildTutorPrompt` passes `tutor_instructions` as
  the host text and gets the complete prompt back. `lib/tutors/` holds only
  tutor-specific code (`TutorSchema`, the wrapper, `sample.ts`).
- **Quiz** (`docs/codes.md`) — resolved **once** at load (`loadQuiz`,
  `lib/quiz-fetch.ts`): the optional top-level **`instructions`** host text is rendered
  into the server-only **`Quiz.instructionsPreamble`**, prepended to BOTH the grader
  prompt and the discussion chat's system prompt. `toPublicQuiz` never copies it. (No
  markers in per-question `evaluation` or `discussion.instructions`.)
- **Writing** (`docs/writing.md`) — `loadWriting` (`lib/writing-fetch.ts`) renders the
  `instructions` host text and stores the result back as `instructions`.
- **Coding** (`docs/coding.md`) — `loadCoding` (`lib/coding-fetch.ts`) does the same for
  its `instructions`. Rendering stays in the load/parse layer, **never** in
  `lib/llm/endpoint.ts` (which stays provider-blind and side-effect-free).

## Literal-text safety & whitespace

- In a fragment-using activity a literal `{{` must be escaped as `\{{` (it renders back
  to `{{`). A forgotten escape fails at save time (authoring validators) with
  Handlebars' `line:col` message, and fails closed at runtime — never silent text loss.
- Whitespace house policy: put a marker on its own line; surrounding blank lines are
  preserved. The `~` trim variant works but is deliberately undocumented (it eats
  adjacent blank lines aggressively).

## Runtime vs. authoring — `validateLibraries`

`validateLibraries` (a `LoadOptions` flag, default `false`) opts a build INTO the
thorough whole-library check: **every** fragment in every referenced file is
strict-rendered against its own `input_schema`, not just the fragments the activity
places, catching a template bug anywhere in a referenced library.

- **Runtime loaders** (`loadQuiz` / `loadWriting` / `loadCoding`, and the tutor's own
  runtime path) pass `validateLibraries: false` — the hot path (chat start, quiz
  grading, the per-request coding proxy) needs only the finished prompt. A fetch /
  placement / render failure at runtime is a hard `{ ok: false }` (**fail closed**).
- **Authoring validators** (`loadAndCheckQuiz` / `loadAndCheckWriting` /
  `loadAndCheckCoding`, `loadAndBuildTutorPrompt` at share/validate time, and the CLI)
  default `validateLibraries: true` — so a broken fragment in a referenced library is
  caught at save / share time, not when the first student opens.

Fragment fetches go through the existing loopback-avoiding `appHostedFetcher` via an
optional async post-parse `resolve` hook on `loadAppHostedYaml`
(`lib/app-hosted-yaml.ts`): an app-hosted fragment ref resolves from the database,
never a loopback fetch — preserving the `docs/files.md` invariant.

## Security posture

Rendering is server-side inside the load path; the finished prompt, the grading
prompts, the writing instructions, and the coding system prompt never reach the
browser. The scheme gate (http(s) on the server; `file:` added only by the CLI)
applies to fragment fetches — same SSRF guard as the activity YAML itself.
