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

// The chat backend. Three server-side checks gate every runtime request — the
// frontend already performed them, but headers and bodies are client-
// controlled, so they are re-verified here where they actually matter:
//
//  1. AUTHENTICATION — a valid Entra session is required.
//  2. TUTOR CODE — the `x-tutor-code` header must name a stored tutor code
//     whose availability window contains "now" (one PK SELECT). Checked on
//     EVERY request, so an open chat stops accepting messages once the window
//     closes.
//  3. THREAD OWNERSHIP — every thread-touching request must carry the
//     `x-thread-token` HMAC binding (code, session user, threadId), signed by
//     app/[code]/page.tsx when it issued the threadId (lib/thread-token.ts).
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

  const code = req.headers.get("x-tutor-code") ?? "";
  const verification = await checkTutorCode(code);
  if (!verification.ok) {
    return Response.json({ error: REJECTION_MESSAGES[verification.reason] }, { status: 403 });
  }
  const { entry } = verification;

  const runtimeRequest = classifyRequest(req);
  if (runtimeRequest.kind === "unsupported") {
    // Includes OPTIONS: the chat is same-origin, so no request ever preflights.
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // THREAD OWNERSHIP (check 3). run/connect carry the threadId in their AG-UI
  // body — peek it out of a clone, the runtime still needs the original.
  let threadId: string | undefined;
  if (runtimeRequest.kind !== "info") {
    if (runtimeRequest.kind === "stop") {
      threadId = runtimeRequest.threadId;
    } else {
      const body: unknown = await req
        .clone()
        .json()
        .catch(() => undefined);
      const bodyThreadId = (body as { threadId?: unknown } | undefined)?.threadId;
      threadId = typeof bodyThreadId === "string" ? bodyThreadId : undefined;
    }
    const token = req.headers.get("x-thread-token");
    if (
      threadId === undefined ||
      !THREAD_ID_PATTERN.test(threadId) ||
      !verifyThreadToken(token, { code, userId, threadId }, getThreadTokenSecret())
    ) {
      return Response.json({ error: THREAD_REJECTION_MESSAGE }, { status: 403 });
    }
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
  const res = await app.fetch(req);

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
