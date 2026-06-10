<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## CRITICAL: Load `mastra` skill first

Load the `mastra` skill BEFORE any Mastra work. Never rely on cached knowledge — APIs change between versions.

### Rules

- Register all agents, tools, workflows, and scorers in `src/mastra/index.ts`
- Use the `dev` and `build` scripts from `package.json` instead of running `mastra dev` / `mastra build` directly

### Resources

- [Mastra Documentation](https://mastra.ai/llms.txt)
- [Skills Discovery](https://mastra.ai/.well-known/skills/index.json)

## Pushing Changes to GitHub

Do **NOT** push changes to GitHub if not explitly told by the user.

## Authentication

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
  `proxy`; the matcher protects everything except `api/auth`, `_next/static`,
  `_next/image`, `favicon.ico`.
- **Route handler:** `app/api/auth/[[...nextauth]]/route.ts` re-exports `handlers`.
- **Default sign-in/out pages** are Auth.js built-ins at `/api/auth/signin` and
  `/api/auth/signout` (no custom UI). An existing valid cookie won't re-prompt, so to
  force a fresh token issuance you must sign out first, then sign in.
- **Authorization — teacher role:** finer-grained access is by Entra **group**
  membership. The teacher group id is `TEACHER_GROUP_ID` in `.env`. On sign-in the `jwt`
  callback receives `profile` (the decoded Entra **ID token**); `lib/teacher.ts`
  `resolveTeacher(profile, TEACHER_GROUP_ID)` reads `profile.groups` and computes
  `isTeacher`, which is stored on the token and exposed as **`session.user.isTeacher`**.
  The `session.user.preferredUsername` field is likewise carried over from the ID token
  (`name`/`email`/`image` are populated by Auth.js automatically). The flag is computed
  **once at sign-in** — sessions minted before it existed read `false` until re-sign-in.
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

- **Student mode:** a real teacher can temporarily view the app as a student
  ("View as student" in the user menu). State = httpOnly session cookie
  `student-mode` (`lib/student-mode.ts`); it only RESTRICTS, never grants, so it
  is unsigned. It is cleared on sign-out (`lib/auth-actions.ts`) so it cannot leak
  into the next user's session. Derive ALL teacher gating/display from
  **`getTeacherView()`** (or the `isEffectiveTeacher()` /
  `requireEffectiveTeacher()` shorthands) in `lib/student-mode.ts` — NOT from
  `session.user.isTeacher` / `requireTeacher()` directly, which ignore the mode.
  `requireTeacher()` (auth.ts) remains the real-role check and gates ENTERING the
  mode (`lib/student-mode-actions.ts`); exiting is ungated (the visible "Student
  mode" pill in the status bar carries the Exit control). Kept out of auth.ts
  because proxy.ts imports auth.ts into the proxy runtime, where `cookies()` is
  unavailable.

## Tutor share links (chat deep links)

- The chat (`/`) is reachable **only** via a signed deep link
  `/?tutor=<yaml-url>&start=<unix-s>&end=<unix-s>&sig=<hmac>`. `lib/share-links.ts`
  holds the pure sign/verify/build core (HMAC-SHA256 over the raw, un-encoded string
  `tutor={tutor}&start={start}&end={end}`; secret = `SHARE_LINK_SECRET` in `.env`,
  server-only). Window bounds are inclusive unix **seconds** (UTC).
- Teachers create links on `/share-tutor` (teacher-only, like `/validate-tutor` —
  page checks are UX, the server action / API route are the enforcement points).
  The form converts `datetime-local` values to unix seconds **in the browser** (the
  only place the user's timezone is known; helpers in `lib/datetime-local.ts`) and
  submits via the server action in `lib/share-link-actions.ts`, which signs and also
  validates the tutor YAML at share time.
- Verification is server-side in TWO places: `app/page.tsx` (server component —
  renders the chat or `app/share-link-error.tsx`) and the CopilotKit route
  (`app/api/copilotkit/[[...slug]]/route.ts`), which re-verifies the headers
  `x-tutor-url`/`x-share-start`/`x-share-end`/`x-share-sig` on EVERY runtime request
  (403 on failure) — so an open chat stops accepting messages once the window closes.
- Per-user Mastra memory: the CopilotKit route resolves the session and uses
  `session.user.id` (the JWT `sub`, set in the `session` callback in `auth.ts`) as
  the Mastra memory `resourceId`. Threads written before this change live under the
  shared resourceId `chat-prototype` and are intentionally abandoned (they were
  commingled across all users and carry no per-user value).
- Generated links point at `SHARE_LINK_ORIGIN` when set (recommended in
  production); otherwise the origin is derived from the request's
  x-forwarded-host/-proto / host headers (fine for local dev).
- e2e specs mint deep links directly with `e2e/share-link.utils.ts` (same secret +
  signing code as the server, loaded from `.env`).
