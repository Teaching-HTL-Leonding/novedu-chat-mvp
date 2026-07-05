# Chat (the CopilotKit surface)

Deep reference for the **live chat** — the single most reused surface in the app.
Every module's chat (tutor feedback, the writing assistant, the quiz discussion)
is **one shared primitive**, `ModuleChat`, plus that module's own slots; the
read-only conversation transcript is a deliberately separate surface. The
always-on invariants are summarized in `AGENTS.md`; this file has the full
mechanics. Read it before touching `app/module-chat.tsx`, the consumers
(`app/tutor-chat.tsx`, `app/_tutor/welcome-view.tsx`,
`app/[code]/_writing/writing-chat.tsx`, `app/[code]/_quiz/quiz-discussion.tsx`),
the read-only transcript (`app/codes/[code]/c/[threadId]/conversation-view.tsx`),
or the runtime-header helper (`lib/runtime-headers.ts`).

This is the **frontend** seam only. The backend — the `/api/copilotkit` route and
the per-module `CodeModuleRuntime` — lives in `docs/codes.md` and is untouched by
anything here.

## The one primitive (`ModuleChat`)

`app/module-chat.tsx` (a `"use client"` component) owns the dangerous, duplicated
CopilotKit wiring so each module supplies only what is unique to it. It owns:

- the **`CopilotKitProvider`** pointed at `runtimeUrl="/api/copilotkit"`, with the
  runtime `headers` prop and a `key` set to `providerKey` (the remount boundary);
- the **`@copilotkit/react-core/v2/styles.css`** import (once, here);
- the **`CopilotChat`** element with the server `threadId` pinned in explicit mode,
  the module's `agentId`, and the passthrough slots `labels` / `chatView` /
  `attachments`;
- the **markdown renderer** — `messageView={{ assistantMessage: { markdownRenderer:
  MarkdownRenderer } }}` (`MarkdownRenderer` from `./markdown-renderer`), so every
  module's assistant messages render math and code the same way;
- the **base chat container** — a `<div>` holding `CopilotChat`, with the fill
  recipe built in (`min-h-0 flex-1 overflow-hidden *:h-full`: fill the available
  height, never push the page taller, let CopilotChat own the internal scroll);
  the optional `className` prop is a cn-merged delta on top.

Modules supply the rest through props/slots:

| Slot | Type | What it carries |
| --- | --- | --- |
| `agentId` | `string` | the module runtime's agent id (must match the registered agent) |
| `threadId` | `string` | the server-minted Mastra thread id (pinned in explicit mode) |
| `headers` | `RuntimeHeaders` | the `x-code` + `x-thread-token` pair (below) |
| `providerKey` | `string` | the provider remount boundary — code (tutor/writing) or threadId (quiz) |
| `className` | `string?` | optional height/padding deltas, cn-merged onto the built-in chat container |
| `children` | `ReactNode?` | rendered INSIDE the provider, before the chat — frontend tools, feedback headers |
| `labels` | passthrough | welcome-greeting override (tutor) |
| `chatView` | passthrough | welcome-screen view override (tutor) |
| `attachments` | passthrough | image-upload config (tutor, vision-capable model) |

`children` render **inside** the provider and **before** the chat container, so a
slot that needs the CopilotKit React context — the writing tool registrar, the
quiz feedback header — works. The primitive is layout-agnostic: it renders
`{children}` + the chat `<div>` as a bare fragment, so a module that needs to lay
them out together (e.g. quiz's discussion body) wraps `<ModuleChat>` in its own
container — the provider emits no DOM, so that wrapper stays the surface's root.

```tsx
// className carries only writing's deltas (column flex + horizontal padding) —
// the fill recipe is ModuleChat's own.
<ModuleChat agentId="writing" providerKey={code} threadId={threadId} headers={headers} className="flex flex-col px-3">
  <GetCurrentTextTool currentTextRef={currentTextRef} />
</ModuleChat>
```

## The threadId gotcha

The single canonical explanation lives in `app/module-chat.tsx`, right above the
`CopilotChat` element. In short: the server-issued `threadId` MUST go through
**`CopilotChat`'s `threadId` prop** (explicit mode), **not** through
`CopilotChatConfigurationProvider` with `hasExplicitThreadId={false}`. The latter
looks equivalent but strands the agent mid-run — messages cleared, the chat stuck
"running" — on the first send. Explicit mode also fires a harmless `connect`
request on mount: the runtime replays the (empty) in-process history for the fresh
thread, token-checked exactly like a `run`.

Because the explanation now lives in one place, no module duplicates it. The one
deliberate interaction with it is the tutor welcome view (below), which overrides
the view's explicit-threadId gating flags to re-show the welcome screen — and that
override is documented next to itself in `app/_tutor/welcome-view.tsx`.

## Runtime headers

`lib/runtime-headers.ts` is the pure, client-safe seam that names the two runtime
headers and builds the object the provider's `headers` prop expects:

```ts
export const RUNTIME_CODE_HEADER = "x-code";
export const RUNTIME_THREAD_TOKEN_HEADER = "x-thread-token";
export type RuntimeHeaders = { "x-code": string; "x-thread-token": string };
export function buildRuntimeHeaders(code: string, threadToken: string): RuntimeHeaders;
```

`x-code` identifies the activity; `x-thread-token` is the stateless-HMAC
thread-ownership token over `(code, userId, threadId)`. Both are sent on **every**
runtime request (headers, not a query string, because CopilotKit appends sub-paths
like `/info` to the runtime URL) and both are **re-verified server-side on every
runtime touch** — never a bare DB lookup. The token is what isolates one student's
thread from another's; its derivation and the reasons it is stateless are in
`docs/codes.md`. The backend route reads the same header names literally, so the
constants here are the load-bearing contract.

Render sites build the pair once and hand it down: `app/[code]/render-tutor.tsx`
and `app/[code]/render-writing.tsx` pass `buildRuntimeHeaders(code, threadToken)`
into their chat components, and the quiz runner builds it for the discussion modal.

## How each module consumes it

Each consumer is a thin shell around `ModuleChat` that adds only its own DOM and
slots; none of them re-implement message rendering, streaming, input, the
provider, or the threadId decision.

**Tutor** (`app/tutor-chat.tsx`) wraps `ModuleChat` (`agentId="tutor"`,
`providerKey={code}`) in the tutor-specific shell: the dismissible
**image-upload error notice**. It passes `labels` (the optional welcome greeting),
a `chatView` from `useTutorWelcomeView(...)` (`app/_tutor/welcome-view.tsx` — the
fragile welcome-screen override, pinned to a CopilotKit version in a comment next
to itself), and, when the tutor's `llm.imageInput` is set, an `attachments` config
(vision-capable model, 5 MB cap, `onUploadFailed` driving the notice). Tutor needs
no height/padding delta, so it passes the base `.chat` class directly.

**Writing** (`app/[code]/_writing/writing-chat.tsx`) wraps `ModuleChat`
(`agentId="writing"`, `providerKey={code}`) with one child — the keystone,
read-only **`getCurrentText`** frontend tool. The tool lives in an inner
`GetCurrentTextTool` component that calls `useFrontendTool` and renders `null`; it
must be a `ModuleChat` child so the hook runs inside the provider's React context.
The handler returns the **live** editor buffer through a ref (never a stale
closure) **plus its length statistics** (character / word / paragraph counts, from
`lib/writing-stats.ts`, for checking length requirements), the tool takes **no
parameters**, and the `writing` agent has no write tool — so the assistant is
read-only by construction (`docs/writing.md`).

**Quiz** (`app/[code]/_quiz/quiz-discussion.tsx`) wraps `ModuleChat`
(`agentId="quizDiscussion"`, `providerKey={threadId}` — a fresh thread per
question) with the graded **feedback header** as its child: when `feedback` is set,
a `<div>` rendering it through `MarkdownRenderer`, above the chat. It wraps
`<ModuleChat>` in its own discussion-body flex container so the feedback + chat
share a column inside the modal. The thread was already minted and seeded server-side, so
the live chat starts visually blank while the model recalls the seeded context
from memory (`docs/codes.md`).

## The read-only transcript

`app/codes/[code]/c/[threadId]/conversation-view.tsx` (`ConversationView`) is the
teacher's read-only conversation viewer, and it is **not** a `ModuleChat`. It has
**no agent, no `threadId`, and no runtime headers**: it renders the stored messages
directly with the same message components the live chat paints internally
(`CopilotChatUserMessage` / `CopilotChatAssistantMessage`), through the same
`MarkdownRenderer`, so bubbles, markdown, math and code match — but there is no
chat input and nothing runs or connects an agent.

It shares only two things with the live chat: `runtimeUrl="/api/copilotkit"` (its
`CopilotKitProvider` needs one, and pings `/info` once on mount — served as
auth-only metadata) and the `MarkdownRenderer`. It does not fit `ModuleChat`'s
contract (it has none of the chat slots and would have to defeat the threadId
pinning), so folding it in would add branches for a fundamentally different,
agent-less surface. It stays separate on purpose.

## Adding a 4th module's chat

The chat itself is a one-liner — render `<ModuleChat agentId="…" providerKey={…}
threadId={…} headers={…} />` from the module's render component, adding
`children` only if the module needs a slot inside the provider (a frontend tool,
a header) and `className` only for module-specific deltas. Everything else
(provider, headers, the threadId decision, the markdown renderer, the base
container) comes for free.

Wiring the new module into the rest of the app — the descriptor, the registry
line, the label, the render case, the validator/`readAnonymousFlag` branch, the
agent, and the store — is the **codes** "adding a module" checklist in
`docs/codes.md`. Chat is just the surface that checklist's render case mounts.

## Markdown rendering

`ModuleChat` swaps CopilotKit v2's default Streamdown renderer for the custom
`MarkdownRenderer` (`app/markdown-renderer.tsx`) via the `markdownRenderer` slot.
The swap is deliberate: Streamdown defaults to `singleDollarTextMath: false` (so
inline `$...$` is not treated as math) **and** runs `rehype-sanitize`, which strips
KaTeX's class names and breaks rendered math — and CopilotKit does not expose
Streamdown's plugin config. The custom renderer is `react-markdown` with
`remark-gfm` / `remark-math` / `rehype-katex` (inline + block math) and renders
fenced code through `./code-block`. Dropping the sanitize step is safe here:
react-markdown does not parse raw HTML and allowlists URL schemes — the same
sanitized path the writing lightbox and teacher review rely on for untrusted
student Markdown (`docs/writing.md`). It runs with **no `rehype-raw`**; keep it
that way.

## Backend seam

Out of scope for this chapter. The `/api/copilotkit` route, the per-module
`CodeModuleRuntime` (agent selection, `RequestContext` building), the `x-code` /
`x-thread-token` re-verification, thread ownership, and the `trimToNewTurn`
persistence rule all live in `docs/codes.md`. `ModuleChat` only talks to that route
through `runtimeUrl` + the runtime headers.

## Tests

The shared-wiring tests follow `docs/testing.md`'s no-duplication principle: the
common chat logic is tested **exactly once**, against `ModuleChat`; the per-module
tests **mock `@/app/module-chat`**, so they assert only what is unique to the
module.

- **`tests/component/module-chat.browser.test.tsx`** — the single home of the
  shared-wiring assertions: the provider gets `runtimeUrl="/api/copilotkit"` + the
  exact `headers`; `CopilotChat` gets the explicit-mode `threadId`, the passed
  `agentId`, and a `messageView.assistantMessage.markdownRenderer`; `children`
  render inside the provider as direct members (no extra wrapper); `labels` /
  `chatView` / `attachments` pass through verbatim.
- **`tests/component/writing-chat.browser.test.tsx`** — the writing-unique
  `getCurrentText` keystone: the tool registers with `name: "getCurrentText"`,
  `agentId: "writing"`, **no `parameters`**, and `config.handler()` returns the
  **live** ref value (mutating the ref changes the result — proves a ref read, not a
  stale closure). Plus the one boundary check that it hands `ModuleChat`
  `agentId="writing"`, `providerKey={code}`, `threadId`, and the headers.
- **`tests/component/quiz-discussion.browser.test.tsx`** — the quiz-unique feedback
  header: the feedback markdown renders as the `ModuleChat` child (real
  `MarkdownRenderer`), empty feedback renders no block, and it hands `ModuleChat`
  `agentId="quizDiscussion"`, `providerKey={threadId}`, `threadId`, and the headers.
- **`tests/component/tutor-chat.browser.test.tsx`** — mocks `ModuleChat` and covers
  only the tutor-unique cases: the props it hands `ModuleChat` (incl.
  `title`→`labels`, `imageInput`→`attachments` with `onUploadFailed`, a
  `chatView`), the welcome-view composition, and the dismissible upload-error
  notice.
- **`tests/unit/runtime-headers.unit.test.ts`** — `buildRuntimeHeaders(code, token)`
  returns `{ "x-code": code, "x-thread-token": token }` exactly (a cheap guard on
  the header names the backend re-reads).

The refactor is behavior-preserving, so the live e2e specs are coverage, not
duplication — they drive the **real** CopilotKit end-to-end (which the component
layer mocks away), per module: `e2e/tutor-chat-reply.spec.ts`, `e2e/quiz.spec.ts`,
`e2e/writing.spec.ts` (and `e2e/chat-no-replay-persistence.spec.ts`). They are
`@live-llm`, local-only — see `docs/testing.md` for the `@live` boundary.
