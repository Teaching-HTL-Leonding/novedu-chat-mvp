import Link from "next/link";
import { auth } from "@/auth";
import { DataList, type ListColumn } from "@/components/data-list";
import { ExternalLinkIcon } from "@/components/icons";
import { FilterCheckbox, ListFilterBar } from "@/components/list-filter-bar";
import {
  BulkActionButton,
  DeleteSelectedButton,
  SelectionProvider,
} from "@/components/list-selection";
import { AccessDenied, Notice } from "@/components/notice";
import { Main } from "@/components/page-main";
import { selectionColumn } from "@/components/selection-column";
import { Badge } from "@/components/ui/badge";
import { iconButtonVariants } from "@/components/ui/icon-button";
import { Input, Select } from "@/components/ui/input";
import { type PagingParams, parsePaging } from "@/lib/db/paging";
import { parseSort, type SortParams } from "@/lib/db/sorting";
import {
  deleteSelectedReportsAction,
  markSelectedReportsResolvedAction,
  reopenSelectedReportsAction,
} from "@/lib/report-actions";
import { listReports, REPORT_SORT_COLUMNS, type ReportStatusFilter } from "@/lib/report-store";
import {
  isReportReaction,
  REPORT_REACTION_LABELS,
  REPORT_REACTIONS,
  type ReportReaction,
} from "@/lib/report-types";
import { isEffectiveTeacher } from "@/lib/student-mode";
import { LocalTime } from "../local-time";
import { ReactionBadge, type ReportDetail, ReportDetailButton } from "./report-detail-button";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// The three inbox resolution states; `open` is the default working view.
const STATUS_VALUES: readonly ReportStatusFilter[] = ["open", "resolved", "all"];
function parseStatus(value: string | string[] | undefined): ReportStatusFilter {
  return typeof value === "string" && (STATUS_VALUES as readonly string[]).includes(value)
    ? (value as ReportStatusFilter)
    : "open";
}

const KIND_LABEL: Record<ReportDetail["kind"], string> = {
  chat: "chat",
  "quiz-answer": "quiz answer",
};

// One flattened, serializable row for the DataList (Dates → unix seconds; the
// detail dialog gets the whole snapshot as plain props).
interface ReportRow extends ReportDetail {
  id: string;
}

// Teacher-only global reports inbox (GH issue #24): every student-submitted report
// across all codes, filtered IN THE DATABASE via URL search params (see
// `docs/filtered-lists.md`) by resolution status, reaction, a free-text search, and
// an "Only my codes" toggle. Bulk "Mark resolved" / "Reopen" / "Delete Selected"
// through the shared selection layer. "Effective" teacher: a teacher in student
// mode is denied like a student.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<
    {
      status?: string | string[];
      reaction?: string | string[];
      q?: string | string[];
      mine?: string | string[];
    } & PagingParams &
      SortParams
  >;
}) {
  if (!(await isEffectiveTeacher())) {
    return (
      <Main>
        <AccessDenied />
      </Main>
    );
  }

  const session = await auth();
  const currentUserId = session?.user?.id ?? "";

  const sp = await searchParams;
  const status = parseStatus(sp.status);
  const reaction: ReportReaction | undefined = isReportReaction(sp.reaction)
    ? sp.reaction
    : undefined;
  const q = (typeof sp.q === "string" ? sp.q : "").trim();
  const onlyMine = sp.mine !== "0"; // default ON; "0" turns it off

  const paging = parsePaging(sp);
  const sort = parseSort(sp, REPORT_SORT_COLUMNS);

  const result = await listReports({
    status,
    reaction,
    search: q || undefined,
    codeCreatedBy: onlyMine ? currentUserId : undefined,
    paging,
    sort,
  });

  if (result === undefined) {
    return (
      <Main>
        <Notice heading="Reports temporarily unavailable">
          <p>Reports could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </Main>
    );
  }

  const rows: ReportRow[] = result.rows.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    reaction: entry.reaction,
    resolved: entry.resolvedAt !== null,
    createdSeconds: seconds(entry.createdAt),
    reporter: entry.displayName ?? entry.userId,
    reporterId: entry.userId,
    description: entry.description,
    code: entry.code,
    codeNote: entry.codeNote,
    threadId: entry.threadId,
    questionText: entry.questionText,
    answerText: entry.answerText,
    feedbackText: entry.feedbackText,
    verdict: entry.verdict,
    hadImages: entry.hadImages,
  }));

  const columns: ListColumn<ReportRow, keyof typeof REPORT_SORT_COLUMNS>[] = [
    // Leading multi-select column; the selection key is the report ID, which is
    // what the bulk resolve/reopen/delete actions operate on.
    selectionColumn<ReportRow>(
      (row) => row.id,
      (row) => `${KIND_LABEL[row.kind]} report`,
    ),
    {
      header: "Reaction",
      sortKey: "reaction",
      render: (row) => <ReactionBadge reaction={row.reaction} />,
    },
    {
      header: "Kind",
      sortKey: "kind",
      render: (row) => <Badge tone="neutral">{KIND_LABEL[row.kind]}</Badge>,
    },
    {
      header: "Code",
      sortKey: "code",
      className: "max-w-72 overflow-hidden text-ellipsis whitespace-nowrap",
      render: (row) => (
        <Link href={`/codes/${row.code}`} className="underline" title={row.code}>
          {row.codeNote || row.code}
        </Link>
      ),
    },
    {
      header: "Student",
      sortKey: "student",
      render: (row) => (
        <span className="block max-w-56 truncate" title={row.reporterId}>
          {row.reporter}
        </span>
      ),
    },
    {
      header: "Created",
      sortKey: "created",
      kind: "time",
      render: (row) => <LocalTime seconds={row.createdSeconds} />,
    },
    {
      header: "Status",
      sortKey: "status",
      render: (row) => (
        <Badge tone={row.resolved ? "green" : "orange"} caps>
          {row.resolved ? "resolved" : "open"}
        </Badge>
      ),
    },
    {
      header: "Actions",
      srOnlyHeader: true,
      kind: "actions",
      render: (row) => (
        <>
          {row.kind === "chat" && row.threadId ? (
            <Link
              href={`/codes/${row.code}/c/${row.threadId}?from=reports`}
              className={iconButtonVariants()}
              aria-label="Open transcript"
              title="Open transcript"
            >
              <ExternalLinkIcon />
            </Link>
          ) : null}
          <ReportDetailButton report={row} />
        </>
      ),
    },
  ];

  const hasActiveFilter = status !== "open" || reaction !== undefined || q !== "" || !onlyMine;

  return (
    <Main>
      <SelectionProvider allIds={rows.map((row) => row.id)}>
        <DataList
          rows={rows}
          getRowKey={(row) => row.id}
          columns={columns}
          // Open urgent ("holy sh..") reports get a red left stripe so they stand
          // out in the working set — the same accent idiom as the codes list.
          rowClassName={(row) =>
            row.reaction === "holysh" && !row.resolved ? "border-l-4 border-l-red-700" : undefined
          }
          hint={
            <>
              Student reports across all codes. Filter by status, reaction, or text, or tick “Only
              my codes”. Select rows to mark resolved, reopen, or delete.
            </>
          }
          actions={
            <>
              <BulkActionButton
                action={markSelectedReportsResolvedAction}
                label="Mark resolved"
                pendingLabel="Resolving"
              />
              <BulkActionButton
                action={reopenSelectedReportsAction}
                label="Reopen"
                pendingLabel="Reopening"
              />
              <DeleteSelectedButton action={deleteSelectedReportsAction} itemNoun="report" />
            </>
          }
          filterBar={
            <ListFilterBar
              hasActiveFilter={hasActiveFilter}
              resetKey={`${status}|${reaction ?? ""}|${q}|${onlyMine ? "1" : "0"}`}
              pageSize={result.pageSize}
              sort={sort}
            >
              <Select
                name="status"
                className="w-44"
                defaultValue={status}
                aria-label="Filter by status"
              >
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="all">All</option>
              </Select>
              <Select
                name="reaction"
                className="w-44"
                defaultValue={reaction ?? ""}
                aria-label="Filter by reaction"
              >
                <option value="">Any reaction</option>
                {REPORT_REACTIONS.map((r) => (
                  <option key={r} value={r}>
                    {REPORT_REACTION_LABELS[r]}
                  </option>
                ))}
              </Select>
              <Input
                type="search"
                name="q"
                className="w-72"
                placeholder="Filter by description, student, code…"
                defaultValue={q}
                aria-label="Filter reports"
              />
              <FilterCheckbox name="mine" label="Only my codes" defaultChecked={onlyMine} />
            </ListFilterBar>
          }
          isFiltered={reaction !== undefined || q !== "" || status !== "open"}
          emptyState={
            <>
              No reports yet. Students can flag a conversation or a graded quiz answer — or untick
              “Only my codes” to see reports on codes from other teachers.
            </>
          }
          noMatchState="No reports match your filter."
          pathname="/reports"
          params={sp}
          pagination={result}
          sorting={sort}
        />
      </SelectionProvider>
    </Main>
  );
}
