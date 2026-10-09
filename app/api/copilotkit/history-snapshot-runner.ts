import type { BaseEvent } from "@ag-ui/client";
import { EventType, type Message } from "@ag-ui/core";
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from "@copilotkit/runtime/v2";
import { defer, from, Observable, switchMap } from "rxjs";
import { TUTOR_RESUME_GRACE_MS, withinResumeWindow } from "@/lib/tutor-history-gate";
import { loadThreadForChat } from "@/lib/tutor-history-store";

// The server half of a tutor's "resume on reload" (docs/chat.md → Resuming a
// conversation): an `AgentRunner` decorator that answers the chat's `connect`
// with the thread's STORED messages, so a reloaded tab sees its conversation
// again. It sits INNERMOST, directly around the `InMemoryAgentRunner`, so the
// reasoning stripper and the failure reporter see its frames like any other.
//
// Why a snapshot from the database: the in-memory runner only remembers runs of
// THIS process (LRU-bounded, lost on restart), and the browser wipes its message
// list on the first connect of a thread anyway. So the connect is answered with
//
//   RUN_STARTED{runId:"restore-<uuid>"} · MESSAGES_SNAPSHOT · RUN_FINISHED
//
// — the client verifier wants run framing around anything it applies — followed
// by the inner connect FILTERED: the in-process replay re-emits the very same
// messages (same ids: user messages keep their client-minted id in
// `mastra_messages`, an assistant reply streams under its stored id, or
// `<id>-agui-text` for text after a tool call), and the client APPENDS a replayed
// TEXT_MESSAGE_CONTENT to an existing message rather than replacing it. So every
// text/reasoning event of a stored id is dropped, and every tool call whose parent
// is a stored message is dropped with its args/end/result. What remains is bare
// run framing (harmless), a run whose save failed (shown, as a bonus), and a run
// still in flight, whose reply is not stored yet (a reload mid-answer).
//
// A HISTORIC `RUN_ERROR` (a failed run the in-memory store replays) would end
// the stream for the verifier — nothing may follow a RUN_ERROR — so it becomes a
// RUN_FINISHED of that same run. A LIVE one (the in-flight run failing) passes.
// Historic vs live: `InMemoryAgentRunner.connect` pushes its whole history into a
// ReplaySubject before returning, so everything that arrives DURING the subscribe
// call is history and everything later is live — pinned by the unit test.
//
// The connect is already token-verified (`x-thread-token` over the code, the
// session user and this thread) before it reaches any runner. The resume rule
// (lib/tutor-history-gate.ts) then applies the SAME idle limit as the resume
// action (plus a grace for the action → connect gap), so a hand-crafted client
// holding an old token gets no more from `connect` than the action would allow.
// Anything else — a refused rule, an empty thread, a database error — falls back
// to the plain inner connect: the behaviour without this runner, never a RUN_ERROR.
//
// FRAGILE ACROSS UPGRADES, like the other two decorators: it delegates the four
// abstract `AgentRunner` methods one by one (guarded in
// reasoning-runner.unit.test.ts), and it relies on undocumented behaviour of
// CopilotKit / AG-UI / Mastra (the connect wipe, the verifier's rules, the replay
// shape, the id alignment). Run the `@live-llm` reload round-trip
// (e2e/tutor-reload-roundtrip.spec.ts) before bumping any of them.

export interface HistorySnapshotScope {
  /** The verified code — the thread's Mastra `resourceId`. */
  code: string;
}

/** TEXT_MESSAGE_* and REASONING_* events: their `messageId` names the message they build. */
const MESSAGE_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  EventType.TEXT_MESSAGE_START,
  EventType.TEXT_MESSAGE_CONTENT,
  EventType.TEXT_MESSAGE_END,
  EventType.TEXT_MESSAGE_CHUNK,
  EventType.REASONING_START,
  EventType.REASONING_MESSAGE_START,
  EventType.REASONING_MESSAGE_CONTENT,
  EventType.REASONING_MESSAGE_END,
  EventType.REASONING_MESSAGE_CHUNK,
  EventType.REASONING_END,
  EventType.REASONING_ENCRYPTED_VALUE,
]);

/** The tool-call events that follow a TOOL_CALL_START by its `toolCallId`. */
const TOOL_FOLLOW_UP_TYPES: ReadonlySet<string> = new Set<string>([
  EventType.TOOL_CALL_ARGS,
  EventType.TOOL_CALL_END,
  EventType.TOOL_CALL_RESULT,
  EventType.TOOL_CALL_CHUNK,
]);

// `@ag-ui/mastra`'s suffix for assistant text streamed after a tool call within
// one reply (`MastraAgent.continuationMessageId`); stored under the base id.
const TEXT_CONTINUATION_SUFFIX = "-agui-text";

type LooseEvent = BaseEvent & {
  messageId?: unknown;
  parentMessageId?: unknown;
  toolCallId?: unknown;
  threadId?: unknown;
  runId?: unknown;
};

/** The three framing events that carry the stored conversation. */
export function snapshotFrame(threadId: string, messages: Message[]): BaseEvent[] {
  const runId = `restore-${crypto.randomUUID()}`;
  return [
    { type: EventType.RUN_STARTED, threadId, runId } as BaseEvent,
    { type: EventType.MESSAGES_SNAPSHOT, messages } as BaseEvent,
    { type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent,
  ];
}

/**
 * The inner connect with every event about a stored message removed and every
 * historic RUN_ERROR closed as a RUN_FINISHED (see the header).
 */
function filterReplay(
  inner: Observable<BaseEvent>,
  threadId: string,
  messages: Message[],
): Observable<BaseEvent> {
  const known = new Set<string>();
  for (const message of messages) {
    known.add(message.id);
    known.add(`${message.id}${TEXT_CONTINUATION_SUFFIX}`);
  }
  const droppedToolCalls = new Set<string>();

  return new Observable<BaseEvent>((subscriber) => {
    let historic = true;
    // The run a historic RUN_ERROR closes (RUN_ERROR itself names no run).
    let openRun: { threadId: string; runId: string } | undefined;

    const subscription = inner.subscribe({
      next: (raw) => {
        const event = raw as LooseEvent;
        if (event.type === EventType.RUN_STARTED) {
          openRun = {
            threadId: typeof event.threadId === "string" ? event.threadId : threadId,
            runId: typeof event.runId === "string" ? event.runId : crypto.randomUUID(),
          };
        } else if (event.type === EventType.RUN_FINISHED) {
          openRun = undefined;
        } else if (event.type === EventType.RUN_ERROR && historic) {
          const run = openRun ?? { threadId, runId: crypto.randomUUID() };
          openRun = undefined;
          subscriber.next({ type: EventType.RUN_FINISHED, ...run } as BaseEvent);
          return;
        }

        if (MESSAGE_EVENT_TYPES.has(event.type)) {
          if (typeof event.messageId === "string" && known.has(event.messageId)) return;
        } else if (
          event.type === EventType.TOOL_CALL_START ||
          (event.type === EventType.TOOL_CALL_CHUNK && typeof event.parentMessageId === "string")
        ) {
          if (
            typeof event.parentMessageId === "string" &&
            known.has(event.parentMessageId) &&
            typeof event.toolCallId === "string"
          ) {
            droppedToolCalls.add(event.toolCallId);
            return;
          }
        } else if (TOOL_FOLLOW_UP_TYPES.has(event.type)) {
          if (typeof event.toolCallId === "string" && droppedToolCalls.has(event.toolCallId)) {
            return;
          }
        }
        subscriber.next(raw);
      },
      error: (error) => subscriber.error(error),
      complete: () => subscriber.complete(),
    });
    historic = false;
    return () => subscription.unsubscribe();
  });
}

/**
 * Answers a tutor `connect` with the stored conversation when the resume rule
 * allows it; delegates `run` / `isRunning` / `stop` untouched (see the header).
 */
export class HistorySnapshotRunner extends AgentRunner {
  /** The runner this one decorates — PUBLIC so the route's suite can assert the chain. */
  readonly wrapped: AgentRunner;
  private readonly scope: HistorySnapshotScope;

  constructor(inner: AgentRunner, scope: HistorySnapshotScope) {
    super();
    this.wrapped = inner;
    this.scope = scope;
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    return this.wrapped.run(request);
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    return defer(() => from(this.restorableMessages(request.threadId))).pipe(
      switchMap((messages) => {
        // Subscribed only now, AFTER the database read: a run that finishes in
        // between is then part of the replay rather than lost.
        if (!messages) return this.wrapped.connect(request);
        return new Observable<BaseEvent>((subscriber) => {
          for (const event of snapshotFrame(request.threadId, messages)) subscriber.next(event);
          return filterReplay(this.wrapped.connect(request), request.threadId, messages).subscribe(
            subscriber,
          );
        });
      }),
    );
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return this.wrapped.isRunning(request);
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    return this.wrapped.stop(request);
  }

  /**
   * The stored messages to snapshot, or `undefined` for "connect as before": the
   * resume rule refuses, the thread is empty (a fresh one, e.g. after Start
   * over), or the read failed. Never throws.
   */
  private async restorableMessages(threadId: string): Promise<Message[] | undefined> {
    try {
      const loaded = await loadThreadForChat(this.scope.code, threadId);
      if (!loaded || loaded.messages.length === 0) return undefined;
      if (!withinResumeWindow(loaded.lastMessageAt, new Date(), TUTOR_RESUME_GRACE_MS)) {
        return undefined;
      }
      return loaded.messages;
    } catch (error) {
      console.error("history-snapshot-runner: preparing the snapshot failed", error);
      return undefined;
    }
  }
}
