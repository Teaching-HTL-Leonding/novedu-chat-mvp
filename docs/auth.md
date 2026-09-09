# Authentication, teacher roles & student mode

Deep reference for the auth subsystem. The always-on invariants are summarized in
`AGENTS.md`; this file has the full mechanics. Read it before touching `auth.ts`,
`lib/session.ts`, `lib/db/auth-schema.ts`, `proxy.ts`, `app/sign-in/**`, `app/device/**`,
`lib/device-actions.ts`, sessions, teacher gating, or student mode.

This app is gated by **better-auth**, with Microsoft Entra ID (single tenant) as the
only sign-in provider. Key facts so future runs don't have to rediscover the setup:

## The instance and its tables

- **`auth.ts`** (repo root, server-only) — the single `betterAuth({...})` instance,
  exporting `auth` and the `Session` type. The Entra provider reads `AZURE_CLIENT_ID`,
  `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` directly from `.env` (not a better-auth env
  naming convention). `overrideUserInfoOnSignIn: true` means name/email are overwritten
  from the Entra profile on every sign-in, through `mapProfileToUser`, which the provider
  spreads over `{ name, email, image, emailVerified }` on both the create and that
  override update:
  - **`name`** — the trimmed `name` claim, falling back to `preferred_username`, then
    `email`, then `oid`. `novedu_user.name` is NOT NULL and every name fallback in the app
    (`??`, `COALESCE`) treats `""` as a real name, so a nameless profile must not store an
    empty string.
  - **`email`** — the `email` claim, falling back to `preferred_username` (the
    tenant-unique UPN), then `<oid>@entra.invalid`. Without a fallback a profile carrying
    no email is rejected with `EMAIL_NOT_FOUND`.
  - **`image: null`** — the app never stores or shows an avatar (the status bar renders
    initials instead), and `disableProfilePhoto: true` also skips the provider's Microsoft
    Graph photo fetch, an untimed extra request on every callback. `user.image` is
    therefore always null: nothing in the app reads it.
- **Account linking by email.** `account.accountLinking` sets
  `trustedProviders: ["microsoft"]` and `requireLocalEmailVerified: false`, so an Entra
  identity whose `oid` is not yet in `novedu_account` links to the existing `novedu_user`
  row carrying the same email instead of creating a second one. **Both** options are
  required: Entra ID tokens carry no `email_verified` claim, and the app's own rows have
  `email_verified = false`. This is safe **only while the Entra app is single-tenant** —
  the tenant owns every email it can present. Revisit it before admitting a second tenant,
  where one tenant could claim another's address.
- **`update-user` is disabled.** `disabledPaths: ["/update-user"]` makes
  `/api/auth/update-user` answer `404` for everyone. Display names are the app's, taken
  from the Entra profile at every sign-in, and teacher-facing lists resolve user ids
  through `novedu_user.name` — a user rewriting their own name would rewrite what teachers
  see.
- **Route handler:** `app/api/auth/[...all]/route.ts` re-exports `{ GET, POST }` from
  `toNextJsHandler(auth)` — every better-auth endpoint (`/api/auth/*`, incl. the sign-in
  callback and the device-flow endpoints below) lives behind this one catch-all route.
- **Five database tables**, all in the app's `novedu_` naming inside `public`, defined
  by hand in `lib/db/auth-schema.ts` (a maintained mirror of better-auth's own schema —
  the header comment there explains how to check it after a better-auth upgrade) and
  wired to the instance via `user.modelName` / `session.modelName` / `account.modelName`
  / `verification.modelName` / the `deviceAuthorization` plugin's `schema` option:
  - **`novedu_user`** — one row per signed-in person: `id`, `name`, `email` (unique),
    `email_verified`, `image` (always null), `created_at`, `updated_at`, and the app's
    own `is_teacher` field (see below). This is the id every `user_id`/`created_by`
    column across the `novedu_*` tables stores by value.
  - **`novedu_session`** — one row per live session: `id`, `expires_at`, `token`
    (unique), `created_at`, `updated_at`, `ip_address`, `user_agent`, `user_id` (FK to
    `novedu_user.id`, cascade). Both auth channels (browser cookie, CLI/API bearer) share
    this table.
  - **`novedu_account`** — the link to the identity provider: `id`, `account_id`,
    `provider_id`, `user_id` (FK, cascade), the OAuth token columns
    (`access_token`/`refresh_token`/`id_token`/…), `scope`, `created_at`, `updated_at`.
    One row per `(provider_id, account_id)` pair.
  - **`novedu_verification`** — better-auth's short-lived OAuth state during a sign-in
    round trip. Transient: written at the start of a flow, consumed at its end.
  - **`novedu_device_code`** — the device-authorization plugin's table, one row per CLI
    sign-in attempt (`device_code`, `user_code`, `user_id`, `status`, `client_id`, …). No
    foreign key on `user_id` — the row is deleted on redemption/denial and never joined
    for display.
  - The **two foreign keys** — `novedu_session.user_id` and `novedu_account.user_id`,
    both `→ novedu_user.id ON DELETE CASCADE` — are the only foreign keys anywhere in
    the `novedu_*` space; there are still none between `novedu_*` and `mastra_*`
    (`docs/database.md`).

## Sessions

- **Database-backed, no cookie cache.** Every `getSession()` call goes to the database (an
  indexed query on `novedu_session.token`, plus the user row) — there is no `session_data`
  cookie, only `session_token`. That means a sign-out or a changed `is_teacher` value takes
  effect on the very next request, on both channels, with no staleness window to reason
  about. `getSession()` (`lib/session.ts`) is wrapped in React's `cache()`, so the several
  callers of one render (the page, the status bar, the student-mode helpers) share a single
  lookup per request.
- **A FIXED 30-day window.** `session.expiresIn = 30 days` with
  `session.disableSessionRefresh: true`: a session is never extended, so everyone signs in
  again 30 days after signing in. Refreshing is not an option worth having here — it emits
  a session `Set-Cookie`, which `nextCookies()` writes into whatever response is being
  built, including a BEARER route's (planting the CLI caller's session in the browser that
  happened to trigger it); and a Server Component cannot write a cookie at all, so half the
  cookie channel could not renew anyway.
- **Cookie names.** `advanced.cookiePrefix` is `novedu`, so the session cookie is
  `novedu.session_token` under an `http` base URL and `__Secure-novedu.session_token`
  under `https` (the `__Secure-` prefix is a browser-enforced guarantee that the cookie was
  only ever set over TLS). The app's own prefix also keeps another better-auth app on
  `localhost` — cookies ignore ports — from writing over this app's session cookie.
  `proxy.ts`'s presence check (`getSessionCookie` from `better-auth/cookies`, given the
  same prefix) reads either name. The value is `${token}.${signature}`, URL-encoded, where
  the signature is an `HMAC-SHA256` of the RAW token under `AUTH_SECRET` in standard,
  PADDED base64 (44 characters), as `makeSignature` from `better-auth/crypto` produces it.
  It is the only cookie better-auth sets here: the OAuth state of a sign-in round trip
  lives in `novedu_verification`, not in a cookie, because the instance has a database.
- **`AUTH_URL`.** Unset locally: better-auth infers the base URL from the request.
  Production sets `AUTH_URL` to the app's public base URL (`https://novedu.at/api/auth`;
  a value that already carries the `/api/auth` path is used as-is, a bare origin gets it
  appended) — that is what better-auth treats as its `baseURL` **and** as a trusted origin, so a POST from the real browser (the `/device`
  approve/deny actions, for instance) passes better-auth's origin check. It is also what
  decides the cookie's host scope. Sign-in breaks if it names the wrong host.

## The user id

The session user id is **`novedu_user.id`** — never the Entra `oid` directly, though the
two coincide for rows that predate this table: those were seeded with the former Entra
`oid` as their id (so every pre-existing `novedu_codes.created_by`,
`novedu_user_chats.user_id`, etc. still resolves), and the `oid` itself is kept in
`novedu_account.account_id` either way (that is what makes a pre-existing, oid-keyed user
row link to the right identity on its first sign-in — the callback matches by
`(provider_id, account_id)`, so the placeholder seed email never matters). A person
signing in for the first time gets a random 32-character id. Nothing that joins on the user id needs to
know or care which case it is: it is always `novedu_user.id`, by value, everywhere.

## Teacher role

Finer-grained access is by Entra **group** membership, but the result is a plain
**server-owned column**, not something read off the token per request:

- The Entra security group whose members are teachers is `TEACHER_GROUP_ID` in `.env`.
- `applyTeacherFlag` in `auth.ts` is a `databaseHooks.account.create.after` /
  `account.update.after` hook — it runs on the **account** row, once for a brand-new
  identity and again on every later sign-in of an existing one (including the seeded
  account's first sign-in), reading the fresh `id_token` better-auth has just stored
  there. `lib/teacher.ts`'s `teacherFromIdToken(idToken, TEACHER_GROUP_ID)` decodes the
  token's payload (no signature check needed — the token arrived over TLS straight from
  Entra's own token endpoint) and looks for the group id in the `groups` claim, and the
  hook writes the result to `novedu_user.is_teacher`.
- The hook runs **before** the session is created, so the very next `getSession()` after
  a sign-in already reflects the new role — there is no "stale until re-sign-in" gap.
- **Server-owned, fail-closed.** `additionalFields.isTeacher` on the `user` config sets
  `input: false`, so `is_teacher` can never be set through the API — and
  `/api/auth/update-user`, the endpoint that would carry it, is disabled outright (above)
  — the hook is the only writer. A failure inside the hook (a DB hiccup, a malformed token) is caught
  and logged; the flag simply keeps its previous value, which for a brand-new user is
  `false` — fail closed, never fail open.
- **Group overage.** When a user belongs to too many groups to fit in the token, Entra
  drops the `groups` array and substitutes a `_claim_names`/`_claim_sources` pointer.
  `resolveTeacher` reports this as `overage` and **fails closed** (not a teacher) —
  resolving it for real would need a Microsoft Graph call, which is not implemented.
  Prefer "Groups assigned to the application" in the Entra app registration to avoid it.
- Gate teacher-only server actions / route handlers with **`requireEffectiveTeacher()`**
  from `lib/student-mode.ts` (throws → respond 403); it honors student mode (below).
  `requireTeacher()` in `lib/session.ts` checks only the raw role and exists to gate
  entering student mode itself; the CLI/API bearer routes, which have no student mode,
  read the same column through `requireBearerTeacher()` (`docs/api.md`).

## The gate

- **`proxy.ts`** at the repo root checks that a session cookie is **present**, with **no
  signature check and no database call**: `getSessionCookie` from `better-auth/cookies`,
  given the same `cookiePrefix: "novedu"` as `auth.ts`, reads either cookie name and the
  proxy redirects when there is nothing. No cookie ⇒ bounce to `/sign-in`, carrying the
  path it wanted as `?callbackURL=`. The prefix is a repeated literal rather than an
  import: importing `auth.ts` here would drag the database pool and the provider
  credentials into the gate, so the **two literals must be kept in sync**.
- **What it cannot catch:** any cookie whose value does not resolve to a live session — a
  garbage or foreign one, and a genuine one whose `novedu_session` row is gone (deleted or
  expired). Telling them apart needs work the gate deliberately does not do. Such a request
  passes and the page renders **signed-out**; the status bar then shows a **"Sign in"**
  link instead of the user menu (`components/user-menu.tsx`), which is the way back. The
  layout never redirects, which is also why `/sign-in` is excluded from the matcher below.
- It is **not** the authorization boundary — every page, server action and route handler
  behind it re-establishes the session itself
  (`getSession()`/`requireEffectiveTeacher()` on the cookie channel, `requireBearerUser()`
  on the CLI/API channel), so a cookie without a live session buys nothing but a render it
  could have had anyway.
- The matcher excludes: the better-auth endpoints themselves (`api/auth`, needed to sign
  in and to run the device flow the CLI polls), `/sign-in` (redirecting it to itself
  would loop), the public `/api/version` build-identity probe, the public `/api/files`
  YAML-hosting GET, the public `/api/coding` routes (gated by the per-user API key —
  `docs/coding.md`), the CLI/API bearer routes (`/api/me`, `/api/codes`, `/api/reports`,
  `/api/images`, `/api/eval` — each self-gates via `requireBearerUser`/`requireBearerTeacher`,
  `docs/api.md`), `/docs` (the static teacher guide, public by intent —
  `docs/teacher-docs.md`), and static assets. `GET /api/image-content/<id>` — the
  route that serves app-hosted image bytes — is deliberately NOT excluded: it uses
  the normal cookie session, stays behind this gate like any page, and its handler
  calls `getSession()` itself on top of that. It applies no further authorization
  beyond a live session — no teacher check, no `checkCode()`, no thread token —
  because teacher-hosted images are shared authenticated assets, not per-code
  resources (`docs/images.md`).
- **`/sign-in`** (`app/sign-in/page.tsx`, server) reads `callbackURL` and `error` from
  the query, validates the callback is an app-relative path (it must start with `/`, and
  its second character may be neither `/` nor `\` — `//host` and `/\host` are both
  protocol-relative to a browser, which would turn the sign-in into an open redirect), and
  renders a generic error line when `error` is set alongside `<SignInButton
  callbackURL=…/>`. It is one of the two screens that render **without the app chrome**
  (`components/app-chrome.tsx`, `docs/styling.md`), so it carries the product name itself
  and centres its card in the full viewport — there is no status bar offering a burger
  menu to a visitor who is not signed in, and no second "Sign in" control. The client button (`app/sign-in/sign-in-button.tsx`) calls
  `authClient.signIn.social({ provider: "microsoft", callbackURL, errorCallbackURL:
  "/sign-in?error=1" })` — a failure inside the round trip comes back to that error URL.
  Only a failure to START the redirect needs handling client-side (success navigates
  away), and it arrives in two shapes the button treats alike: `signIn.social` RESOLVES
  with `{ error }` on a non-2xx (better-fetch throws only when configured to) and rejects
  on a network error. Both re-enable the button and render one inline "Sign-in failed"
  line, so it never sticks on "Signing in…".

## Sign-out

The Microsoft provider in `auth.ts` sets `prompt: "login"`, so every new browser
sign-in requests fresh Entra authentication even when a Microsoft SSO session is
already active. This protects the shared-computer flow: after a teacher signs out,
clicking sign-in must not silently sign the next person in as that teacher. Existing
Novedu sessions retain their fixed 30-day lifetime.

`lib/auth-actions.ts`'s `signOutAction` (a server action, wired to the sign-out button
in the user menu) deletes the student-mode cookie first — student mode must not outlive
the session, or the next person signing in on the same browser would silently start in
it — then calls `auth.api.signOut({ headers: await headers() })`, which deletes the
session row and clears the cookie, and redirects to `/sign-in`. This ends the Novedu
session only; it does not sign the browser out of Microsoft.

## `/device`

Where a person approves the command line's sign-in request. The CLI always prints a
complete link carrying its code (`/device?user_code=…`), so the page never asks anyone
to type one — without a code in the URL there is nothing to show.

- Visiting `/device?user_code=…` while signed in **claims** the code for that user via
  `auth.api.deviceVerify` — this is mandatory: `deviceApprove`/`deviceDeny` fail with
  "not claimed" unless the same signed-in user first viewed the code through this GET.
  That claim is also what makes approving possible for only the person who opened the
  link: someone else opening it sees the code's status with no client id and no buttons
  (rendered the same as an unknown/expired code).
- A **pending, claimed** code renders the requesting client's id, the signed-in
  account's name and email, a warning to approve only a code requested on the viewer's
  own machine a moment ago, and Approve/Deny buttons.
- The two decisions are server actions (`lib/device-actions.ts`,
  `deviceApproveAction`/`deviceDenyAction`) calling `auth.api.deviceApprove`/`deviceDeny`
  with `headers: await headers()` — no cookies are set, so the page stays server-only;
  each redirects back to `/device` with the outcome in the query
  (`?done=approved|denied` or `?error=1`).
- **No manual code-entry form.** The CLI always hands out the full link, so a bare visit
  to `/device` renders one line pointing back at it.
- The page is app-owned and styled like the rest — no Entra wording anywhere in it.

## Two auth channels

The app authenticates callers in exactly two ways; every server entry point uses one or
the other, never both:

1. **Browser cookie sessions** (this doc): the better-auth session cookie, the
   `proxy.ts` gate, `session.user`, teacher gating via `requireEffectiveTeacher()` — the
   channel for everything a human uses in the browser.
2. **CLI / API session-token bearer** (`docs/api.md`): the same session token, sent as
   `Authorization: Bearer …`, validated per request by `lib/api-auth.ts`
   (`requireBearerUser`/`requireBearerTeacher`) through `auth.api.getSession` — routes
   excluded per-path from the proxy matcher. **Only** the `Authorization` header is
   forwarded to better-auth, so a browser cookie can never authenticate this channel.
   Same identity model — `novedu_user.id` is the user id and `is_teacher` is the same
   server-owned column — but **no cookie and no student mode** (that is a cookie): the
   bearer path always sees the caller's real role.

The teacher-gating rule therefore splits by channel: cookie surfaces use
`requireEffectiveTeacher()`, bearer routes use `requireBearerTeacher()`.

## User display names

Every surface that shows a user id resolves it to a human name through
**`novedu_user.name`** — the value overwritten from the Entra profile on every sign-in
(exactly what the status bar shows for that person). There is no separate write path to
maintain: better-auth itself keeps `name` current as part of the sign-in it already
performs (`overrideUserInfoOnSignIn: true`), so there is nothing here analogous to a
per-request upsert.

- **Read — by LEFT JOIN, with a raw-id fallback.** Every surface that shows a user id
  resolves it in the SAME query that loads the rows: `ownerJoin`/`ownerLabel`
  (`lib/db/owners.ts`, shared by the teacher list pages), `listSavers`
  (`lib/writing-store.ts`), `getCodeStats` (`lib/code-stats-store.ts`), and `listReports`
  (`lib/report-store.ts`, backing the teacher **reports inbox** at `/reports` —
  `docs/reports.md`) LEFT-JOIN `novedu_user` BY VALUE (no FK), and the writing student
  page reads the name off the savers row it already loads. A missing row (an id that has
  never signed in through the web app, e.g. an old orphaned id) ⇒ `null` ⇒ the raw id is
  shown, kept as the element `title` so it's still visible on hover. The savers filter
  matches name **or** id.
- **No garbage collection.** Rows are never deleted — module-agnostic, so a deleted code
  never touches them. Anonymity is respected for free: a name is only ever shown where
  the id already is (`getCodeStats` nulls both for anonymous codes). The **one
  deliberate exception** is the reports inbox: a student who files a report waives their
  own anonymity by an explicit, on-form action, so `novedu_reports.user_id` (and the name
  resolved from it) is surfaced to the teacher even on an anonymous code — the store
  never reveals any *other* student, though (`docs/reports.md`).

## Student mode

A real teacher can temporarily view the app as a student ("View as student" in the
user menu). State = httpOnly session cookie `student-mode` (`lib/student-mode.ts`);
it only RESTRICTS, never grants, so it is unsigned. It is cleared on sign-out
(`lib/auth-actions.ts`) so it cannot leak into the next user's session. Derive ALL
teacher gating/display from **`getTeacherView()`** (or the `isEffectiveTeacher()` /
`requireEffectiveTeacher()` shorthands) in `lib/student-mode.ts` — NOT from
`session.user.isTeacher` / `requireTeacher()` directly, which ignore the mode.
`requireTeacher()` (`lib/session.ts`) remains the real-role check and gates ENTERING the
mode (`lib/student-mode-actions.ts`); exiting is ungated (the visible "Student
mode" pill in the status bar carries the Exit control). Kept out of `auth.ts` because
`proxy.ts` only checks that a session cookie is present and never imports `auth.ts`, and
student mode is app policy layered on top of a session rather than part of the auth
instance itself.

The family, all in `lib/student-mode.ts`:

| Export | Use |
| --- | --- |
| `teacherViewForSession(session)` | THE rule ("real teacher AND not simulating") → the triple, for a session the caller ALREADY has |
| `effectiveTeacherForSession(session)` | the rule's boolean half, same session-taking form |
| `getTeacherView()` | the `{ realTeacher, studentMode, effectiveTeacher }` triple — calls `getSession()` itself |
| `isEffectiveTeacher()` | boolean shorthand over `getTeacherView()` |
| `requireEffectiveTeacher()` | the throwing gate for teacher-only server work |
| `requireTeacherUserId()` | `requireEffectiveTeacher()` + the session user id, returned as `{ ok }` instead of thrown |
| `isStudentMode()` | the raw cookie read |

Every other export **delegates to `teacherViewForSession`**, so the rule has
exactly one definition, and that function is the only student-mode-aware reader
of the raw `session.user.isTeacher` claim (`requireTeacher()` in `lib/session.ts` reads
it only to gate entering the mode; the bearer channel, which has no student mode, reads
`is_teacher` through `requireBearerTeacher()` — `docs/api.md`). Reach for
a session-taking form only on a hot path that already called `getSession()` and would
otherwise look the session up twice — today that is the chat runtime route,
which gates reasoning display on it (`docs/chat.md`); both take `Session | null`
and treat `null` as a non-teacher.

The cookie NAME lives in `lib/student-mode-constants.ts` (re-exported from
`lib/student-mode.ts`), an import-free module so the Playwright specs — which set
the cookie directly and cannot load `next/headers` — spell it from one source.

## e2e session minting

e2e tests bypass interactive login entirely: `e2e/auth.setup.ts` upserts the test
principals directly into `novedu_user` (name, email, `is_teacher`) through `e2e/db.ts`,
inserts a `novedu_session` row for each (a random token, `expires_at` a day out), and
mints the matching cookie value through `e2e/session-cookie.ts` — `${token}.${sig}`
URL-encoded, the signature from better-auth's own `makeSignature` (`better-auth/crypto`,
async), stored under the `novedu.session_token` cookie name from `e2e/auth.constants.ts`
(`secure: false`, `Lax`, `localhost`, matching a local `http` server). Nothing on the test
side re-implements the format, so a minted cookie resolves to a session for the same
reason a real one does. Playwright `storageState` then injects it, exactly like the real
cookie better-auth would have set. `e2e/sign-in.spec.ts` mints from the same helper for
the cookies that resolve to nothing — a garbage value and a correctly signed one with no
session row — and asserts both reach `/` and render the "Sign in" link. Real auth stays
ON everywhere else; this only proves the gate lets a valid session through. Two states are
minted: a student (default,
`STORAGE_STATE`) and a teacher (`TEACHER_STORAGE_STATE`, `is_teacher: true`) —
teacher-only specs opt in via `test.use({ storageState: TEACHER_STORAGE_STATE })`. The
bearer-channel equivalent, `mintSessionToken` in `e2e/api-auth.utils.ts`, does the same
upsert-plus-session-row dance but returns the raw token for use as a bearer header
(`docs/api.md`, `docs/testing.md`).
