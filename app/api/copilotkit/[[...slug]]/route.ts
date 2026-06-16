import { MastraAgent } from "@ag-ui/mastra";
import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime/v2";
import { RequestContext } from "@mastra/core/request-context";
import { after } from "next/server";
import { mastra } from "@/app/mastra";
import { auth } from "@/auth";
import { getThreadTokenSecret, verifyThreadToken } from "@/lib/thread-token";
import { checkTutorCode, type TutorCodeRejection } from "@/lib/tutor-code-store";
import { recordUserChat } from "@/lib/user-chat-store";

// Human-readable rejection texts: a 403 can surface mid-session in the chat's
// error UI (e.g. when the window closes while the student is typing), so the
// message should explain, not just name a reason code.
const REJECTION_MESSAGES: Record<TutorCodeRejection, string> = {
  "unknown-code": "The chat requires a valid tutor code.",
  "not-started": "This tutor's availability window has not started yet.",
  expired: "This tutor's availability window has ended.",
  "lookup-failed": "Tutor codes cannot be checked right now — try again in a moment.",
};

const THREAD_REJECTION_MESSAGE =
  "This chat does not belong to your session — reload the page to start a new chat.";

// Belt-and-braces shape check before the HMAC; the page issues UUIDs but the
// token (not this pattern) is what actually proves ownership.
const THREAD_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

// CopilotKit/AG-UI re-sends the ENTIRE client-side conversation on every run,
// and Mastra persists whatever messages it is handed (each with a fresh id) —
// so forwarding the whole history re-stores every prior turn again. The
// conversation then balloons quadratically and the read-only viewer shows each
// turn many times. Mastra's own guidance (`@mastra/memory` message-history
// docs) is to send ONLY the new message and let `lastMessages` memory supply
// the prior context. So keep just the turn AFTER the last assistant reply:
// everything up to and including it is already persisted in this thread. The
// first turn (no assistant message yet) and any degenerate empty tail pass
// through unchanged — returning the SAME array signals "no trim needed".
export function trimToNewTurn<T extends { role?: unknown }>(messages: T[]): T[] {
  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      lastAssistant = i;
      break;
    }
  }
  if (lastAssistant < 0) return messages;
  const tail = messages.slice(lastAssistant + 1);
  return tail.length > 0 ? tail : messages;
}

// resourceId handed to the runtime when serving `/info` (metadata only, runs no
// agent), so it is never used to read or write memory — it just satisfies the
// required parameter. Distinct from any real tutor code (codes are [a-z0-9]{10}).
const INFO_RESOURCE_ID = "__info__";

// The runtime endpoints the CopilotKit v2 client actually uses, classified
// from the request path (segments after the /api/copilotkit base). Everything
// else 404s — see the THREAT MODEL note below.
type RuntimeRequest =
  | { kind: "info" }
  | { kind: "run" | "connect"; threadIdSource: "body" }
  | { kind: "stop"; threadId: string }
  | { kind: "unsupported" };

function classifyRequest(req: Request): RuntimeRequest {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  // segments[0..1] are "api"/"copilotkit"; the runtime sub-path follows.
  const sub = segments.slice(2);
  if (sub.length === 1 && sub[0] === "info" && req.method === "GET") {
    return { kind: "info" };
  }
  if (sub.length === 3 && sub[0] === "agent" && req.method === "POST") {
    if (sub[2] === "run") return { kind: "run", threadIdSource: "body" };
    if (sub[2] === "connect") return { kind: "connect", threadIdSource: "body" };
  }
  const stopThreadId = sub[3];
  if (
    sub.length === 4 &&
    sub[0] === "agent" &&
    sub[2] === "stop" &&
    stopThreadId !== undefined &&
    req.method === "POST"
  ) {
    return { kind: "stop", threadId: decodeURIComponent(stopThreadId) };
  }
  return { kind: "unsupported" };
}

// The chat backend. Three server-side checks gate every DATA request (run,
// connect, stop) — the frontend already performed them, but headers and bodies
// are client-controlled, so they are re-verified here where they actually
// matter:
//
//  1. AUTHENTICATION — a valid Entra session is required (ALL requests).
//  2. TUTOR CODE — the `x-tutor-code` header must name a stored tutor code
//     whose availability window contains "now" (one PK SELECT). Checked on
//     every DATA request, so an open chat stops accepting messages once the
//     window closes.
//  3. THREAD OWNERSHIP — every thread-touching request must carry the
//     `x-thread-token` HMAC binding (code, session user, threadId), signed by
//     app/[code]/page.tsx when it issued the threadId (lib/thread-token.ts).
//
// The lone exception is GET `/info`: runtime metadata (the agent registry +
// capabilities) with no chat data, so it is gated by AUTHENTICATION ALONE — the
// teacher's read-only conversation viewer needs it without a tutor code. See the
// `info` branch in the handler.
//
// THREAT MODEL for check 3 and the endpoint allowlist: the threadId arrives in
// the client-controlled run body, and Mastra does NOT bind threads to a
// resource (@ag-ui/mastra fetches threads by id alone and silently rebinds
// their resourceId on save) — without the token, any code-holder could replay
// another student's threadId and read/continue their chat. The CopilotKit
// runtime additionally exposes thread endpoints the app never uses
// (/threads/{id}/messages serves messages straight from the in-process run
// cache, plus list/update/delete/clear, /transcribe, /annotate); only the
// endpoints the client calls are forwarded, the rest 404. A stateless HMAC —
// not an ownership table — keeps the `anonymous: true` promise: nothing links
// users to threads in storage.
//
// The TUTOR CODE becomes the Mastra memory `resourceId`, so every chat thread
// is grouped under its code in the database (`mastra_threads.resourceId`) —
// "all chats for a code" is a single SQL query. Which USER owns a thread is
// recorded separately in `novedu_user_chats`, and only when the tutor opts out
// of anonymity — see lib/user-chat-store.ts.
//
// The stored tutor URL is handed to the `tutor` agent via RequestContext,
// where its dynamic `instructions`/`model` resolvers read it. (A header — not a
// query string — carries the code, because CopilotKit appends sub-paths like
// `/info` to the runtime URL, which a query string would corrupt.) The runtime
// is built per request; the heavy work (fetch + assemble the YAML) is memoized
// inside the tutor agent, so this stays cheap.
async function handler(req: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const runtimeRequest = classifyRequest(req);
  if (runtimeRequest.kind === "unsupported") {
    // Includes OPTIONS: the chat is same-origin, so no request ever preflights.
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // INFO is runtime METADATA — the agent registry and AG-UI capabilities, with
  // NO chat data — so it is gated by AUTHENTICATION ALONE (the data endpoints
  // below still require the tutor code AND the thread token). The teacher's
  // read-only conversation viewer mounts a CopilotKitProvider purely to render
  // stored messages; that provider pings `/info` on mount but sends no
  // `x-tutor-code` header, so requiring a valid code here would 403 it for no
  // benefit — and would not work at all for an EXPIRED code, whose conversations
  // are still viewable. The placeholder resourceId is never consulted: `/info`
  // runs no agent (it is only used to scope memory on an actual run).
  if (runtimeRequest.kind === "info") {
    const runtime = new CopilotRuntime({
      agents: MastraAgent.getLocalAgents({ mastra, resourceId: INFO_RESOURCE_ID }),
    });
    const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });
    return app.fetch(req);
  }

  const code = req.headers.get("x-tutor-code") ?? "";
  const verification = await checkTutorCode(code);
  if (!verification.ok) {
    return Response.json({ error: REJECTION_MESSAGES[verification.reason] }, { status: 403 });
  }
  const { entry } = verification;

  // THREAD OWNERSHIP (check 3). Only run/connect/stop reach here; run/connect
  // carry the threadId in their AG-UI body — peek it out of a clone, the runtime
  // still needs the original.
  //
  // `run` additionally carries the full client-side message history; we rebuild
  // its request with a body trimmed to the new turn (see trimToNewTurn) so
  // Mastra persists only that turn + its reply instead of re-storing the whole
  // history. `connect` is not trimmed — it opens the stream and carries no new
  // turn. `forwardReq` is what we hand to the runtime: the original request
  // unless we rebuilt a trimmed one.
  let threadId: string | undefined;
  let forwardReq: Request = req;
  if (runtimeRequest.kind === "stop") {
    threadId = runtimeRequest.threadId;
  } else {
    const body = (await req
      .clone()
      .json()
      .catch(() => undefined)) as { threadId?: unknown; messages?: unknown } | undefined;
    const bodyThreadId = body?.threadId;
    threadId = typeof bodyThreadId === "string" ? bodyThreadId : undefined;

    if (runtimeRequest.kind === "run" && body && Array.isArray(body.messages)) {
      const trimmed = trimToNewTurn(body.messages as Array<{ role?: unknown }>);
      if (trimmed !== body.messages) {
        // Rebuild the request with the trimmed history. Drop content-length so
        // the platform recomputes it for the shorter body.
        const headers = new Headers(req.headers);
        headers.delete("content-length");
        forwardReq = new Request(req.url, {
          method: req.method,
          headers,
          body: JSON.stringify({ ...body, messages: trimmed }),
        });
      }
    }
  }
  const token = req.headers.get("x-thread-token");
  if (
    threadId === undefined ||
    !THREAD_ID_PATTERN.test(threadId) ||
    !verifyThreadToken(token, { code, userId, threadId }, getThreadTokenSecret())
  ) {
    return Response.json({ error: THREAD_REJECTION_MESSAGE }, { status: 403 });
  }

  const requestContext = new RequestContext();
  requestContext.set("tutor-url", entry.tutorUrl);

  const runtime = new CopilotRuntime({
    agents: MastraAgent.getLocalAgents({ mastra, resourceId: code, requestContext }),
  });

  // createCopilotEndpoint returns a Hono app whose `.fetch` is a standard
  // (Request) => Response handler. Mounted on an optional catch-all route so it
  // serves both the base path and sub-routes like `/info`.
  const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });
  const res = await app.fetch(forwardReq);

  // Attribution bookkeeping AFTER the run actually started: the triple is
  // token-verified above, and gating on `res.ok` keeps requests the runtime
  // rejected from minting rows. recordUserChat dedupes repeat calls per thread
  // and skips anonymous tutors (the default); it runs off the response path.
  if (runtimeRequest.kind === "run" && res.ok && threadId !== undefined) {
    const verifiedThreadId = threadId;
    after(() => recordUserChat(code, verifiedThreadId, userId, entry.tutorUrl));
  }

  return res;
}

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
