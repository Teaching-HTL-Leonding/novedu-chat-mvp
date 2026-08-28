import type { BaseEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from "@copilotkit/runtime/v2";
import { type Observable, tap } from "rxjs";
import { recordError } from "@/lib/telemetry";

// Making a failed chat turn VISIBLE to an operator.
//
// WHY A RUNNER AND NOT A try/catch IN THE ROUTE (GitHub #26): the model call
// happens inside the Mastra agent, behind an SSE stream that the route has
// already returned 200 for. A handler-level catch therefore sees nothing at all
// — a turn that dies on an upstream 400 (an image the vision model cannot
// decode, a body the endpoint rejects) looks, from the route's perspective,
// exactly like a turn that succeeded. The failure travels in-band, as an AG-UI
// `RUN_ERROR` event, or as an error on the observable itself; this decorator is
// the first place both are visible.
//
// The quiz path already classifies its upstream failures
// (lib/llm/upstream-error.ts); the live chat had NOTHING, which is why #26 could
// only be reasoned about from a screenshot.
//
// CONTENT DISCIPLINE (docs/telemetry.md): an in-band `RUN_ERROR` message is
// agent- or provider-authored text that may quote the request, so it is NEVER
// recorded — only its length and the short `code` identifier beside it. A
// THROWN error is different: it is one of ours or the ai-sdk's, and the repo
// already routes those to App Insights complete with their message (see the
// header of lib/llm/upstream-error.ts), so it is passed through as-is.
//
// FRAGILE ACROSS UPGRADES, exactly like ReasoningStrippingRunner beside it: it
// delegates method by method to a 4-method abstract class. That method list is
// guarded by reasoning-runner.unit.test.ts, which reads the abstract methods off
// the installed package's type declaration — a CopilotKit bump that adds a fifth
// event-producing method fails there, and BOTH runners must then wrap it.

/** What we are willing to say about a failed turn. Identifiers and counts only. */
function runErrorAttributes(event: BaseEvent, module: string): Record<string, string | number> {
  const { code, message } = event as BaseEvent & { code?: unknown; message?: unknown };
  return {
    "novedu.area": "chat-run",
    "novedu.module": module,
    "novedu.chat.failure": "run-error-event",
    ...(typeof code === "string" && code ? { "novedu.chat.run_error_code": code } : {}),
    // The length alone separates "empty error" from "the provider said a lot",
    // without carrying a syllable of what was said.
    ...(typeof message === "string"
      ? { "novedu.chat.run_error_message_length": message.length }
      : {}),
  };
}

/**
 * An `AgentRunner` decorator that reports a failed turn to telemetry and changes
 * nothing about the stream: every event, including the `RUN_ERROR` itself,
 * passes through untouched and in order, and an errored observable still errors.
 *
 * Wraps the runner the route would otherwise have used — which is either the
 * library's own (teachers) or `ReasoningStrippingRunner` (students) — so a
 * failure is recorded for BOTH audiences. Wrapping only one of them is the easy
 * mistake: teachers' failures would then be the invisible ones.
 */
export class RunErrorReportingRunner extends AgentRunner {
  /**
   * The runner this one decorates — PUBLIC because the reasoning decision now
   * lives one level in, and the route's own suite has to be able to assert which
   * variant was wrapped. That check is security-relevant (a student must never
   * get the unfiltered stream), so it must not be defeated by this wrapper.
   */
  readonly wrapped: AgentRunner;
  private readonly module: string;

  constructor(inner: AgentRunner, module: string) {
    super();
    this.wrapped = inner;
    this.module = module;
  }

  private report(source: Observable<BaseEvent>): Observable<BaseEvent> {
    return source.pipe(
      tap({
        next: (event) => {
          if (event.type !== EventType.RUN_ERROR) return;
          // A fixed message: the event's own is provider text and stays out of
          // telemetry (see the header). The attributes carry what is safe.
          recordError(
            new Error("Chat run reported RUN_ERROR"),
            runErrorAttributes(event, this.module),
          );
        },
        error: (error: unknown) => {
          recordError(error, {
            "novedu.area": "chat-run",
            "novedu.module": this.module,
            "novedu.chat.failure": "stream-error",
          });
        },
      }),
    );
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    return this.report(this.wrapped.run(request));
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    return this.report(this.wrapped.connect(request));
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return this.wrapped.isRunning(request);
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    return this.wrapped.stop(request);
  }
}
