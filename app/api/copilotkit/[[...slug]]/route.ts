import { MastraAgent } from "@ag-ui/mastra";
import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime/v2";
import { RequestContext } from "@mastra/core/request-context";
import { after } from "next/server";
import { mastra } from "@/app/mastra";
import { QUIZ_DISCUSSION_INSTRUCTIONS, QUIZ_DISCUSSION_MODEL } from "@/app/mastra/quiz-agents";
import { auth } from "@/auth";
import { loadQuiz } from "@/lib/quiz-fetch";
import { getQuizLinkSecret, quizLinkRejectionMessage, verifyQuizLink } from "@/lib/quiz-link";
import type { Quiz } from "@/lib/quiz-yaml";
import { getThreadTokenSecret, verifyThreadToken } from "@/lib/thread-token";
import { checkTutorCode, type TutorCodeRejection } from "@/lib/tutor-code-store";
import { recordQuizChat, recordUserChat } from "@/lib/user-chat-store";

// The agent ids the runtime route will RUN, one per branch. The tutor branch
// runs only "tutor"; the quiz discussion branch runs only "quizDiscussion".
// Crucially, `quizEvaluator` (the grader) is registered in Mastra but is NOT in
// this list, so it can never be invoked through the web route — only the
// server-side `submitAnswer` action calls it.
const TUTOR_AGENT_ID = "tutor";
const QUIZ_DISCUSSION_AGENT_ID = "quizDiscussion";

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
  // `agent/<agentId>/{run|connect}` — the agent id is checked per branch in the
  // handler (each branch allows exactly one agent), so the grader stays
  // unreachable even though Mastra knows about it.
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

// Shared THREAD-OWNERSHIP check (+ run-history trim) for both data branches.
// Only run/connect/stop reach here; run/connect carry the threadId in their
// AG-UI body — peek it out of a clone, the runtime still needs the original.
// `run` additionally carries the full client-side message history; we rebuild
// its request with a body trimmed to the new turn (see trimToNewTurn) so Mastra
// persists only that turn + its reply instead of re-storing the whole history.
// `connect` is not trimmed — it opens the stream and carries no new turn.
//
// `code` is the value the thread token is bound to: the TUTOR CODE for the tutor
// branch, the QUIZ URL for the quiz branch. Returns the verified threadId + the
// request to forward, or a 403 response.
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

// The discussion agent's system prompt: the quiz's `discussion.instructions`
// (optional) on top of a default frame. The question/answer/verdict are NOT
// repeated here — they are the thread's seed messages, recalled from memory.
function buildDiscussionInstructions(quiz: Quiz): string {
  const base =
    "You are helping a student understand a single quiz question. The conversation " +
    "already contains the question, the student's submitted answer, and the verdict " +
    "with feedback — use that context. Be concise and encouraging, and stay on this " +
    "question.";
  return quiz.discussionInstructions ? `${base}\n\n${quiz.discussionInstructions.trim()}` : base;
}

// The chat backend. Server-side checks gate every DATA request (run, connect,
// stop) — the frontend already performed them, but headers and bodies are
// client-controlled, so they are re-verified here where they actually matter:
//
//  1. AUTHENTICATION — a valid Entra session is required (ALL requests).
//  2. ACCESS — either the `x-tutor-code` header names a stored, in-window tutor
//     code (TUTOR branch) or the `x-quiz-*` headers carry a valid, in-window
//     SIGNED QUIZ LINK (QUIZ branch). Re-checked on every DATA request, so an
//     open chat stops accepting messages once its window closes.
//  3. THREAD OWNERSHIP — every thread-touching request must carry the
//     `x-thread-token` HMAC binding (code-or-quiz-url, session user, threadId),
//     signed when the threadId was issued (lib/thread-token.ts).
//  4. AGENT — each data branch RUNS exactly one agent (tutor → "tutor", quiz →
//     "quizDiscussion"); any other agent id 404s, so the registered-but-internal
//     `quizEvaluator` grader is never reachable through the web route.
//
// The lone exception is GET `/info`: runtime metadata (the agent registry +
// capabilities) with no chat data, gated by AUTHENTICATION ALONE — the teacher's
// read-only conversation viewer needs it without a tutor code.
//
// THREAT MODEL for check 3 and the endpoint allowlist: the threadId arrives in
// the client-controlled run body, and Mastra does NOT bind threads to a
// resource (@ag-ui/mastra fetches threads by id alone and silently rebinds
// their resourceId on save) — without the token, any link/code holder could
// replay another student's threadId and read/continue their chat. The CopilotKit
// runtime additionally exposes thread endpoints the app never uses; only the
// endpoints the client calls are forwarded, the rest 404. A stateless HMAC —
// not an ownership table — keeps the `anonymous` promise: nothing links users to
// threads in storage unless the tutor/quiz opts out of anonymity
// (novedu_user_chats; see lib/user-chat-store.ts).
//
// The resourceId (the tutor code, or the quiz URL) becomes the Mastra memory
// `resourceId`, so every thread is grouped under it (`mastra_threads.resourceId`)
// — "all chats/discussions for X" is one SQL query. The per-request system prompt
// + model reach the agent via RequestContext (headers carry the identifiers, not
// a query string, because CopilotKit appends sub-paths like `/info`).
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

  // Pick the branch from the headers the client sent: a tutor code, or a signed
  // quiz link. (run/connect/stop all carry an agentId — checked per branch.)
  const tutorCode = req.headers.get("x-tutor-code");
  const quizUrl = req.headers.get("x-quiz-url");

  // ── QUIZ DISCUSSION branch ────────────────────────────────────────────────
  if (quizUrl !== null && tutorCode === null) {
    if (runtimeRequest.agentId !== QUIZ_DISCUSSION_AGENT_ID) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const link = verifyQuizLink(
      {
        quiz: quizUrl,
        start: req.headers.get("x-quiz-start"),
        end: req.headers.get("x-quiz-end"),
        sig: req.headers.get("x-quiz-sig"),
      },
      getQuizLinkSecret(),
      Math.floor(Date.now() / 1000),
    );
    if (!link.ok) {
      return Response.json({ error: quizLinkRejectionMessage(link.reason) }, { status: 403 });
    }
    const resourceId = link.quiz;

    const ownership = await resolveThreadOwnership(req, runtimeRequest, resourceId, userId);
    if (!ownership.ok) return ownership.response;

    // The quiz YAML supplies the discussion system prompt + model + the live
    // anonymity flag (re-loaded server-side, never trusted from the client).
    const loaded = await loadQuiz(link.quiz);
    if (!loaded.ok) {
      return Response.json({ error: loaded.message }, { status: 502 });
    }
    const requestContext = new RequestContext();
    requestContext.set(QUIZ_DISCUSSION_INSTRUCTIONS, buildDiscussionInstructions(loaded.quiz));
    requestContext.set(QUIZ_DISCUSSION_MODEL, loaded.quiz.model);

    const runtime = new CopilotRuntime({
      agents: MastraAgent.getLocalAgents({ mastra, resourceId, requestContext }),
    });
    const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });
    const res = await app.fetch(ownership.forwardReq);

    if (runtimeRequest.kind === "run" && res.ok) {
      const verifiedThreadId = ownership.threadId;
      const anonymous = loaded.quiz.anonymous;
      after(() => recordQuizChat(resourceId, verifiedThreadId, userId, anonymous));
    }
    return res;
  }

  // ── TUTOR branch ──────────────────────────────────────────────────────────
  if (runtimeRequest.agentId !== TUTOR_AGENT_ID) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const code = tutorCode ?? "";
  const verification = await checkTutorCode(code);
  if (!verification.ok) {
    return Response.json({ error: REJECTION_MESSAGES[verification.reason] }, { status: 403 });
  }
  const { entry } = verification;

  const ownership = await resolveThreadOwnership(req, runtimeRequest, code, userId);
  if (!ownership.ok) return ownership.response;

  const requestContext = new RequestContext();
  requestContext.set("tutor-url", entry.tutorUrl);

  const runtime = new CopilotRuntime({
    agents: MastraAgent.getLocalAgents({ mastra, resourceId: code, requestContext }),
  });

  // createCopilotEndpoint returns a Hono app whose `.fetch` is a standard
  // (Request) => Response handler. Mounted on an optional catch-all route so it
  // serves both the base path and sub-routes like `/info`.
  const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });
  const res = await app.fetch(ownership.forwardReq);

  // Attribution bookkeeping AFTER the run actually started: the triple is
  // token-verified above, and gating on `res.ok` keeps requests the runtime
  // rejected from minting rows. recordUserChat dedupes repeat calls per thread
  // and skips anonymous tutors (the default); it runs off the response path.
  if (runtimeRequest.kind === "run" && res.ok) {
    const verifiedThreadId = ownership.threadId;
    after(() => recordUserChat(code, verifiedThreadId, userId, entry.tutorUrl));
  }

  return res;
}

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
