import { MastraAgent } from "@ag-ui/mastra";
import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime/v2";
import { after } from "next/server";
import { mastra } from "@/app/mastra";
import { auth } from "@/auth";
import { codeModules } from "@/lib/code-modules/registry";
import { type CodeRejection, checkCode } from "@/lib/code-store";
import { getThreadTokenSecret, verifyThreadToken } from "@/lib/thread-token";
import { recordUserChat } from "@/lib/user-chat-store";

// Human-readable rejection texts: a 403 can surface mid-session in the chat's
// error UI (e.g. when the window closes while the student is typing), so the
// message should explain, not just name a reason code.
const REJECTION_MESSAGES: Record<CodeRejection, string> = {
  "unknown-code": "This activity requires a valid code.",
  "not-started": "This activity's availability window has not started yet.",
  expired: "This activity's availability window has ended.",
  "lookup-failed": "Codes cannot be checked right now — try again in a moment.",
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
// required parameter. Distinct from any real code (codes are [a-z0-9-]{1,32}).
const INFO_RESOURCE_ID = "__info__";

// The runtime endpoints the CopilotKit v2 client actually uses, classified
// from the request path (segments after the /api/copilotkit base). Everything
// else 404s — see the THREAT MODEL note below.
type RuntimeRequest =
  | { kind: "info" }
  | { kind: "run" | "connect"; agentId: string; threadIdSource: "body" }
  | { kind: "stop"; agentId: string; threadId: string }
  | { kind: "unsupported" };

function classifyRequest(req: Request): RuntimeRequest {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  // segments[0..1] are "api"/"copilotkit"; the runtime sub-path follows.
  const sub = segments.slice(2);
  if (sub.length === 1 && sub[0] === "info" && req.method === "GET") {
    return { kind: "info" };
  }
  // `agent/<agentId>/{run|connect}` — the agent id is checked against the code's
  // module in the handler (each module runs exactly one agent), so the grader
  // stays unreachable even though Mastra knows about it.
  if (sub.length === 3 && sub[0] === "agent" && req.method === "POST") {
    const agentId = sub[1] ?? "";
    if (sub[2] === "run") return { kind: "run", agentId, threadIdSource: "body" };
    if (sub[2] === "connect") return { kind: "connect", agentId, threadIdSource: "body" };
  }
  const stopThreadId = sub[3];
  if (
    sub.length === 4 &&
    sub[0] === "agent" &&
    sub[2] === "stop" &&
    stopThreadId !== undefined &&
    req.method === "POST"
  ) {
    return { kind: "stop", agentId: sub[1] ?? "", threadId: decodeURIComponent(stopThreadId) };
  }
  return { kind: "unsupported" };
}

// Shared THREAD-OWNERSHIP check (+ run-history trim). Only run/connect/stop reach
// here; run/connect carry the threadId in their AG-UI body — peek it out of a
// clone, the runtime still needs the original. `run` additionally carries the
// full client-side message history; we rebuild its request with a body trimmed to
// the new turn (see trimToNewTurn) so Mastra persists only that turn + its reply
// instead of re-storing the whole history. `connect` is not trimmed — it opens
// the stream and carries no new turn.
//
// `code` is the value the thread token is bound to (the same for every module:
// the code itself, which is also the Mastra memory resourceId). Returns the
// verified threadId + the request to forward, or a 403 response.
async function resolveThreadOwnership(
  req: Request,
  runtimeRequest: Extract<RuntimeRequest, { kind: "run" | "connect" | "stop" }>,
  code: string,
  userId: string,
): Promise<
  { ok: true; threadId: string; forwardReq: Request } | { ok: false; response: Response }
> {
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
    return {
      ok: false,
      response: Response.json({ error: THREAD_REJECTION_MESSAGE }, { status: 403 }),
    };
  }
  return { ok: true, threadId, forwardReq };
}

// The chat backend, for EVERY module. Server-side checks gate every DATA request
// (run, connect, stop) — the frontend already performed them, but headers and
// bodies are client-controlled, so they are re-verified here where they actually
// matter:
//
//  1. AUTHENTICATION — a valid Entra session is required (ALL requests).
//  2. ACCESS — the `x-code` header names a stored, in-window code. Re-checked on
//     every DATA request, so an open activity stops accepting input once its
//     window closes. The code's `module` (read off the row) selects the renderer
//     here: which agent runs and how its RequestContext is built.
//  3. THREAD OWNERSHIP — every thread-touching request must carry the
//     `x-thread-token` HMAC binding (code, session user, threadId), signed when
//     the threadId was issued (lib/thread-token.ts).
//  4. AGENT — each module RUNS exactly one agent (codeModules[module].runtime
//     .agentId); any other agent id 404s, so the registered-but-internal
//     `quizEvaluator` grader is never reachable through the web route.
//
// The lone exception is GET `/info`: runtime metadata (the agent registry +
// capabilities) with no chat data, gated by AUTHENTICATION ALONE — the teacher's
// read-only conversation viewer needs it without a code.
//
// THREAT MODEL for check 3 and the endpoint allowlist: the threadId arrives in
// the client-controlled run body, and Mastra does NOT bind threads to a
// resource (@ag-ui/mastra fetches threads by id alone and silently rebinds
// their resourceId on save) — without the token, any code holder could replay
// another student's threadId and read/continue their chat. The CopilotKit
// runtime additionally exposes thread endpoints the app never uses; only the
// endpoints the client calls are forwarded, the rest 404. A stateless HMAC —
// not an ownership table — keeps the `anonymous` promise: nothing links users to
// threads in storage unless the activity opts out of anonymity
// (novedu_user_chats; see lib/user-chat-store.ts).
//
// The code becomes the Mastra memory `resourceId`, so every thread is grouped
// under it (`mastra_threads.resourceId`) — "all chats/discussions for a code" is
// one SQL query. The per-request system prompt + model reach the agent via
// RequestContext (built by the module; headers carry the code, not a query
// string, because CopilotKit appends sub-paths like `/info`).
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
  // NO chat data — gated by AUTHENTICATION ALONE. The teacher's read-only
  // conversation viewer pings `/info` on mount without any access header, so
  // requiring one here would 403 it for no benefit. The placeholder resourceId
  // is never consulted: `/info` runs no agent.
  if (runtimeRequest.kind === "info") {
    const runtime = new CopilotRuntime({
      agents: MastraAgent.getLocalAgents({ mastra, resourceId: INFO_RESOURCE_ID }),
    });
    const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });
    return app.fetch(req);
  }

  // ACCESS: one header scheme for every module. The row's `module` drives the
  // rest (agent + RequestContext).
  const code = req.headers.get("x-code") ?? "";
  const verification = await checkCode(code);
  if (!verification.ok) {
    return Response.json({ error: REJECTION_MESSAGES[verification.reason] }, { status: 403 });
  }
  const { entry } = verification;
  const def = codeModules[entry.module];

  // AGENT: each module runs exactly one agent; any other id 404s, so the
  // registered-but-internal `quizEvaluator` grader stays unreachable.
  if (runtimeRequest.agentId !== def.runtime.agentId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // These two are independent — the thread-ownership check (token verify + body
  // peek) and building the per-request context (the quiz module fetches its YAML
  // here, the tutor module does no I/O). Run them concurrently; an ownership
  // failure still takes precedence over a context-build failure.
  const [ownership, built] = await Promise.all([
    resolveThreadOwnership(req, runtimeRequest, code, userId),
    def.runtime.buildRequestContext(entry),
  ]);
  if (!ownership.ok) return ownership.response;
  if (!built.ok) {
    return Response.json({ error: built.message }, { status: built.status });
  }

  const runtime = new CopilotRuntime({
    agents: MastraAgent.getLocalAgents({
      mastra,
      resourceId: code,
      requestContext: built.context,
    }),
  });

  // createCopilotEndpoint returns a Hono app whose `.fetch` is a standard
  // (Request) => Response handler. Mounted on an optional catch-all route so it
  // serves both the base path and sub-routes like `/info`.
  const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });
  const res = await app.fetch(ownership.forwardReq);

  // Attribution bookkeeping AFTER the run actually started: the triple is
  // token-verified above, and gating on `res.ok` keeps requests the runtime
  // rejected from minting rows. recordUserChat dedupes repeat calls per thread,
  // reads the live `anonymous` flag for the code's file kind, and skips anonymous
  // activities (the default); it runs off the response path.
  if (runtimeRequest.kind === "run" && res.ok) {
    const verifiedThreadId = ownership.threadId;
    after(() => recordUserChat(code, verifiedThreadId, userId, entry.fileUrl, def.fileKind));
  }

  return res;
}

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
