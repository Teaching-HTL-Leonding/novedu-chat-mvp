import type { ReportListRow, ReportStatusFilter } from "@/lib/report-store";
import { isReportReaction, type ReportReaction } from "@/lib/report-types";

// REPORTS-specific plumbing for the three CLI/API bearer report routes (docs/api.md,
// docs/reports.md): the id guard, the filter parsers, and the wire shape. The generic
// channel helpers (`json`, `authErrorResponse`, `NO_STORE`) moved to the neutral
// `app/api/shared.ts` when `/api/eval/grade` needed them too — they are channel
// plumbing, not reports logic. Re-exported here so the report routes keep one import.
// Timestamps are ISO 8601 UTC or `null`.

export { authErrorResponse, json, NO_STORE } from "../shared";

// A canonical UUID — the shape `randomUUID` mints for a report id. Mirrors the
// guard the web bulk actions use (lib/report-actions.ts `UUID_PATTERN`) so a
// malformed id is rejected before any DB round-trip.
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The /reports inbox's three resolution states; `open` is the default working
// view. Unlike the forgiving web UI (which silently ignores an unknown value),
// this channel REJECTS an unknown one so scripts fail loudly (docs/api.md).
const STATUS_VALUES: readonly ReportStatusFilter[] = ["open", "resolved", "all"];

export function parseStatus(
  value: string | null,
): { ok: true; value: ReportStatusFilter } | { ok: false; message: string } {
  if (value === null || value === "") return { ok: true, value: "open" };
  if ((STATUS_VALUES as readonly string[]).includes(value)) {
    return { ok: true, value: value as ReportStatusFilter };
  }
  return { ok: false, message: `Unknown status "${value}". Use open, resolved, or all.` };
}

export function parseReaction(
  value: string | null,
): { ok: true; value: ReportReaction | undefined } | { ok: false; message: string } {
  if (value === null || value === "") return { ok: true, value: undefined };
  if (isReportReaction(value)) return { ok: true, value };
  return { ok: false, message: `Unknown reaction "${value}". Use good, omg, bad, or holysh.` };
}

// The wire shape of one report — the full `ReportListRow` parity shape with
// Date fields as ISO 8601 UTC strings (or `null` for an open resolution). Field
// names match the /reports inbox (docs/api.md). The reporter's `userId` (oid) +
// `displayName` are surfaced deliberately: a report is non-anonymous toward
// teachers (the sanctioned waiver, docs/reports.md) on this teacher-only channel.
export function toWire(row: ReportListRow) {
  return {
    id: row.id,
    kind: row.kind,
    code: row.code,
    codeNote: row.codeNote,
    userId: row.userId,
    displayName: row.displayName,
    reaction: row.reaction,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    threadId: row.threadId,
    questionId: row.questionId,
    questionText: row.questionText,
    answerText: row.answerText,
    feedbackText: row.feedbackText,
    verdict: row.verdict,
    hadImages: row.hadImages,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy,
  };
}
