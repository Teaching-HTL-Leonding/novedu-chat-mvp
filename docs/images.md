# App-hosted Images

Deep reference for the **module-agnostic image subsystem**: teachers upload PNG /
JPEG / SVG images *in the app* and reference them by name from any activity YAML
(tutor, fragment, quiz). The bytes live in Azure Blob Storage and are retrieved
**direct-to-blob via a short-lived SAS** — there is NO app route serving image
bytes; the only `proxy.ts` entry is the `api/images(?:/|$)` exclusion for the
**bearer metadata routes** (which carry no session cookie — bytes still go
direct-to-blob). The always-on invariants are
summarized in `AGENTS.md`; this file has the full mechanics. Read it before
touching `app/images/**`, `app/api/images/**`, `lib/image-store.ts`,
`lib/image-blob.ts`,
`lib/image-resolve.ts`, `lib/image-ref.ts`, `lib/relative-url.ts`,
`lib/images-actions.ts`, `lib/image-service.ts`,
`components/content-image.tsx`,
`components/image-lightbox.tsx`, the image helpers in `lib/file-name.ts`, or the
`novedu_images` schema.

## Four layers

The subsystem is split so an image flows from upload to render through four
independent seams; a module only ever sees the top one.

**Layer 1 — storage** (`novedu_images` + `lib/image-store.ts` + `lib/image-blob.ts`):
metadata in SQL, bytes in Blob Storage. `lib/image-blob.ts` is the ONE place the
app talks to Azure Blob Storage; `lib/image-store.ts` is the ONE place it touches
the table.

**Layer 2 — the management surface** (`/images`): teacher-only list + upload +
delete, mirroring `/files`.

**Layer 3 — the resolution primitive** (`ImageRef` → `resolveImageRef` →
`ResolvedImage`, plus the pure `resolveRelativeUrl`): turns a reference a module
embedded into a usable URL.

**Layer 4 — the display component** (`<ContentImage>`): a client component that
renders a `ResolvedImage` as a bounded thumbnail opening the shared
`<ImageLightbox>` (`components/image-lightbox.tsx`) — the same lightbox the
`/images` list's "View" button opens.

## Surfaces

| Surface | Path | Who | Notes |
| --- | --- | --- | --- |
| List | `/images` (`app/images/page.tsx`) | teacher | active versions only, contains-filter over name + an **owner** dropdown (the signed-in teacher by default); a row's "View" button opens the image in the shared lightbox from a read SAS (no inline thumbnail) |
| Upload | `/images/new` (`upload-image-form.tsx`) | teacher | name + file picker; direct-to-blob PUT then confirm |
| Bearer API / CLI | `GET /api/images`, `POST /api/images/<name>`, `POST /api/images/<name>/confirm` (`app/api/images/**`) | teacher (bearer token) | the CLI's `images upload/list` — the same confirm-only flow over `lib/image-service.ts`; see below and `docs/api.md` |

Both pages gate with **`requireTeacherPage()`** ("effective" teacher — student
mode is denied); the bearer routes gate with **`requireBearerTeacher()`**
(`lib/api-auth.ts` — no student mode on that channel). There is no edit
surface: an image is immutable once confirmed;
to change it, delete and re-upload (the name is reusable).

## Data model — `novedu_images` (temporal / append-only)

Mirrors `novedu_files` (see `docs/files.md`). Each row is **one version** of one
image; the row holds **metadata only** — the bytes live in Blob Storage,
addressed by `blob_path`. The image's stable identity is its **`name`** (the
surrogate `id` is per-version); the **active** version is the single row with
`valid_until IS NULL`. `created_by` is the oid of whoever wrote a version,
`closed_by` the oid of whoever ended it.

| Column | Meaning |
| --- | --- |
| `id` (PK) | per-version uuid |
| `name` | the teacher-chosen public identifier (`nvarchar(450)`) |
| `blob_path` | server-chosen blob name within the container: `<uuid>.<ext>` |
| `mime_type` | `image/png` \| `image/jpeg` \| `image/svg+xml` |
| `byte_size` | size of the uploaded blob in bytes |
| `credit` | optional attribution / "Content Credentials" (e.g. a CC BY notice), `nvarchar(512)`, NULL when none |
| `created_by` / `valid_from` / `valid_until` / `closed_by` | the temporal columns |

**"At most one active version per name" is enforced at the DATABASE level** by a
SQL Server **filtered unique index** `ux_novedu_images_active_name`
(`name` WHERE `valid_until IS NULL`) — it both closes the create-time race and
serves the active-row hot path. Names are reusable after deletion (the index only
constrains *active* rows). As with every `novedu_*` table there are **NO foreign
keys**. Images are **not** garbage-collected — soft-delete only, history stays.

The `blob_path` is a random UUID plus the MIME's extension, so it never collides
and never leaks the teacher's chosen name into the blob namespace.

## Store — `lib/image-store.ts` (server-only)

The **only** module that touches `novedu_images`, so the "filter on the active
version" invariant lives in one place. Never throws — a DB problem surfaces as
`undefined` / `{ ok: false, reason }`, which callers turn into a graceful message.

- `listImages({ search?, createdBy? })` — active rows, newest first. Filters
  apply **in SQL** (a case-insensitive contains-match over `name` for `search`,
  `createdBy` for the owner dropdown) — never in memory; see
  `docs/filtered-lists.md`. The rows carry the owner's display name from a LEFT JOIN
  on `novedu_users`; `listImageOwners()` is the dropdown's option set. **"Owner"
  here is the LAST WRITER** — `created_by` belongs to the active version.
- `getActiveImage(name)` — the active row; `null` = malformed name or no active
  version (unknown/deleted), `undefined` = DB error. Backs the resolver and the
  upload-time name-clash check.
- `confirmImage(input, userId)` — writes version 1 **after** the blob is in place;
  a transaction makes the existence check + insert atomic, and a duplicate-key
  error (mssql 2601/2627, via `isDuplicateKeyError`) maps to `reason: "name-taken"`.
- `softDeleteImages` — delete is **bulk-only**: closes the active rows, then removes
  the backing blobs **best-effort, OUTSIDE the transaction** (a blob failure never
  fails the delete — an orphaned blob just lingers). It loops the per-item
  `closeActiveImage` primitive so the rows close in ONE transaction (all-or-nothing),
  blobs delete per-image afterward (the shared multi-delete layer —
  `docs/filtered-lists.md`).

## Blob client — `lib/image-blob.ts` (server-only)

The ONE place the app talks to Azure Blob Storage. Authentication is
**PASSWORDLESS only**: the same data-store credential chain the SQL pools use
(`buildDataStoreCredential()` — never `DefaultAzureCredential`) is turned into a
**user-delegation key** via `getUserDelegationKey`, and every SAS is signed from
that key. **Account keys are disabled on the storage account**, so a shared-key
SAS is impossible. The delegation key is cached per process (asked for ~6h,
renewed within ~30min of expiry) so signing is almost always a local, network-free
operation; only fetching the key hits the network.

Every SAS is **HTTPS-only**, short-lived, and starts 5 minutes in the past
(clock-skew cushion):

- `mintWriteSas(blobPath, mime)` — a **create-only** (`"c"`) write SAS for a direct
  browser PUT, valid **10 min**, pinned to the supplied content type so the upload
  lands with the correct MIME. Returns the full `https` URL incl. `?sas`.
- `mintReadSas(blobPath)` — a **read-only** (`"r"`) SAS for a direct browser GET,
  valid **3 h**. Returns the full `https` URL incl. `?sas`.
- `getBlobProperties(blobPath)` — metadata; a missing blob surfaces as
  `{ exists: false }` (a 404 `RestError`) rather than throwing.
- `deleteBlob(blobPath)` — deletes if present (no-op when already gone).

The container is **`novedu-images`** on account **`stnoveduchatmvp`**; both are
env-overridable (`IMAGE_BLOB_CONTAINER`, `IMAGE_STORAGE_ACCOUNT`).

## Service & server actions — `lib/image-service.ts` + `lib/images-actions.ts`

The policy pipeline lives in **`lib/image-service.ts`** — the transport-agnostic
seam shared by the web server actions and the bearer API routes, mirroring
`lib/file-service.ts`. **Auth never enters the service**: each channel gates
itself and passes the verified user id in; failures carry a `reason`
discriminant (`invalid` / `conflict` / `unavailable`) the channels map to a
form message or HTTP 400/409/503. The largest
image is **5 MB** (`MAX_IMAGE_BYTES`); only `image/png` / `image/jpeg` /
`image/svg+xml` are allowed.

- `prepareImageUpload({ name, mime, byteSize })` → validate the name/MIME/size +
  reject a name already taken by an active image (`conflict`), then mint a
  **create-only** SAS. **No DB row is written here** — and no user id is taken;
  the request step records nothing.
- `confirmImageUploadForUser(userId, { name, blobPath, mime, credit? })` →
  inspect what actually landed via
  `getBlobProperties` (size and content type are **re-derived from the blob, never
  trusted from the client**); a blob that is missing, too large, or of the wrong
  type is rejected — and a present-but-bad blob is deleted so it does not linger —
  then `confirmImage` writes the metadata row as `userId`.

`lib/images-actions.ts` (`"use server"`) is the thin web shell, mirroring
`lib/files-actions.ts`: **every** action
gates with **`requireTeacherUserId()`** (an *effective* teacher — student mode is
denied — plus the session `oid`); never `session.user.isTeacher`. It maps the
service failures to `{ ok: false, error }` form messages and revalidates
`/images` on success (`revalidatePath` stays OUT of the service — the bearer
routes share it).

- `requestImageUpload(name, mime, size)` → gate + `prepareImageUpload`.
- `confirmImageUpload(name, blobPath, mime, credit?)` → gate +
  `confirmImageUploadForUser`.
- `deleteSelectedImagesAction(names)` → the list's **"Delete Selected"**, the **only**
  delete path (web-only — no bearer delete route); mirrors `deleteSelectedFilesAction`.

## The upload flow — request → PUT → confirm

Upload is **CONFIRM-ONLY**: no DB row exists until `confirmImageUpload`, so an
abandoned upload leaves at most an orphan blob, never a half-written record. The
browser uploads the bytes **straight to Blob Storage** — they never pass through
the app server.

1. The form (`upload-image-form.tsx`) infers the MIME from the file's extension,
   pre-checks size/MIME client-side, and calls `requestImageUpload`.
2. The action gates, re-validates name/MIME/size, checks the name is free, and
   returns a create-only `uploadUrl` + the server-chosen `blobPath`.
3. The browser **`PUT`s the file to `uploadUrl`** with `x-ms-blob-type: BlockBlob`
   and the matching `Content-Type`.
4. The form calls `confirmImageUpload`, which inspects the landed blob, rejects +
   removes anything off-policy, and writes the metadata row.

The **CLI runs the identical flow over the bearer routes** (`docs/api.md`):
`POST /api/images/<name>` (→ `prepareImageUpload`) returns the SAS slot, the CLI
PUTs the raw bytes straight to Blob Storage itself, and
`POST /api/images/<name>/confirm` (→ `confirmImageUploadForUser`) writes the
row. The bytes never pass through the app on either channel — the "no
`/api/images` byte route" invariant holds; the bearer routes carry metadata and
SAS URLs only. `GET /api/images` lists active versions with a short-lived read
SAS per row.

## Resolution primitive — `ImageRef` → `resolveImageRef` → `ResolvedImage`

A module that wants a content image embeds an **`ImageRef`** (`lib/image-ref.ts`,
**pure / client-safe** — no I/O):

```ts
interface ImageRef { hosted?: boolean; src: string; alt?: string; credit?: string }
```

`resolveImageRef(ref, baseUrl)` (`lib/image-resolve.ts`, server) turns it into a
**`ResolvedImage`** (`{ url, alt?, credit? }`) — handling **three shapes**, leniently
(a missing ref or an unknown/soft-deleted hosted name yields `null`, so the
consumer simply omits the image rather than erroring):

- **`hosted: true`** — `src` is an app-hosted image **name**; the active row
  supplies the `blob_path`, minted into a short-lived **read SAS** URL.
- an **absolute** `http(s)` URL — used as-is.
- anything else — a **relative** path resolved against the module's base URL via
  the pure `resolveRelativeUrl` (`lib/relative-url.ts`: standard `URL`
  resolution, so `./` / `../` segments work).

`ImageRef` is intentionally a *projection* type: it carries no secret (unlike a
quiz's `evaluation`), so a module's public projection can pass it to the browser
unchanged and resolve it just before render.

**Content Credentials** (`credit`): an optional attribution shown small below the
image by `<ContentImage>`. For a **hosted** image it defaults to the credit stored
on its `novedu_images` row (set at upload on `/images/new`); a per-ref `credit` on
the `ImageRef` overrides it, and is the only source for absolute/relative refs.

## Display — `<ContentImage>` + `<ImageLightbox>` (client)

The display splits into a **trigger** and the **lightbox**, so the lightbox is one
shared component both content images and the management list open.

- `<ImageLightbox>` (`components/image-lightbox.tsx`) is the lightbox itself: a
  native `<dialog>` showing one image full-window (`image`, controlled `open`, and
  `onClose`). Escape, a Close button, and a backdrop click all route back through
  `onClose`, so the caller stays the single source of open/closed truth; a failed
  `<img>` load swaps in a muted note in place of the image.
- `<ContentImage>` (`components/content-image.tsx`) is the content-image trigger:
  it renders a bounded responsive thumbnail (a real `<button>`) that opens the
  shared `<ImageLightbox>`. A thumbnail that fails to load falls back to a muted
  note. This is what tutor / fragment / quiz YAML images render as.
- The `/images` list's **"View"** button (`app/images/view-image-button.tsx`) is
  the other trigger — an icon button (no inline preview) opening the same
  `<ImageLightbox>` from the row's read-SAS URL.

**SVG safety**: images are rendered **ONLY via `<img src>`** — never inline SVG
markup — so a hosted SVG cannot inject script into the page (it executes only in
the isolated image context of the blob origin, not the document). The `<img>`
elements deliberately bypass `next/image` (hosted images are arbitrary external
blobs served via SAS, so the optimizer/loader doesn't apply).

## Provisioning (one-time)

The storage account `stnoveduchatmvp` already has shared-key access **disabled**
and public blob access **off**; the web app's Managed Identity and the developer's
user both hold **Storage Blob Data Owner** (required for `getUserDelegationKey` and
for SAS signing). Create the container once:

```sh
az storage container create --name novedu-images --account-name stnoveduchatmvp --auth-mode login
```

`--auth-mode login` uses the Entra identity (shared-key auth is unavailable).

The account also needs a **blob-service CORS rule** so the browser's direct-to-blob
upload `PUT` (a cross-origin request carrying `x-ms-blob-type`, so it is preflighted)
is allowed. Image *display* needs no CORS — `<img src>` loads cross-origin without it
— only the upload `fetch` does. The rule allows the app origins to `PUT`/`GET`:

| Field | Value |
| --- | --- |
| Allowed origins | `http://localhost:3000`, `https://novedu.at`, `https://novedu-chat-mvp-at.azurewebsites.net` |
| Allowed methods | `GET,PUT` |
| Allowed headers | `x-ms-blob-type,content-type` |
| Exposed headers | `*` |
| Max age | `3600` |

Because shared-key auth is disabled, the key-based `az storage cors` command cannot
reach this account. Set it on the data plane with the Entra (az-login) credential via
the `@azure/storage-blob` SDK — `BlobServiceClient.setProperties({ cors: [...] })`
(`getProperties` first to preserve logging/metrics). Add a new app origin here when
the app is reachable on another host.

## Tests

The overall approach (layers, the `@live` boundary, the no-infra patterns) is in
**`docs/testing.md`**. Image-specifics:

- `lib/image-store.unit.test.ts` — the temporal transitions, the name-taken guard,
  the best-effort blob cleanup.
- `lib/image-service.unit.test.ts` — the shared policy pipeline: the reason
  discriminants, the UUID blob path, the blob-derived size, the best-effort
  delete of off-policy blobs, the credit normalization/clamping.
- `lib/images-actions.unit.test.ts` — the web shell: the teacher gate, the
  service wiring (transitive through the mocked blob/store seams), the
  revalidation.
- `app/api/images/route.unit.test.ts`, `app/api/images/[name]/route.unit.test.ts`,
  `app/api/images/[name]/confirm/route.unit.test.ts` — the bearer routes (real
  auth gate via a local JWKS, mocked service/store; see `docs/api.md`), and the
  hermetic `e2e/api-images.spec.ts` proving the proxy exclusion + 401/403 over
  real HTTP.
- `lib/image-blob.unit.test.ts` — SAS permission/expiry/protocol shape and the
  passwordless delegation-key path.
- `lib/image-resolve.unit.test.ts` — the three-shape resolution and the lenient
  `null` fallbacks.
- `components/content-image.browser.test.tsx` — `<ContentImage>`'s rendering +
  lightbox contract (thumbnail with alt, open by click / Enter / Space, close by
  Escape / button / backdrop, the failed-load fallback) — pure-prop, no infra.
- `app/images/view-image-button.browser.test.tsx` — the list's "View" button +
  shared `<ImageLightbox>` contract (no inline image until opened, open shows the
  full image, close by button / Escape, the credit, the failed-load fallback) —
  pure-prop, no infra.
- `e2e/image-management.live.spec.ts` — the upload → list → resolve → delete
  lifecycle against REAL Azure Blob Storage (mints SAS, PUTs/GETs actual blobs),
  local-only.
