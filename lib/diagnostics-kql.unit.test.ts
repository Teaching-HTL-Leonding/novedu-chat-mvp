// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildChatFailuresQuery,
  buildChatTurnsQuery,
  buildDiagnosticsQueries,
  buildLlmCallsQuery,
  buildLlmErrorBreakdownQuery,
  buildLlmFailedSampleQuery,
  ERROR_BREAKDOWN_CAP,
  FAILED_SAMPLE_CAP,
  type KqlWindow,
} from "@/lib/diagnostics-kql";

// The query strings are the contract with App Insights; the live e2e
// (`e2e/diagnostics.live.spec.ts`) proves the endpoint accepts them. These pin the
// facts the queries must encode and that only validated values reach them.

const W: KqlWindow = {
  from: new Date("2026-09-25T07:00:00Z"),
  to: new Date("2026-09-25T08:30:00Z"),
  bin: "5m",
};

const all = Object.values(buildDiagnosticsQueries(W));

describe("every query", () => {
  it("is bounded by the window, half-open", () => {
    for (const q of all) {
      expect(q).toContain(
        "timestamp >= datetime(2026-09-25T07:00:00.000Z) and timestamp < datetime(2026-09-25T08:30:00.000Z)",
      );
    }
  });

  it("never classifies by `success` (a 503 is success == true)", () => {
    for (const q of all) expect(q).not.toMatch(/\bsuccess\b/);
  });

  it("counts sampled rows by itemCount", () => {
    for (const q of [buildLlmCallsQuery(W), buildLlmErrorBreakdownQuery(W)]) {
      expect(q).toContain("sum(itemCount)");
    }
    expect(buildChatFailuresQuery(W)).toContain("sum(itemCount)");
    expect(buildChatTurnsQuery(W)).toContain("sum(itemCount)");
  });
});

describe("LLM calls", () => {
  const q = buildLlmCallsQuery(W);

  it("selects outbound HTTP chat-completions calls and groups by host", () => {
    expect(q).toContain('type =~ "HTTP" and name endswith "/chat/completions"');
    expect(q).toContain("parse_url(target).Host");
    expect(q).toContain("iff(isempty(host), tolower(target), host)");
    expect(q).toContain("toint(resultCode)");
  });

  it("bins aligned to the window start and adds whole-range totals", () => {
    expect(q).toContain("bin_at(timestamp, 5m, datetime(2026-09-25T07:00:00.000Z))");
    expect(q).toContain("extend t = datetime(null)");
    expect(q).toContain("percentilesw(duration, itemCount, 50, 95)");
  });

  it("uses the bin enum as the timespan literal", () => {
    expect(buildLlmCallsQuery({ ...W, bin: "6h" })).toContain("bin_at(timestamp, 6h,");
  });
});

describe("capped tables", () => {
  it("caps the breakdown and the sample in the query itself", () => {
    expect(buildLlmErrorBreakdownQuery(W)).toContain(`top ${ERROR_BREAKDOWN_CAP} by errors desc`);
    expect(buildLlmFailedSampleQuery(W)).toContain(`top ${FAILED_SAMPLE_CAP} by timestamp desc`);
    expect(ERROR_BREAKDOWN_CAP).toBe(20);
    expect(FAILED_SAMPLE_CAP).toBe(50);
  });
});

describe("student impact", () => {
  it("reads chat-run failures from the recordError dependency rows", () => {
    const q = buildChatFailuresQuery(W);
    expect(q).toContain('target == "exception"');
    expect(q).toContain('customDimensions["novedu.area"]) == "chat-run"');
    expect(q).toContain('customDimensions["novedu.chat.run_error_code"]');
  });

  it("reads only top-level agent run requests", () => {
    const q = buildChatTurnsQuery(W);
    expect(q).toContain("operation_ParentId == operation_Id");
    expect(q).toContain('name startswith "POST /api/copilotkit/agent/" and name endswith "/run"');
  });
});

it("builds the five queries from their builders", () => {
  expect(buildDiagnosticsQueries(W)).toEqual({
    llmCalls: buildLlmCallsQuery(W),
    llmErrorBreakdown: buildLlmErrorBreakdownQuery(W),
    llmFailedSample: buildLlmFailedSampleQuery(W),
    chatFailures: buildChatFailuresQuery(W),
    chatTurns: buildChatTurnsQuery(W),
  });
});
