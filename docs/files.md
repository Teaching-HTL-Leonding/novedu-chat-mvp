# App-hosted YAML Files

Deep reference for the **YAML Files** feature: teachers author tutor and fragment
YAML *in the app* instead of hosting it on GitHub/S3/Azure Blob. Each file is
served at a public `GET /api/files/<name>` as raw YAML, so its URL drops straight
into the existing tutor-code flow with **zero** changes to the tutor-code
mechanism — the loader (`lib/tutors/load.ts`) fetches any `http(s)` URL through an
injectable `Fetcher` and does not care about host or content-type. The always-on
invariants are summarized in `AGENTS.md`; this file has the full mechanics. Read it
before touching `app/files/*`, `app/api/files/*`, `lib/file-store.ts`,
`lib/files-actions.ts`, `lib/app-hosted-fetcher.ts`, the `novedu_files` schema, or
the `api/files` entry in `proxy.ts`.

## Surfaces

| Surface | Path | Who | Notes |
| --- | --- | --- | --- |
| List | `/files` (`app/files/page.tsx`) | teacher | active versions only, contains-filter + "Only my files" (default on) |
| Create | `/files/new` (`create-file-form.tsx`) | teacher | name + kind + CodeMirror editor + upload |
| Edit / delete | `/files/edit/[...name]` (`edit-file-form.tsx`) | teacher | preloaded with the active version; copyable public URL; soft-delete |
| Public GET | `/api/files/<name>` (`app/api/files/[name]/route.ts`) | **anyone** | active version as `text/yaml`, `no-store` (404 once deleted) |
| GUI editor | `/files/gui/edit/<name>` (`app/files/gui/edit/[...name]/page.tsx`) | teacher | student-built form GUI; "Edit in GUI" on the list |
| GUI viewer | `/files/gui/view?url=…&kind=…` (`app/files/gui/view/page.tsx`) | teacher | read-only student GUI; "View in GUI" on `/validate-tutor` |

The edit route is a **catch-all** (`[...name]`) and the `name` column is a
generous `nvarchar(450)`, both deliberately folder-ready (`/`-separated names) —
a deferred extension; today names are flat (`FILE_NAME_PATTERN`).

The **GUI editor/viewer** are a separate, student-built form interface over the
**same** actions/validators, exposed through the documented facade
**`lib/yaml-files.ts`** (the only import the student module uses) — see
`docs/yaml-gui-student-contribution.md`. The pure name/kind helpers live in
**`lib/file-name.ts`** (no DB import) so that client-safe facade can re-export them.

## Data model — `novedu_files` (temporal / append-only)

Each row is **one version** of one file (full content per version, never diffs).
The file's stable identity is its **`name`** (the surrogate `id` is per-version);
the **active** version is the single row with `valid_until IS NULL`, every other
row is history. The transitions (all in a transaction) live in `lib/file-store.ts`:

- **create** — `INSERT` one active row.
- **update** — close the active row (`valid_until` + `closed_by`) **and** `INSERT`
  a new active row (= soft-delete the old version + a fresh version).
- **delete** — close the active row and `INSERT` nothing (so no active version
  remains; the GET 404s and the list drops it, while the history stays).

`created_by` is the oid of whoever wrote a version; `closed_by` is the oid of
whoever ended it (updater **or** deleter), so logical deletions are attributed too.
The active row's `created_by` is therefore the file's "last writer".

**"At most one active version per name" is enforced at the DATABASE level** by a
SQL Server **filtered unique index** `ux_novedu_files_active_name`
(`name` WHERE `valid_until IS NULL`). It both closes the create-time race (two
concurrent creates of the same name cannot both succeed) and serves the
GET/edit/close hot-path lookup (`name WHERE valid_until IS NULL`). The conditional
`UPDATE … WHERE id=? AND valid_until IS NULL` in update/delete is the matching
optimistic-concurrency guard (0 rows affected ⇒ a parallel writer moved the file on
⇒ `not-found`, never a second active row). Names are reusable after deletion (the
index only constrains *active* rows). As with every `novedu_*` table there are **NO
foreign keys** (to `mastra_*` or otherwise). Files are **not** garbage-collected.

## Store — `lib/file-store.ts` (server-only)

The **only** module that touches `novedu_files`, so the "filter on the active
version" invariant lives in one place. Never throws — a DB problem surfaces as
`undefined` / `{ ok: false, reason }`, which callers turn into a graceful message.

- `FILE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,100}$/`, the pure `validateFileName()` and
  `isFileKind()` live in **`lib/file-name.ts`** (no DB import) and are re-exported
  here — one definition of a legal name (trims, then enforces the
  pattern), shared by the GET route, the create action, AND the client-safe
  `@/lib/yaml-files` facade (which must not import the DB-bound store).
- `listFiles({ search?, createdBy? })` — active rows, newest first, **without**
  `content` (kept cheap). Optional filters are applied **in SQL** (a `WHERE`/`LIKE`
  over name/title/description for `search`, `createdBy` for "Only my files") —
  never in memory; see `docs/filtered-lists.md`.
- `getActiveFile(name)` — the active row **with** `content`; `null` = malformed
  name or no active version (unknown/deleted), `undefined` = DB error. Backs both
  the edit page and the GET endpoint.
- `createFile` / `updateFile` / `softDeleteFile` — the transitions above.
  `createFile` maps a duplicate-key error (mssql 2601/2627, via
  `isDuplicateKeyError`) to `reason: "name-taken"`.
- `title` / `description` are **denormalized** from the validated tutor YAML so the
  list is searchable without parsing every body; they are clamped to the column
  caps (512 / 2048) — lossless for the file (the body in `content` is authoritative)
  and it stops a perfectly valid tutor from failing the INSERT on truncation.

## Server actions — `lib/files-actions.ts` (`"use server"`)

The thin auth + policy shell. **Every** action gates with **`requireTeacherUserId()`**
(an *effective* teacher — student mode is denied — plus the session `oid`); never
`session.user.isTeacher`. Validation is **coupled to saving by design** — an invalid
file is never persisted.

- `createFileAction` → validate name + kind + YAML, store, then `redirect("/files/edit/<name>")`.
- `updateFileAction(name, content)` → re-validate against the **stored** kind, store a new version.
- `deleteFileAction(name)` → soft-delete (idempotent).
- `deleteSelectedFilesAction(names)` → the list's **"Delete Selected"**: soft-deletes
  every selected file in **one transaction** (`softDeleteFiles`), reusing the same
  `closeActiveFile` primitive as the single delete — the shared multi-delete layer
  (`docs/filtered-lists.md`).
- `validateNewFileAction` / `validateExistingFileAction` → **validate-only**: run the
  same preamble + validator as create/update but **never store**; on success they
  return the non-blocking `warnings`. They back the standalone **Validate** button
  so teachers stop writing throwaway versions just to check the YAML. (The primary
  button is "Validate & create" / "Validate & save" — it validates again
  server-side, the defensive backstop.)

A failure is either a short `message` (auth, name, store) or the full structured
`errors` list from the validator (rendered the same way as the `/validate-tutor`
page — schema field paths, missing variables, fetch failures).

### Validating the in-editor buffer (`validateFileContent`)

The validator is URL-based with an injectable `Fetcher`. To validate the **unsaved
buffer**, the action injects a `selfFetcher` that intercepts
`<origin>/api/files/<name>` URLs and resolves them **without a network round-trip**:
the file being saved resolves to its in-editor buffer, and a sibling hosted file
(`./other` → `…/api/files/other`) resolves from the database via `getActiveFile`.
Everything else (e.g. a fragment on GitHub) is fetched for real. This avoids a
loopback fetch to our own public origin (which a container may not be able to reach)
and any fragility around exact self-URL string matching.

The sibling/external part — "app-hosted URL → DB, anything else → real fetch" — is
the shared **`appHostedFetcher`** (`lib/app-hosted-fetcher.ts`), the **one
definition** of that resolution. `selfFetcher` wraps it (adding only the unsaved-
buffer special case), and the GUI loader (`loadYamlFromUrlAction`) and the quiz
loader (`lib/quiz-fetch.ts`) import the same function — it is a plain module, not
`"use server"`, so every server module can reuse it. Validation parity with the
rest of the app:

- **tutor** → `loadAndBuildTutorPrompt(selfUrl, selfFetcher, { validateLibraries: true })`
  — the THOROUGH authoring gate (every fragment in every referenced library is
  strict-rendered), matching share time and the validate page. Returns
  `title`/`description` for the denormalized columns.
- **fragment** → `loadAndCheckFragmentFile(selfUrl, selfFetcher)`.
- **quiz** → a **STUB**: returns OK + a single `QUIZ_VALIDATION_NOT_IMPLEMENTED`
  warning and NULL `title`/`description` — quizzes have no structural validator in
  the MVP, so saving never blocks and the Validate button passes for any quiz YAML
  (the lenient parse happens only at run time — see `docs/codes.md`). The
  create-file kind selector therefore offers **tutor / fragment / quiz**, and the
  `/files` list adds **"Create quiz link"** + **"Discussions"** actions on quiz rows.

The public origin is resolved once on the server (`resolveAppOrigin` /
`resolveAppOriginOr` in `lib/app-origin.ts`) and the public URL is built by
`filePublicUrl` / `filesUrlPrefix` in `lib/file-url.ts` (pure, importable by client
and server).

### App-hosted URL resolution — `lib/app-hosted-fetcher.ts`

Resolving a YAML reference (the save-time validator, the quiz loader, and the GUI's
`loadYamlFromUrlAction`) goes through one shared resolver, **`appHostedFetcher`** in
`lib/app-hosted-fetcher.ts`. It handles absolute / relative / app-hosted URLs and
reads an app-hosted file straight from the DB (`getActiveFile`) instead of a loopback
HTTP fetch. It is a plain module (NOT `"use server"`), so every server module can
import it; `lib/files-actions.ts` and `lib/quiz-fetch.ts` both do. Don't reimplement
this resolution at a call site.

## Public GET endpoint & the access gate

`app/api/files/[name]/route.ts` is **PUBLIC and unauthenticated** — deliberately
excluded from the Auth.js gate so the tutor-code loader can fetch it server-side
with no cookies and teachers may share it. `proxy.ts` must keep `api/files` in its
negative-lookahead matcher (alongside `api/auth`, `api/version`) — **keep the route
and the matcher in sync**. The handler is `force-dynamic` with `Cache-Control: no-store`
(edits must be visible immediately — the tutor-code flow re-fetches on every chat
open/message); `404` for a malformed/unknown/deleted name, `503` on a DB error. All
teacher CRUD lives in server actions on authed pages (not under `/api/files`), so it
stays gated.

## Reused building blocks

`@/components/validation-result` (`ErrorList` / `WarningList`), `@/components/copy-icon-button`,
`@/components/back-link`, `@/components/require-teacher-page` (the page-level teacher
gate), `@/components/icons`, and `app/files/yaml-editor.tsx` (a thin
`@uiw/react-codemirror` + `@codemirror/lang-yaml` wrapper with an upload button). The
list itself is the shared filtered-list concept — `@/components/data-list` +
`@/components/list-filter-bar` — so its filtering ("Only my files" + contains-search
over name/title/description) runs **in the database** via URL search params, not in
memory (see `docs/filtered-lists.md`).

## Tests

- `lib/file-store.unit.test.ts` — the temporal transitions; `lib/file-name.unit.test.ts`
  — the pure name/kind helpers.
- `lib/files-actions.unit.test.ts` — the teacher gate, validate-before-store
  ordering, structured-error pass-through, that the validate-only actions never
  touch the store, and the GUI loaders (`loadYamlFromUrlAction` URL resolution,
  `loadFileFromDbAction`).
- `tests/component/list-filter-bar.browser.test.tsx` — the shared filter bar's
  Apply → URL-search-param behavior (the DB filter is then exercised end-to-end by
  the `@live` `e2e/file-and-tutor-code-crud.spec.ts`, which covers file CRUD).
- `tests/component/file-forms.browser.test.tsx` — the Validate button wiring
  (errors / passed note / warnings, and no save).
- `e2e/files.spec.ts` — the auth gate (hermetic, runs in CI) and a single `@live`
  create → list → update → soft-delete lifecycle (writes the real DB).
