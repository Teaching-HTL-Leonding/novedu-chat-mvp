# Student project: a GUI for tutor & fragment YAML files

Welcome! 👋 This is your assignment brief. You will build a **graphical editor** for
the YAML files this app uses, so a teacher no longer has to hand-write YAML in a text
box. You work in **one isolated folder**, talk to the rest of the app through **one
small, documented API**, and you write **client-side React only** — all the hard
server parts (database, authentication, validation) are done for you.

> **You have strong general web-dev skills but little Next.js experience — that's
> expected.** This guide teaches the few Next.js things you need. You will *not* write
> server code, touch the database, or deal with login.

## 1. What you are building

The app hosts two kinds of YAML files (explained in §4):

- **tutor** files — define an AI tutor (its model, greeting, and which prompt
  *fragments* it uses, with parameters).
- **fragment** files — reusable libraries of prompt *fragments*, each a small
  templated text with declared input variables.

Today teachers edit these as raw YAML in a code editor (`/files` → "Edit"). Your job
is a **form-based GUI** alternative. Two deliverables:

1. **GUI editor** (`StudentFileEditor`) — reached from the **"Edit in GUI"** button in
   the `/files` list **Actions column** (it links to `/files/gui/edit/<name>`). Loads an
   existing file and lets the teacher edit it with form controls, then **validate** and
   **save** (and **delete**). Full lifecycle.
2. **GUI viewer** (`StudentFileViewer`) — reached from the **"View in GUI"** button on
   the `/validate-tutor` page (it links to `/files/gui/view?url=…&kind=…`). **Read-only**:
   it shows a YAML fetched from an external URL (e.g. GitHub) in your GUI. No saving.

The two buttons and the routes already exist and render your (currently placeholder)
components — so you can see your work in the real app from day one.

## 2. Where your code goes

```
app/files/gui/
├─ edit/[...name]/page.tsx     ← APP-OWNED. Do not edit. Loads a file, renders your editor.
├─ view/page.tsx               ← APP-OWNED. Do not edit. Loads a URL, renders your viewer.
└─ _studio/                    ← 🟢 YOUR WORKSPACE — everything here is yours.
   ├─ file-editor.tsx          ←   StudentFileEditor (start here)
   ├─ file-viewer.tsx          ←   StudentFileViewer (start here)
   ├─ studio.module.css        ←   your styles
   └─ …                        ←   add as many components / hooks / helpers as you like

e2e/yaml-gui/                  ← 🟢 your end-to-end (Playwright) tests
```

- **`_studio/`** — the leading underscore tells Next.js this folder is **private**
  (it is *not* turned into a URL route). So you can add any files here without
  accidentally creating pages.
- **The two `page.tsx` files are app-owned route shells.** Don't edit them. They do
  the server work and call your components with plain props (see §6). If you think you
  need to change them, ask a maintainer — you probably need an API change instead.

### Naming conventions

- Components & files: `kebab-case.tsx` (e.g. `variable-field.tsx`), one component per
  file where reasonable.
- Unit/component tests live **next to** the code they test:
  - `*.unit.test.tsx` — fast logic tests (run in jsdom).
  - `*.browser.test.tsx` — component tests (run in a real browser).
- End-to-end tests: `e2e/yaml-gui/*.spec.ts`.

## 3. The Next.js bits you need (quick crash-course)

You know React. Here is the Next.js-specific vocabulary for this task — that's all you need.

- **Client vs Server Components.** By default Next renders components on the server.
  Anything interactive (state, effects, event handlers) must be a **Client
  Component** — the file starts with the line `"use client";`. **Every file you write
  starts with `"use client";`.**
- **Server Actions.** The functions in `@/lib/yaml-files` whose names end in
  `…Action` run **on the server**, but you call them from your client code like normal
  async functions:
  ```tsx
  const result = await updateFileAction(name, content); // runs on the server
  ```
  Use React's `useTransition` to track the pending state (see the snippet in §7).
- **The private folder.** As above: `_studio/` is not a route. You never create a
  `page.tsx`; the app already provides the two routes.
- **You do NOT need to touch:** routing, the database, authentication/login, secrets,
  server configuration, or any `app/api/*` route. If a teacher isn't signed in, the
  shells already block access before your code runs.

## 4. The YAML you edit

The authoritative schema is Zod, in **`lib/tutors/schemas.ts`** (read it — it is the
source of truth). A machine-readable JSON Schema is in
**`tutors/tutor-yaml.schema.json`**. Example files to open and learn from:

| File | What it is |
| --- | --- |
| `tutors/simple-tutor.yaml` | minimal valid tutor |
| `tutors/simple-fragments.yaml` | minimal valid fragment library |
| `tutors/linked-list-tutor.yaml` | a realistic tutor referencing several fragments |
| `tutors/general-fragments.yaml` | a larger fragment library |

### Tutor file (shape)

```yaml
id: my-tutor                 # required, stable id
name: "My Tutor"             # required, human name
title: "Hi!"                 # optional welcome greeting
description: "..."           # required, shown to students
exampleQuestions:            # optional (UI shows up to 5)
  - title: "..."
    question: "..."
anonymous: true              # optional, default true (no user↔chat link)
llm:
  model: "RedHatAI/..."      # required
  imageInput: true           # optional, default true
prompt:
  fragment_files:            # libraries this tutor pulls fragments from
    - id: general            # alias used below
      url: "general-fragments.yaml"   # absolute http(s) OR relative to this file
  fragments:                 # which fragments to include, with parameters
    - file: general          # must match a fragment_files alias
      id: persona            # a fragment id inside that file
      variables:             # values for that fragment's input_schema
        subject: "math"
  tutor_instructions: |      # required, appended last
    Be patient and Socratic.
```

### Fragment library file (shape)

```yaml
id: my-fragments             # required, file id
fragments:                   # at least one
  - id: persona              # required, unique within the file
    version: 1               # required
    priority: 100            # required, unique across referenced fragments (render order)
    input_schema:            # OPTIONAL — the variables this fragment expects
      type: object
      required: [subject]
      properties:
        subject: { type: string }
        greeting: { type: string, default: "Hi there!" }
    content: |               # required Handlebars template
      {{greeting}} You tutor {{subject}}.
```

Rules your GUI must respect (the validator enforces all of these):

- **Strict schema** — unknown/misspelled keys are rejected (e.g. `prioirty:` fails).
- **Handlebars** in `content` (`{{var}}`, `{{#each}}`, `{{#if}}`).
- **Unique `priority`** across all referenced fragments.
- **Variable types must match** — a tutor's `variables` value must match the
  fragment's declared `input_schema` type (`string` / `boolean` / `array`).
- **`kind` is frozen** at create time — your editor cannot change a file from tutor to
  fragment.
- **Name pattern** — `^[A-Za-z0-9_-]{1,100}$` (use `validateFileName`).

## 5. The API you use — `@/lib/yaml-files`

This is the **only** app module you may import (besides your own files and npm
packages). It re-exports the exact functions the built-in editor uses. (This boundary
is a convention enforced by review / CODEOWNERS, not lint.)

### Load

```ts
// Load an app-hosted file's active content by name (for the editor).
loadFileFromDbAction(name: string): Promise<
  | { ok: true; name: string; kind: FileKind; content: string }
  | { ok: false; reason: "not-found" | "error" }
>

// Load raw YAML by URL (for referenced fragment files / the viewer). Handles
// absolute http(s), relative (resolved against baseUrl), and app-hosted URLs.
loadYamlFromUrlAction(input: { url: string; baseUrl?: string }): Promise<
  | { ok: true; content: string; resolvedUrl: string }
  | { ok: false; message: string }
>
```

### Validate (does NOT save)

```ts
// Validate a would-be NEW file (you choose name + kind).
validateNewFileAction(input: { name: string; kind: string; content: string }): Promise<ValidateFileResult>

// Validate a new version of an EXISTING file (kind comes from the stored file).
validateExistingFileAction(name: string, content: string): Promise<ValidateFileResult>
```

### Save

```ts
// Create version 1. On success it NAVIGATES to the file's edit page (returns only on failure).
createFileAction(input: { name: string; kind: string; content: string }): Promise<FileActionFailure>

// Save a new version of an existing file.
updateFileAction(name: string, content: string): Promise<SaveFileResult>
```

### Result types

```ts
type FileActionFailure =
  | { ok: false; message: string }            // a short human message (auth/name/store)
  | { ok: false; errors: ValidationError[] }  // the full structured validator errors

type SaveFileResult     = { ok: true } | FileActionFailure
type ValidateFileResult = { ok: true; warnings: ValidationWarning[] } | FileActionFailure
```

`ValidationError` / `ValidationWarning` carry `code` + a human `message` plus optional
location fields (`fileAlias`, `fragmentId`, `variable`, …). You decide how to render
them — **build your own** error/warning UI (don't import the app's components).

### Parsing, schemas & helpers (pure)

```ts
parseYaml(text: string): { ok: true; value: unknown } | { ok: false; error: ValidationError }
TutorSchema, FragmentFileSchema           // Zod schemas — .parse()/.safeParse() to type your form state
getFragmentInputSchema(file: FragmentFile, fragmentId: string): InputSchema | undefined
formatZodIssues(zodIssues): string[]      // flatten a schema error into readable lines
FILE_NAME_PATTERN, validateFileName, isFileKind, type FileKind
// plus the TypeScript types: Tutor, Fragment, FragmentFile, FragmentRef, InputSchema,
// ExampleQuestion, VariableValue, ValidationError, ValidationWarning, ErrorCode, WarningCode
```

**To turn your form state back into a YAML string**, use the `yaml` npm package
(already a dependency):

```ts
import { stringify } from "yaml";
const content = stringify(myTutorObject);
```

## 6. The props your components receive

The app-owned shells call your components with these props (plain data — no app
components cross the boundary):

```ts
// app/files/gui/_studio/file-editor.tsx
interface StudentFileEditorProps {
  name: string;            // the file's stable name
  kind: FileKind;          // "tutor" | "fragment" — frozen
  initialContent: string;  // the active YAML, to parse into your form on mount
  publicUrl: string;       // use as baseUrl to resolve relative fragment_files URLs
}

// app/files/gui/_studio/file-viewer.tsx  (read-only)
interface StudentFileViewerProps {
  url: string;                    // the source YAML URL (use as baseUrl)
  kind: FileKind;
  initialContent: string | null;  // the fetched YAML, or null on error
  loadError?: string;              // set when the YAML couldn't be loaded
}
```

## 7. Worked examples

### Validate, then save (editor)

```tsx
"use client";
import { useState, useTransition } from "react";
import {
  updateFileAction,
  validateExistingFileAction,
  type ValidationError,
  type ValidationWarning,
} from "@/lib/yaml-files";
import { stringify } from "yaml";

function SaveBar({ name, model }: { name: string; model: unknown }) {
  const [busy, start] = useTransition();
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [warnings, setWarnings] = useState<ValidationWarning[]>([]);

  function onSave() {
    const content = stringify(model);            // your form state → YAML
    start(async () => {
      const res = await updateFileAction(name, content);
      if (res.ok) { /* saved */ }
      else if ("errors" in res) setErrors(res.errors);
      else { /* res.message */ }
    });
  }
  // … render fields + a Save button (disabled while `busy`) + your own error/warning list
}
```

### Read a tutor's fragment parameters (the important one)

To let the teacher fill a tutor's per-fragment `variables`, you must learn what each
referenced fragment expects. Load each fragment file, parse it, and read its
`input_schema`:

```tsx
import {
  loadYamlFromUrlAction,
  parseYaml,
  FragmentFileSchema,
  getFragmentInputSchema,
} from "@/lib/yaml-files";

// tutor: the parsed tutor object; publicUrl: the StudentFileEditor `publicUrl` prop.
async function inputsFor(fileAlias: string, fragmentId: string, tutor, publicUrl: string) {
  const ref = tutor.prompt.fragment_files.find((f) => f.id === fileAlias);
  if (!ref) return undefined;

  const loaded = await loadYamlFromUrlAction({ url: ref.url, baseUrl: publicUrl });
  if (!loaded.ok) return undefined;                  // show loaded.message

  const parsed = parseYaml(loaded.content);
  if (!parsed.ok) return undefined;                  // show parsed.error
  const file = FragmentFileSchema.parse(parsed.value);

  // → { type, required: [...], properties: { name: { type, default? } } } or undefined
  return getFragmentInputSchema(file, fragmentId);
}
```

From the returned `input_schema` you know each variable's **name** (`properties`
keys), **type** (`string` / `boolean` / `array`), whether it is **required**, and any
**default** — render the matching input control for each.

## 8. The rules (please read)

- **Imports:** only `@/lib/yaml-files`, your own files under `_studio/` (and
  `e2e/yaml-gui/`), and npm packages. **Never** import from `@/components/*`,
  `@/app/*`, `@/auth`, the database, or any other `@/lib/*`. (We may change those at
  any time — the API is your stable contract.)
- **Build your own UI.** Do not reuse the app's React components; use npm packages
  (React, and e.g. `@uiw/react-codemirror` if you want a code field — already
  installed). This keeps your module independent.
- **Client-side only.** Everything you write is a `"use client"` component or a test.
  Need new server behaviour? Ask a maintainer to extend `@/lib/yaml-files` — don't add
  server code.
- **Don't edit** the two `page.tsx` shells, `@/lib/yaml-files`, or `package.json`.
  **Need a new npm dependency?** Ask a maintainer first (it changes the shared
  lockfile and affects the whole app).
- Saving always **re-validates on the server** — an invalid file is rejected even if
  your client thought it was fine. That's a safety net, not something to fight.
- **Never push to `main`** (see §10).

## 9. Testing

Your tests run as part of the normal suite (no special setup):

```bash
npm run test:unit        # *.unit.test.tsx (jsdom)
npm run test:component   # *.browser.test.tsx (real browser)
npm run test:e2e         # Playwright specs in e2e/ (yours go in e2e/yaml-gui/)
npm run check            # Biome lint + format (run before every commit)
npm run typecheck        # TypeScript
```

- Keep unit/component tests **next to** your components.
- Tag an e2e test that needs the real database `{ tag: ["@live", "@live-db"] }` —
  those **run in CI** against an ephemeral SQL Server container, so your
  DB-backed specs get CI coverage. You never need `@live-llm` (the GUI doesn't use
  the LLM). Leave a spec untagged if it needs no real database. See `docs/testing.md`.
- Prefer many small, fast unit tests over a few slow e2e ones.

## 10. Git workflow

You are 4 people on **one** solution. You self-organize the *work* (an "epic" issue,
smaller issues, sprints); this section defines the *Git mechanics* so you don't step
on each other or on `main`. **Because all your code lives in `_studio/` and
`e2e/yaml-gui/`, merge conflicts will be rare.**

### Branches

```
main                 ← protected; only the maintainer merges here
 └─ yaml-gui         ← the ONE integration branch the maintainer gives you
     ├─ yaml-gui/anna-editor-shell      ← your personal/feature branches
     ├─ yaml-gui/ben-variable-fields    ←   (branch off yaml-gui, PR back into yaml-gui)
     └─ …
```

- The maintainer creates **`yaml-gui`** off `main` and opens a **Draft
  "continuous-feedback" Pull Request** `yaml-gui → main`. They review it as it grows
  and mark it *Ready* when the epic is done. **You never open a PR to `main`
  yourself.**
- You each branch off **`yaml-gui`**, not `main`:
  ```bash
  git switch yaml-gui
  git pull
  git switch -c yaml-gui/<your-name>-<short-task>
  ```

### Planning (your self-organization)

1. Open one **epic** issue describing the overall goal.
2. Break it into smaller issues (a checklist / sub-issues in the epic) and assign them
   across sprints.
3. Reference issues from your branches/PRs/commits (`Closes #123`).

### Day-to-day loop

```bash
# start of a session — get the latest shared work
git switch yaml-gui && git pull
git switch yaml-gui/<your-branch>
git merge yaml-gui            # pull teammates' merged work into your branch

# … do work, commit small & often …
git add -A && git commit -m "feat: variable field for string inputs (#123)"

# finish a task — push and open a PR INTO yaml-gui (not main)
git push -u origin yaml-gui/<your-branch>
# open PR: base = yaml-gui, ask a teammate to review, then merge
```

### Staying current with `main`

`main` keeps moving while you work. Keep `yaml-gui` current so you integrate small,
frequent changes instead of one big painful merge:

- A rotating **"integrator"** (one of you per sprint) regularly updates the integration
  branch:
  ```bash
  git switch yaml-gui && git pull
  git fetch origin
  git merge origin/main         # bring main's changes into yaml-gui
  # resolve conflicts (rare — usually none, since you only touch _studio/)
  git push
  ```
- Everyone else then `git merge yaml-gui` into their feature branch (the loop above).

### Hard rules

- **Use `merge`, not `rebase`.** No history rewriting, no `--force` on shared branches
  — it's safer for a team and avoids breaking each other's clones.
- **Never** `git push` to `main` and **never** `--force-push` `yaml-gui`.
- Commit small and often; write a one-line message that says what changed and the
  issue number.

## 11. Definition of done

- [ ] **Editor**: open an existing tutor and an existing fragment file from "Edit in
      GUI", change them with form controls, **Validate** (shows errors/warnings), and
      **Validate & save** (rejected when invalid). Delete works.
- [ ] Tutor editor reads each referenced fragment's `input_schema` and renders inputs
      for its variables (§7 ⭐).
- [ ] **Viewer**: open a tutor and a fragment URL from "View in GUI" and render them
      read-only; a bad URL shows a friendly message.
- [ ] Round-trip is faithful: load → edit → save produces valid YAML the validator
      accepts.
- [ ] Tests: unit/component tests for your logic; at least one e2e per deliverable.
- [ ] `npm run check`, `npm run typecheck`, `npm run test` all green.
- [ ] You only imported `@/lib/yaml-files` + your own files + npm packages.
