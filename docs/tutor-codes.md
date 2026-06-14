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
| `created_by` | session user id (Entra `oid`) of the creating teacher |
| `tutor_url` | public URL of the tutor YAML (normalized via `URL.href`) |
| `valid_from` / `valid_until` | availability window, UTC `datetime2`, **both bounds inclusive** |
| `note` | teacher's label, shown in their code list and as the recents label (≤ 200 chars) |
| `origin` | **documentation-only**: where the code was created (DEV vs PROD rows). Lookups never read it — a code created on localhost works in production, since all environments share the database |
| `anonymous` | the tutor YAML's `anonymous` flag (default `true`), **frozen at create time** — a later YAML edit does NOT update it. Gates whether chats are attributed (`novedu_user_chats`) and whether the stats page shows per-student data |
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
  whose row was deleted disappear by themselves. Clicking a recent
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

`/tutor-codes` ("Shared Tutor Codes", teacher-only) lists **all** of the
teacher's codes (`listTutorCodes`), newest first — active, not-yet-started
(`upcoming` badge), AND already-expired (`expired` badge), since codes are no
longer garbage-collected. Each row: note (fallback code, tutor-YAML URL as
tooltip), window in local time, a **Conversations** count (qualifying
conversations for that code, from `getInteractionCounts` — one aggregate query
for the whole list, links to the code's stats), an Open link (active codes
only), a Copy button, and a **Delete** button (`DeleteCodeButton` → the
`deleteTutorCodeAction` server action; confirms first, then wipes the code and
all of its conversation data — see Lifecycle).

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
novedu_user_chats.user_id  = Entra oid (the student)
novedu_tutor_codes.created_by = Entra oid (the teacher)
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

Note two SEPARATE reads of the same `anonymous` flag. The RUNTIME attribution
path above always reads it live from the YAML (so toggling a tutor to
`anonymous: false` starts attributing immediately). The STATS page instead reads
the copy **frozen onto `novedu_tutor_codes.anonymous` at create time** — it only
decides whether to surface per-student numbers, and freezing keeps that decision
stable for a code's lifetime even if the YAML changes later.

Caveat: with `resourceId = code`, any *resource-scoped* Mastra memory (working
memory, semantic recall) would be shared across all students using the same
code. Today only per-thread `lastMessages` is configured — keep it that way or
re-think the scoping first.

## Stats & conversation viewer

Teacher-only, under the `/tutor-codes` prefix (so the root `/[code]` student
catch-all never collides). Both pages gate on **code ownership**, NOT the
thread-ownership token: `getOwnedTutorCode(code, sub)` returns the row only when
`created_by` is the asking teacher — a teacher sees only their own codes.

- **`/tutor-codes/[code]`** — detailed stats (`getTutorCodeStats(code, anonymous)`):
  number of conversations, and for non-anonymous codes (the frozen `anonymous`
  flag) the number of distinct students; then a table of every conversation
  (first/last message time, user id when recorded, user-message count). Each row
  links to the viewer. "Conversation" = a Mastra thread with ≥ 1 `role = 'user'`
  message (opened-but-silent threads do not count).
  Anonymity is enforced **at the data layer**: the page passes the code's frozen
  `anonymous` flag into `getTutorCodeStats`, which for an anonymous code forces
  every `userId` to `null` and `studentCount` to `0` *before returning* — so it
  cannot surface who a student is even if `novedu_user_chats` holds rows (the
  documented case where the YAML was toggled to non-anonymous AFTER the code was
  minted; the live attribution flag and this frozen display flag are read
  separately — see "Chats, memory & the join model"). The page's own
  `!anonymous` rendering checks are now belt-and-braces on top of that.
- **`/tutor-codes/[code]/c/[threadId]`** — a READ-ONLY transcript. The server
  loads the messages (`getConversationMessages`, which re-checks the thread's
  `resourceId = code`) and converts each stored Mastra message to an AG-UI
  `Message` (text rebuilt from `parts`, since the top-level `content` is
  sometimes absent; `file` parts become inline images). The client (`ConversationView`)
  renders them with the **same message components the live chat uses** —
  `CopilotChatUserMessage` / `CopilotChatAssistantMessage` (the exact ones
  `CopilotChatMessageView` paints internally) — so bubbles, markdown, math and
  code match the real chat. There is NO `CopilotChat`/`useAgent`, so nothing runs
  or connects an agent. Those components DO reach into `CopilotKitCore`, so they
  need a `CopilotKitProvider`; the provider requires a `runtimeUrl` (it throws in
  production otherwise) and pings `/api/copilotkit/info` once on mount. That ping
  succeeds (200) because the runtime route serves **`/info` as auth-only metadata**
  — see below — even though the viewer sends no `x-tutor-code` header.

The runtime route's gate is therefore split: GET `/info` is the agent registry +
capabilities (no chat data) and is gated by **authentication alone**, so the
viewer's provider can mount; the DATA endpoints (`run`/`connect`/`stop`) stay
gated by the tutor code AND the thread-ownership token. Keep this in mind when
touching `app/api/copilotkit/[[...slug]]/route.ts`.

Privacy note: this lets a teacher read the *content* of conversations under their
codes. By design that is allowed — `anonymous` only hides *who* a student is
(the user id), never the message text; the thread-ownership HMAC remains the
student-side isolation and is unaffected.

## Lifecycle

- Tutor codes are **not** garbage-collected. A code and all of its conversation
  data persist until the teacher deletes the code on `/tutor-codes`
  (`deleteTutorCodeAndData` — Mastra threads/messages via Mastra's own
  `deleteThread`, then the `novedu_*` rows; see `docs/database.md`). An expired
  code stays listed: its chat no longer opens (`checkTutorCode`), but its stats
  remain reachable until it is deleted.
- Drizzle migrations apply at startup — see `docs/database.md`.

## Testing

The overall approach (layers, the `@live` boundary, the no-infra patterns) is in
**`docs/testing.md`**. Tutor-code specifics:

- `e2e/tutor-code.utils.ts` mints codes by inserting rows through the app's own
  store (loads `.env` like Next does), so any browser spec that mints or
  resolves a code needs the live database and is tagged `@live` (local only).
- The security-critical paths run in CI with **no** DB, because the gate
  short-circuits before any runtime is built: the runtime gate
  (`app/api/copilotkit/[[...slug]]/route.unit.test.ts`, real thread-token HMAC)
  and the chat page's consumption of `checkTutorCode`
  (`app/[code]/page.unit.test.tsx`) — together covering **both** consumers of the
  window check, so a regression in either fails CI — plus the rejection/error UI
  (`tests/component/tutor-code-error.browser.test.tsx`,
  `tutor-validation-views.browser.test.tsx`) and the window logic itself
  (`lib/tutor-code-store.unit.test.ts`).
