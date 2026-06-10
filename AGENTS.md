<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## CRITICAL: Load `mastra` skill first

Load the `mastra` skill BEFORE any Mastra work. Never rely on cached knowledge — APIs change between versions.

## Rules

- Register all agents, tools, workflows, and scorers in `src/mastra/index.ts`
- Use the `dev` and `build` scripts from `package.json` instead of running `mastra dev` / `mastra build` directly

## Resources

- [Mastra Documentation](https://mastra.ai/llms.txt)
- [Skills Discovery](https://mastra.ai/.well-known/skills/index.json)

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
  Use **`requireTeacher()`** (exported from `auth.ts`) to gate teacher-only server
  actions / route handlers (it throws → respond 403).
- **Group claims config:** the `groups` claim must be enabled in the Entra app
  registration's **Token configuration** and emitted into the **ID token** (the access
  token's audience is Microsoft Graph and carries no usable groups). Watch for the
  group-overage indicator (`_claim_names` / `_claim_sources`): when a user is in too many
  groups Entra omits the array, and `resolveTeacher` reports `overage` and **fails closed
  (not a teacher)** — resolving it would need a Microsoft Graph call. Prefer "Groups
  assigned to the application" in Entra to avoid overage.
- **e2e tests** bypass interactive login by minting a valid Auth.js session cookie in
  `e2e/auth.setup.ts` (signed with the same `AUTH_SECRET`) and injecting it via
  Playwright `storageState` (`e2e/auth.constants.ts`). Real auth stays ON; this only
  proves the gate lets a valid session through. The minted token has no `isTeacher`
  claim, so `session.user.isTeacher` is `false` in e2e; add `isTeacher: true` to the
  minted token in `auth.setup.ts` to exercise teacher-only paths.
