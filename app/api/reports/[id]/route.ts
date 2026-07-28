import type { Message } from "@ag-ui/core";
import { ApiAuthError, requireBearerTeacher } from "@/lib/api-auth";
import { getConversationMessages } from "@/lib/code-stats-store";
import { getReportById } from "@/lib/report-store";
import { recordError } from "@/lib/telemetry";
import { authErrorResponse, json, toWire, UUID_PATTERN } from "../shared";

// CLI/API bearer route for ONE report's detail (docs/api.md, docs/reports.md).
// Self-gates with requireBearerTeacher (excluded from the proxy.ts session gate).
// For a CHAT report it additionally embeds the conversation transcript via the
// reused `getConversationMessages` (which re-checks the thread belongs to the
// code) — the same collapsed sequence the web transcript renders. A quiz-answer
// report carries its full snapshot on the row, so it has NO `messages` key.
export const dynamic = "force-dynamic";

const NOT_FOUND = { message: "No report with that id." };
const REPORT_UNAVAILABLE = {
  message: "Reports could not be loaded right now. Try again in a moment.",
};
const TRANSCRIPT_UNAVAILABLE = {
  message: "The transcript could not be loaded right now. Try again in a moment.",
};

// The rendered text of one AG-UI message: a plain string as-is, or the joined
// text parts of a mixed (text + image) content array. Image-only messages yield
// "" and are omitted from the transcript projection.
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: "text"; text?: string } => {
        return (part as { type?: string }).type === "text";
      })
      .map((part) => part.text ?? "")
      .join("");
  }
  return "";
}

// Projects the collapsed transcript to the wire shape: text-only
// `{ id, role, content }` messages, omitting any without text content.
function projectTranscript(messages: Message[]): { id: string; role: string; content: string }[] {
  const out: { id: string; role: string; content: string }[] = [];
  for (const message of messages) {
    const content = messageText(message.content);
    if (content === "") continue;
    out.push({ id: message.id, role: message.role, content });
  }
  return out;
}

/**
 * One report by id. A malformed (non-UUID) or unknown id → 404; a store error →
 * 503. For `kind: "chat"` the body additionally embeds `messages` (the collapsed
 * transcript from `getConversationMessages`); a deleted code/thread yields `[]`,
 * a transcript DB error → 503. A quiz-answer report has NO `messages` key.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireBearerTeacher(request);

    const { id } = await params;
    // Reject a malformed id as "not found" — no DB round-trip, no distinction
    // between "malformed" and "no such report" leaked to the caller.
    if (!UUID_PATTERN.test(id)) return json(NOT_FOUND, 404);

    const report = await getReportById(id);
    if (report === undefined) return json(REPORT_UNAVAILABLE, 503);
    if (report === null) return json(NOT_FOUND, 404);

    const wire = toWire(report);
    if (report.kind !== "chat") {
      // A quiz-answer report's snapshot already rides on the row — no messages.
      return json(wire, 200);
    }

    // A chat report always carries a `messages` key. A deleted code/thread (or a
    // missing threadId) yields `[]`; a transcript DB error is a transient 503.
    let messages: { id: string; role: string; content: string }[] = [];
    if (report.threadId !== null) {
      const transcript = await getConversationMessages(report.code, report.threadId);
      if (transcript === undefined) return json(TRANSCRIPT_UNAVAILABLE, 503);
      messages = projectTranscript(transcript);
    }
    return json({ ...wire, messages }, 200);
  } catch (error) {
    if (error instanceof ApiAuthError) return authErrorResponse(error);
    recordError(error, { "novedu.area": "api-reports" });
    return json({ message: "Internal server error" }, 500);
  }
}
