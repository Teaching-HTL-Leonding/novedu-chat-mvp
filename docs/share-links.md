# Tutor share links (chat deep links) & short URLs

Deep reference for the share-link subsystem. The always-on invariants are summarized
in `AGENTS.md`; this file has the full mechanics. Read it before touching the chat
entry point (`app/page.tsx`), `/share-tutor`, or link verification. Storage of links
in Azure Table Storage (and the credential rules) lives in `docs/azure-storage.md`.

## Signed deep links

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

## Short URLs (`/?link=<code>`)

Every created link is also stored in Azure Table Storage so it can be opened through
a short `/?link=<code>` form. The storage mechanics, table schema, garbage
collection, and credential rules are documented in `docs/azure-storage.md`. The
verification rules below are what matters for the share-link flow itself:

- `app/page.tsx` precedence (`selectShareSource` in `lib/share-link-store.ts`): full
  signed params (`tutor`+`sig`) win; else `?link=<code>` is resolved from the table
  and the stored values go through the **SAME** `verifyShareLink` — the HMAC stays
  the security boundary, the table is only an index. The CopilotKit route is
  untouched (still header-based; the page passes the resolved full values as headers).
- Lookup failures surface as `unknown-code` / `lookup-failed` reasons in
  `app/share-link-error.tsx`. Storage is OPTIONAL and degrades: if the table write
  fails when a teacher creates a link, the full signed link is still issued (with a
  `ShareLinkFormState.warning`); only the short link is unavailable.
