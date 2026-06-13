# Tutor Codes

Deep reference for how students reach a tutor chat. The always-on invariants
are summarized in `AGENTS.md`; this file has the full mechanics. Read it before
touching the chat entry points (`app/page.tsx`, `app/[code]/page.tsx`), the
runtime route (`app/api/copilotkit/[[...slug]]/route.ts`), or the `novedu_*`
stores in `lib/`.

## The model

A **Tutor Code** is a 10-character `[a-z0-9]` code (36^10 ≈ 3.6 × 10^15 —
unguessable) minted by a teacher on `/share-tutor` and stored as a row in the
`novedu_tutor_codes` SQL table:

| Column | Meaning |
| --- | --- |
| `code` (PK) | the tutor code |
| `created_by` | Entra `sub` of the creating teacher |
| `tutor_url` | public URL of the tutor YAML (normalized via `URL.href`) |
| `valid_from` / `valid_until` | availability window, UTC `datetime2`, **both bounds inclusive** |
| `note` | teacher's label, shown in their code list and as the recents label (≤ 200 chars) |
| `origin` | **documentation-only**: where the code was created (DEV vs PROD rows). Lookups never read it — a code created on localhost works in production, since all environments share the database |
| `created_at` | creation time |

**The stored row is the security boundary.** There is no signature and no
stateless link form: a chat opens if (and only while) a row with that code
exists and "now" is inside its window. The single check lives in
`checkTutorCode()` (`lib/tutor-code-store.ts`) and is used by BOTH gates:

1. **`app/[code]/page.tsx`** — the chat page. Server component: resolves the
   code, then validates the tutor YAML (`loadAndBuildTutorPrompt`, uncached so
   YAML edits show immediately). Failures render `app/tutor-code-error.tsx`
   (`unknown-code` / `not-started` / `expired` / `lookup-failed`, with the
   window bounds in local time where known).
2. **`app/api/copilotkit/[[...slug]]/route.ts`** — the chat runtime. Reads the
   `x-tutor-code` header (set by `TutorChat`; headers, not a query string,
   because CopilotKit appends sub-paths like `/info` to the runtime URL) and
   re-checks **on every request** — one PK SELECT on the pooled connection —
   so an open chat stops accepting messages the moment the window closes
   (403 with a human-readable reason). The tutor URL the agent uses comes from
   the database row, never from the client.

The runtime route additionally enforces **thread ownership**: the Mastra
thread id is generated server-side in `app/[code]/page.tsx` and signed —
HMAC-SHA256 over `(code, userId, threadId)`, key derived from `AUTH_SECRET`
(`lib/thread-token.ts`) — into the `x-thread-token` header that travels next
to `x-tutor-code`. Every thread-touching runtime request (`agent/{id}/run`,
`agent/{id}/connect`, `agent/{id}/stop/{threadId}`) must carry a token
matching the **session user**, so a leaked threadId (even with its token) is
useless to anyone else; all runtime endpoints the app does not use
(`/threads/*`, `/transcribe`, `/annotate`, …) return 404. This is the ONLY
thread isolation there is: Mastra itself fetches threads by id without
checking the resourceId. The token is stateless on purpose — an ownership
table would break the anonymity promise below.

Keep both gates in sync (including the two headers). Malformed codes are
pattern-rejected without a database round-trip — which also gives every
unknown single-segment URL (`/whatever`) a clean "unknown tutor code" page,
since `app/[code]` catches all non-static top-level paths.

## URLs & entry page

- The chat lives at **`/<code>`** — no query parameters. Teachers hand out
  `https://<host>/<code>`; the code alone also works.
- **`/`** is the entry page: a form that accepts a bare code or a pasted full
  URL (the client extracts the last path segment; format-only validation),
  plus the user's **recently used codes** as one-click shortcuts.
- Recents live in SQL (`novedu_recent_codes`, PK `user_id` + `code`,
  `last_used`), recorded server-side after every successful chat open and
  capped at the newest 10 per user. The entry page lists them via an inner
  join with `novedu_tutor_codes` (label = `note`, fallback code) — so codes
  whose row was garbage-collected disappear by themselves. Clicking a recent
  code that turns out dead (`unknown-code` / `expired`) removes the row
  server-side (`app/[code]/page.tsx` via `after()`); `not-started` and
  transient `lookup-failed` keep it.

## Creating codes

`/share-tutor` ("Create Tutor Code", teacher-only via
`requireEffectiveTeacher()` in the server action): tutor URL, optional note,
window as `datetime-local` (converted to unix seconds IN THE BROWSER — the
only place the teacher's timezone is known). The action
(`lib/tutor-code-actions.ts`) validates the input, loads the tutor YAML
(broken tutors are rejected at create time), and inserts the row. **A storage
failure is a hard error** — without a row there is nothing to hand out. The
displayed URL's origin comes from `TUTOR_CODE_ORIGIN` (recommended in
production) or the request's forwarded/host headers (fine for dev); it is
display-only.

`/tutor-codes` ("Shared Tutor Codes", teacher-only) lists the teacher's
still-valid codes (`valid_until >= now`, including not-yet-started), newest
first: note (fallback code, tutor-YAML URL as tooltip), window in local time,
Open link, Copy button (absolute URL from `window.location.origin`).

## Chats, memory & the join model

The Mastra memory **`resourceId` is the tutor code** (set in the runtime
route), and `threadId` is a per-chat UUID generated **server-side per page
load** in `app/[code]/page.tsx`, pinned into the CopilotKit client via
CopilotChat's `threadId` prop (explicit mode — see the comment in
`app/tutor-chat.tsx` for why the prop, not the configuration provider) and
proven back to the runtime by the `x-thread-token` ownership token (nothing is
persisted client-side — a reload starts a fresh thread). Relationships across
the Drizzle- and Mastra-owned tables are **by value — never foreign keys**
(`docs/database.md`):

```
novedu_tutor_codes.code = novedu_user_chats.code = mastra_threads.resourceId
novedu_user_chats.thread_id = mastra_threads.id = mastra_messages.thread_id
novedu_user_chats.user_id  = Entra sub (the student)
novedu_tutor_codes.created_by = Entra sub (the teacher)
```

- **All chats for a code**: `SELECT * FROM mastra_threads WHERE resourceId = '<code>'`.
- **user → userchat → history**: filter `novedu_user_chats` by `user_id`, join
  `mastra_threads`/`mastra_messages` via `thread_id`.

`novedu_user_chats` is the ONLY place tying users to chats, and it is
privacy-gated by the tutor YAML's **`anonymous` flag (default `true`)**: by
default nothing is written — chats cannot be attributed to a student. Only a
tutor with `anonymous: false` records `(thread_id, code, user_id)`; the flag
is read server-side from the YAML behind the stored tutor URL
(`lib/user-chat-store.ts`, called from the runtime route off the response path
via `after()` — only after a token-verified run got a 2xx — deduped per
thread, privacy-safe on YAML load failure, which is retried rather than
cached). The
per-user `novedu_recent_codes` shortcuts are deliberately separate — they say
"this user opened this code", never which chat is theirs.

Caveat: with `resourceId = code`, any *resource-scoped* Mastra memory (working
memory, semantic recall) would be shared across all students using the same
code. Today only per-thread `lastMessages` is configured — keep it that way or
re-think the scoping first.

## Lifecycle

- Expired codes are garbage-collected **hourly** by an in-process timer
  (`instrumentation.ts` → `lib/tutor-code-gc.ts`), together with orphaned
  recents. `novedu_user_chats` is never collected.
- Drizzle migrations apply at startup — see `docs/database.md`.

## e2e

`e2e/tutor-code.utils.ts` mints codes by inserting rows through the app's own
store (loads `.env` like Next does) — that needs the live database, so every
spec that mints or resolves a code is tagged `@live` and excluded in CI
(`test:e2e:ci`). Non-live coverage: the entry form, malformed-code rejection,
and the share form's validation errors.
