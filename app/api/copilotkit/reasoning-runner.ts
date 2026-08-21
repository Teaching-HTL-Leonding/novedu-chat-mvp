import type { BaseEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { filter, type Observable } from "rxjs";

// The server-side seam that keeps a thinking model's chain of thought away from
// students: reasoning must never reach the browser AT ALL (hiding it in CSS
// would still ship the text to devtools), so it is dropped here, inside the
// runtime, before anything is written to the SSE stream.
//
// AG-UI's reasoning events. The enum is the contract (never hardcode the
// strings): `@ag-ui/mastra` emits only the five REASONING_* ones, but the whole
// family is filtered — the deprecated THINKING_* aliases carry exactly the same
// content under older names, and REASONING_MESSAGE_CHUNK /
// REASONING_ENCRYPTED_VALUE are the shapes another emitter may use. Filtering
// something nobody emits costs nothing; missing one leaks the scratchpad.
//
// Dropping the whole START…END group SYMMETRICALLY is what keeps the browser's
// `verifyEvents` validator happy — a lone REASONING_END would be a protocol
// error. The filter also sits DOWNSTREAM of the runtime's own verifier, so it
// can never trip server-side validation either.
const REASONING_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  EventType.REASONING_START,
  EventType.REASONING_MESSAGE_START,
  EventType.REASONING_MESSAGE_CONTENT,
  EventType.REASONING_MESSAGE_END,
  EventType.REASONING_MESSAGE_CHUNK,
  EventType.REASONING_END,
  EventType.REASONING_ENCRYPTED_VALUE,
  EventType.THINKING_START,
  EventType.THINKING_TEXT_MESSAGE_START,
  EventType.THINKING_TEXT_MESSAGE_CONTENT,
  EventType.THINKING_TEXT_MESSAGE_END,
  EventType.THINKING_END,
]);

/** True for every AG-UI event that carries (or frames) reasoning text. */
export function isReasoningEvent(event: BaseEvent): boolean {
  return REASONING_EVENT_TYPES.has(event.type);
}

/**
 * An `AgentRunner` decorator that strips every reasoning event from the two
 * paths into the SSE writer — `run` (the live turn) and `connect` (the
 * replay/reconnect stream) — and delegates `isRunning` / `stop` untouched.
 * Everything else passes through byte-identical and in order.
 *
 * FRAGILE ACROSS UPGRADES (same spirit as the welcome-screen override in
 * app/_tutor/welcome-view.tsx): it delegates METHOD BY METHOD to a 4-method
 * abstract class, so a future version that adds a fifth event-producing method
 * would bypass the filter entirely and silently leak reasoning to students. That
 * method list is GUARDED — `reasoning-runner.unit.test.ts` reads the four
 * abstract methods off the installed package's type declaration (they erase at
 * runtime) and fails when they change. Wrap the new method before upgrading.
 *
 * Note it deliberately does NOT re-expose `ɵsupportsLocalThreadEndpoints`, so
 * the runtime's local thread endpoints stay unsupported through this runner —
 * the route 404s them anyway (docs/codes.md).
 */
export class ReasoningStrippingRunner extends AgentRunner {
  private readonly inner: AgentRunner;

  /** Wraps a fresh `InMemoryAgentRunner` — the same default `CopilotRuntime` builds. */
  constructor(inner: AgentRunner = new InMemoryAgentRunner()) {
    super();
    this.inner = inner;
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    return this.inner.run(request).pipe(filter((event) => !isReasoningEvent(event)));
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    return this.inner.connect(request).pipe(filter((event) => !isReasoningEvent(event)));
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return this.inner.isRunning(request);
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    return this.inner.stop(request);
  }
}
