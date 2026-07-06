# Authentication, teacher roles & student mode

Deep reference for the auth subsystem. The always-on invariants are summarized in
`AGENTS.md`; this file has the full mechanics. Read it before touching `auth.ts`,
`proxy.ts`, sessions, teacher gating, or student mode.

This app is gated by Microsoft Entra ID (Auth.js / NextAuth v5). Key facts so future
runs don't have to rediscover the setup:

- **`auth.ts`** (repo root) — the single `NextAuth({...})` instance exporting
  `handlers`, `auth`, `signIn`, `signOut`. The Entra provider reads `AZURE_CLIENT_ID`,
  `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` directly from `.env` (NOT the Auth.js
  `AUTH_MICROSOFT_ENTRA_ID_*` names). Issuer is the v2.0 tenant endpoint.
- **Sessions are JWT (JWE) — no database adapter.** The session cookie is encrypted,
  so it's safe to stash tokens in it. `AUTH_SECRET` (in `.env`) signs/encrypts it.
- **The gate** is the `authorized` callback (`!!auth?.user` — any signed-in Entra user
  is allowed; no group authorization). It's enforced by **`proxy.ts`** at the repo root
  (`export { auth as proxy }`). In Next 16 the `middleware` convention was renamed to
  `proxy`; the matcher protects everything except the public paths `api/auth`
  (sign-in), `api/version` (build-identity probe), `api/files` (the public YAML GET
  endpoint — see `docs/files.md`), `api/coding` (code-as-bearer-key — see
  `docs/coding.md`), `api/me` (Entra-bearer probe — see `docs/api.md`),
  `_next/static`, `_next/image`, `favicon.ico`.
- **Route handler:** `app/api/auth/[[...nextauth]]/route.ts` re-exports `handlers`.
- **Default sign-in/out pages** are Auth.js built-ins at `/api/auth/signin` and
  `/api/auth/signout` (no custom UI). An existing valid cookie won't re-prompt, so to
  force a fresh token issuance you must sign out first, then sign in.
- **Stable user id — `session.user.id` is the Entra `oid`, NOT `sub`.** The `jwt`
  callback captures `profile.oid` (Entra object id) onto the token and the `session`
  callback exposes it as `session.user.id` (falling back to `sub` only if a token
  ever lacks `oid`). This is the key everything user-scoped joins on: code
  ownership (`novedu_codes.created_by`), the user↔chat link
  (`novedu_user_chats.user_id`), and the `x-thread-token` signature. **Why `oid` and
  not `sub`:** Entra's `sub` is a *pairwise* subject id scoped to the redirect-URI
  host, so the SAME user receives a DIFFERENT `sub` on `localhost:3000` vs. the Azure
  hostname (and would get a new one if the prod hostname ever changed) — which
  silently partitions per-user data by environment. `oid` is constant for the user
  across every app and host within the tenant (Microsoft's recommended key; combine
  with `tid` only for multi-tenant apps — this app pins a single tenant). NOTE: the
  id is baked into the session JWT at sign-in, so a claim change only takes effect
  after sign-out + sign-in; rows created under an old id are orphaned.
- **Authorization — teacher role:** finer-grained access is by Entra **group**
  membership. The teacher group id is `TEACHER_GROUP_ID` in `.env`. On sign-in the `jwt`
  callback receives `profile` (the decoded Entra **ID token**); `lib/teacher.ts`
  `resolveTeacher(profile, TEACHER_GROUP_ID)` reads `profile.groups` and computes
  `isTeacher`, which is stored on the token and exposed as **`session.user.isTeacher`**.
  The `session.user.preferredUsername` field is likewise carried over from the ID token
  (`name`/`email`/`image` are populated by Auth.js automatically). The flag is computed
  **once at sign-in**, so a stale session reads `false` until re-sign-in.
  Gate teacher-only server actions / route handlers with
  **`requireEffectiveTeacher()`** from `lib/student-mode.ts` (throws → respond 403);
  it honors student mode (see below). `requireTeacher()` in `auth.ts` checks only the
  real role and is reserved for entering student mode.
- **Group claims config:** the `groups` claim must be enabled in the Entra app
  registration's **Token configuration** and emitted into the **ID token** (the access
  token's audience is Microsoft Graph and carries no usable groups). Watch for the
  group-overage indicator (`_claim_names` / `_claim_sources`): when a user is in too many
  groups Entra omits the array, and `resolveTeacher` reports `overage` and **fails closed
  (not a teacher)** — resolving it would need a Microsoft Graph call. Prefer "Groups
  assigned to the application" in Entra to avoid overage.
- **e2e tests** bypass interactive login by minting valid Auth.js session cookies in
  `e2e/auth.setup.ts` (signed with the same `AUTH_SECRET`) and injecting them via
  Playwright `storageState` (`e2e/auth.constants.ts`). Real auth stays ON; this only
  proves the gate lets a valid session through. TWO states are minted: a student
  (default, `STORAGE_STATE`, no `isTeacher` claim → `false`) and a teacher
  (`TEACHER_STORAGE_STATE`, `isTeacher: true`) — teacher-only specs opt in via
  `test.use({ storageState: TEACHER_STORAGE_STATE })`.

## Two auth channels

The app authenticates callers in exactly two ways; every server entry point uses
one or the other, never both:

1. **Browser cookie sessions** (this doc): Auth.js Entra sign-in, the `proxy.ts`
   gate, `session.user`, teacher gating via `requireEffectiveTeacher()` — the
   channel for everything a human uses in the browser.
2. **CLI / API bearer tokens** (`docs/api.md`): Entra access tokens for the
   app's own `cli.access` scope, validated per request by `lib/api-auth.ts`
   (`requireBearerUser` / `requireBearerTeacher`), routes excluded per-path from
   the proxy matcher. Same identity model — the `oid` is the user id and
   `resolveTeacher` derives the role from the token's `groups` claim — but **no
   session and no student mode** (that is a cookie): the bearer path always
   sees the caller's real role.

The teacher-gating rule therefore splits by channel: cookie surfaces use
`requireEffectiveTeacher()`, bearer routes use `requireBearerTeacher()`.

## User display names

The Entra `oid` is opaque, so teacher review surfaces resolve it to a human name
through **`novedu_users`** — one row per user, `user_id` (oid) → `display_name` (the
Entra `name` claim, i.e. exactly what the nav bar shows). The pieces:

- **Write — once per sign-in.** The `jwt` callback (the only place `profile` is
  present) upserts the name via **`lib/user-name-store.ts`** `upsertUserName`. This
  is the **one database write in the whole auth flow**. It runs only on an
  interactive sign-in, never on the per-request session decode, and the store is
  imported **dynamically** so the SQL driver stays off the proxy's hot path. Any
  error is **swallowed** — a DB hiccup must never block sign-in; the name just isn't
  recorded that time. A blank `name` is skipped (no row), so the oid stays the
  fallback. (Next 16's proxy runs on the **Node.js runtime** by default, so this is
  not an edge-bundling constraint — but keeping the write off the decode path and
  out of the static import graph is still the lean choice.)
- **Read — by LEFT JOIN, with oid fallback.** Every surface that shows a student id
  resolves it in the SAME query that loads the rows: `listSavers`
  (`lib/writing-store.ts`) and `getCodeStats` (`lib/code-stats-store.ts`) LEFT-JOIN
  `novedu_users` BY VALUE (no FK), and the writing student page reads the name off
  the savers row it already loads. A missing row (a user who hasn't signed in since
  the table existed) ⇒ `null` ⇒ the raw oid is shown, kept as the element `title` so
  it's still visible on hover. The savers filter matches name **or** oid.
- **No backfill, no history, no GC.** Names populate **gradually** as each user next
  signs in (no Microsoft Graph backfill). The upsert overwrites (no history), and
  rows are never garbage-collected — module-agnostic, so a deleted code never
  touches them. Anonymity is respected for free: a name is only ever shown where the
  oid already is (`getCodeStats` nulls both for anonymous codes).

## Student mode

A real teacher can temporarily view the app as a student ("View as student" in the
user menu). State = httpOnly session cookie `student-mode` (`lib/student-mode.ts`);
it only RESTRICTS, never grants, so it is unsigned. It is cleared on sign-out
(`lib/auth-actions.ts`) so it cannot leak into the next user's session. Derive ALL
teacher gating/display from **`getTeacherView()`** (or the `isEffectiveTeacher()` /
`requireEffectiveTeacher()` shorthands) in `lib/student-mode.ts` — NOT from
`session.user.isTeacher` / `requireTeacher()` directly, which ignore the mode.
`requireTeacher()` (auth.ts) remains the real-role check and gates ENTERING the
mode (`lib/student-mode-actions.ts`); exiting is ungated (the visible "Student
mode" pill in the status bar carries the Exit control). Kept out of auth.ts
because proxy.ts imports auth.ts into the proxy runtime, where `cookies()` is
unavailable.
