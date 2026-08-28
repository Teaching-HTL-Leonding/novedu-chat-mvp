// @vitest-environment node

import type { BaseEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import type {
  AgentRunner,
  AgentRunnerConnectRequest,
  AgentRunnerRunRequest,
} from "@copilotkit/runtime/v2";
import { firstValueFrom, type Observable, of, throwError, toArray } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunErrorReportingRunner } from "./run-error-runner";

// The seam that makes a failed chat turn visible at all: the model call lives
// inside the agent, behind a stream the route already answered 200 for, so a
// handler-level catch sees nothing. Like its sibling ReasoningStrippingRunner
// this is a pure transform of an event stream, driven here with synthetic
// Observables — no network, no Mastra, no LLM.

const { recordError } = vi.hoisted(() => ({ recordError: vi.fn() }));
vi.mock("@/lib/telemetry", () => ({ recordError }));

const RUN_REQUEST = { threadId: "t1" } as unknown as AgentRunnerRunRequest;
const CONNECT_REQUEST = { threadId: "t1" } as unknown as AgentRunnerConnectRequest;

function fakeInner(stream: Observable<BaseEvent>) {
  return {
    run: vi.fn(() => stream),
    connect: vi.fn(() => stream),
    isRunning: vi.fn(async () => true),
    stop: vi.fn(async () => true),
  };
}

function collect(stream: Observable<BaseEvent>): Promise<BaseEvent[]> {
  return firstValueFrom(stream.pipe(toArray()));
}

/** A turn that dies the way an upstream 400 does: in-band, as a RUN_ERROR frame. */
function failedTurn(message: string, code?: string): BaseEvent[] {
  return [
    { type: EventType.RUN_STARTED },
    { type: EventType.RUN_ERROR, message, ...(code ? { code } : {}) },
  ] as unknown as BaseEvent[];
}

beforeEach(() => {
  recordError.mockClear();
});

describe("RunErrorReportingRunner", () => {
  it("reports an in-band RUN_ERROR with the module that produced it", async () => {
    const runner = new RunErrorReportingRunner(
      fakeInner(of(...failedTurn("boom", "bad_request"))) as unknown as AgentRunner,
      "tutor",
    );
    await collect(runner.run(RUN_REQUEST));

    expect(recordError).toHaveBeenCalledOnce();
    expect(recordError.mock.lastCall?.[1]).toMatchObject({
      "novedu.area": "chat-run",
      "novedu.module": "tutor",
      "novedu.chat.failure": "run-error-event",
      "novedu.chat.run_error_code": "bad_request",
    });
  });

  // docs/telemetry.md: a RUN_ERROR message is agent- or provider-authored text
  // that may quote the request, so only its LENGTH may travel.
  it("never sends the run-error message itself to telemetry", async () => {
    const secret = "the student wrote: my address is Hauptstrasse 4";
    const runner = new RunErrorReportingRunner(
      fakeInner(of(...failedTurn(secret))) as unknown as AgentRunner,
      "tutor",
    );
    await collect(runner.run(RUN_REQUEST));

    const [error, attributes] = recordError.mock.lastCall ?? [];
    expect((error as Error).message).not.toContain("Hauptstrasse");
    expect(JSON.stringify(attributes)).not.toContain("Hauptstrasse");
    expect(attributes).toMatchObject({ "novedu.chat.run_error_message_length": secret.length });
  });

  it("reports a stream that errors outright, and lets the error through", async () => {
    const failure = new Error("socket hang up");
    const runner = new RunErrorReportingRunner(
      fakeInner(throwError(() => failure)) as unknown as AgentRunner,
      "quiz",
    );
    await expect(collect(runner.run(RUN_REQUEST))).rejects.toThrow("socket hang up");

    expect(recordError).toHaveBeenCalledOnce();
    expect(recordError.mock.lastCall?.[0]).toBe(failure);
    expect(recordError.mock.lastCall?.[1]).toMatchObject({
      "novedu.chat.failure": "stream-error",
      "novedu.module": "quiz",
    });
  });

  // Reporting must be OBSERVATION only: this runner sits between the student and
  // the stream, and a dropped or reordered frame would be a chat bug.
  it("passes every event through untouched and in order, RUN_ERROR included", async () => {
    const events = failedTurn("boom");
    const runner = new RunErrorReportingRunner(
      fakeInner(of(...events)) as unknown as AgentRunner,
      "tutor",
    );
    const out = await collect(runner.run(RUN_REQUEST));
    expect(out).toEqual(events);
    expect(out[0]).toBe(events[0]);
  });

  it("watches the reconnect stream too, not just the live turn", async () => {
    const runner = new RunErrorReportingRunner(
      fakeInner(of(...failedTurn("boom"))) as unknown as AgentRunner,
      "writing",
    );
    await collect(runner.connect(CONNECT_REQUEST));
    expect(recordError).toHaveBeenCalledOnce();
  });

  it("stays silent for a turn that succeeds", async () => {
    const ok = [
      { type: EventType.RUN_STARTED },
      { type: EventType.TEXT_MESSAGE_START, messageId: "m1" },
      { type: EventType.RUN_FINISHED },
    ] as unknown as BaseEvent[];
    const runner = new RunErrorReportingRunner(
      fakeInner(of(...ok)) as unknown as AgentRunner,
      "tutor",
    );
    await collect(runner.run(RUN_REQUEST));
    expect(recordError).not.toHaveBeenCalled();
  });

  it("delegates isRunning and stop unchanged", async () => {
    const inner = fakeInner(of());
    const runner = new RunErrorReportingRunner(inner as unknown as AgentRunner, "tutor");
    await expect(runner.isRunning({ threadId: "t1" } as never)).resolves.toBe(true);
    await expect(runner.stop({ threadId: "t1" } as never)).resolves.toBe(true);
    expect(inner.isRunning).toHaveBeenCalledOnce();
    expect(inner.stop).toHaveBeenCalledOnce();
  });
});
