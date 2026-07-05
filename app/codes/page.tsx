import Link from "next/link";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { DataList, type ListColumn } from "@/components/data-list";
import {
  CodeIcon,
  EditIcon,
  ExternalLinkIcon,
  FlagIcon,
  HelpCircleIcon,
  StatsIcon,
} from "@/components/icons";
import { FilterCheckbox, ListFilterBar } from "@/components/list-filter-bar";
import { DeleteSelectedButton, SelectionProvider } from "@/components/list-selection";
import { AccessDenied, Notice } from "@/components/notice";
import { Main } from "@/components/page-main";
import { selectionColumn } from "@/components/selection-column";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { iconButtonVariants } from "@/components/ui/icon-button";
import { Input, Select } from "@/components/ui/input";
import { deleteSelectedCodesAction } from "@/lib/code-actions";
import {
  CODE_MODULES,
  type CodeModule,
  codeModuleLabels,
  parseModuleParam,
} from "@/lib/code-modules/types";
import { getInteractionCounts } from "@/lib/code-stats-store";
import { DISTANT_FUTURE, DISTANT_PAST, listCodes } from "@/lib/code-store";
import { isEffectiveTeacher } from "@/lib/student-mode";
import { LocalTime } from "../local-time";
import { CopyCodeButton } from "./copy-code-button";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

type WindowStatus = "active" | "upcoming" | "expired";

// Where "now" falls relative to a code's window. Codes are never garbage-
// collected, so expired ones stay listed — their activity won't open, but their
// stats are still reachable and they can be deleted. A missing bound is coalesced
// to its sentinel, so an open-ended code is never "upcoming"/"expired" on that
// side.
function windowStatus(
  entry: { validFrom: Date | null; validUntil: Date | null },
  now: Date,
): WindowStatus {
  const from = entry.validFrom ?? DISTANT_PAST;
  const until = entry.validUntil ?? DISTANT_FUTURE;
  if (now < from) return "upcoming";
  if (now > until) return "expired";
  return "active";
}

interface CodeRow {
  code: string;
  module: CodeModule;
  note: string;
  fileUrl: string;
  createdBy: string;
  validFromSeconds: number | null;
  validUntilSeconds: number | null;
  status: WindowStatus;
  /** Qualifying-interaction count, or null when the count query failed. */
  interactionCount: number | null;
}

function statusBadge(status: WindowStatus) {
  if (status === "expired")
    return (
      <Badge tone="red" caps className="ml-2 align-middle">
        expired
      </Badge>
    );
  if (status === "upcoming")
    return (
      <Badge tone="blue" caps className="ml-2 align-middle">
        upcoming
      </Badge>
    );
  return (
    <Badge tone="green" caps className="ml-2 align-middle">
      <span className="size-1.5 rounded-full bg-current" />
      active
    </Badge>
  );
}

// The module's tiny pill icon — decorative (the pill text carries the label).
const MODULE_ICONS: Record<CodeModule, ReactNode> = {
  tutor: <FlagIcon className="size-3" />,
  quiz: <HelpCircleIcon className="size-3" />,
  writing: <EditIcon className="size-3" />,
  coding: <CodeIcon className="size-3" />,
};

// Left row stripe in the module's color — same hues as the solid module pills
// (the Badge `solid` compound variants).
const MODULE_ROW_ACCENT: Record<CodeModule, string> = {
  tutor: "border-l-4 border-l-teal-700",
  quiz: "border-l-4 border-l-amber-700",
  writing: "border-l-4 border-l-green-700",
  coding: "border-l-4 border-l-blue-800",
};

// Teacher-only: lists ALL codes across modules (any effective teacher may
// see/manage every code — finer-grained RBAC is planned), with a contains-filter
// over note/code, an "Only my codes" toggle, and a module filter — all applied IN
// THE DATABASE via URL search params (see `docs/filtered-lists.md`), never in
// memory. Each row shows its module, how many interactions the code has seen (one
// aggregate query for the whole filtered set), a link to detailed stats, an edit
// link, and an irreversible delete. "Effective" teacher: a teacher in student
// mode is denied like a student.
export default async function CodesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    mine?: string | string[];
    module?: string | string[];
  }>;
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
  const q = (typeof sp.q === "string" ? sp.q : "").trim();
  const onlyMine = sp.mine !== "0"; // default ON; "0" turns it off
  const moduleFilter = parseModuleParam(sp.module);

  const entries = await listCodes({
    search: q || undefined,
    createdBy: onlyMine ? currentUserId : undefined,
    module: moduleFilter,
  });

  if (entries === undefined) {
    return (
      <Main>
        <Notice heading="Codes temporarily unavailable">
          <p>Codes could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </Main>
    );
  }

  // One round trip for all interaction counts (no per-row query). `undefined` =
  // the count query failed; the column then shows "—" rather than a wrong zero.
  const counts = await getInteractionCounts(entries.map((entry) => entry.code));
  const now = new Date();

  const rows: CodeRow[] = entries.map((entry) => ({
    code: entry.code,
    module: entry.module,
    note: entry.note,
    fileUrl: entry.fileUrl,
    createdBy: entry.createdBy,
    validFromSeconds: entry.validFrom ? seconds(entry.validFrom) : null,
    validUntilSeconds: entry.validUntil ? seconds(entry.validUntil) : null,
    status: windowStatus(entry, now),
    interactionCount: counts === undefined ? null : (counts.get(entry.code) ?? 0),
  }));

  const columns: ListColumn<CodeRow>[] = [
    // Leading multi-select column; the selection key is the CODE, which is what
    // `deleteSelectedCodesAction` deletes by.
    selectionColumn<CodeRow>(
      (row) => row.code,
      (row) => row.note || row.code,
    ),
    {
      header: "Module",
      render: (row) => (
        <Badge tone={codeModuleLabels[row.module].tone} solid caps>
          {MODULE_ICONS[row.module]}
          {codeModuleLabels[row.module].badge}
        </Badge>
      ),
    },
    {
      header: "Note",
      className: "max-w-96 overflow-hidden text-ellipsis whitespace-nowrap",
      // The tooltip carries the activity YAML URL — the one piece of context that
      // does not fit a column.
      render: (row) => (
        <span title={row.fileUrl}>
          {row.note || row.code}
          {statusBadge(row.status)}
        </span>
      ),
    },
    {
      header: "Valid from",
      kind: "time",
      render: (row) => <LocalTime seconds={row.validFromSeconds} fallback="No start" />,
    },
    {
      header: "Valid until",
      kind: "time",
      render: (row) => <LocalTime seconds={row.validUntilSeconds} fallback="No end" />,
    },
    {
      header: "Interactions",
      kind: "numeric",
      render: (row) => (row.interactionCount === null ? "—" : row.interactionCount),
    },
    {
      header: "Actions",
      srOnlyHeader: true,
      kind: "actions",
      render: (row) => (
        <>
          <Link
            href={`/codes/${row.code}`}
            className={iconButtonVariants()}
            aria-label="View stats"
            title="View stats"
          >
            <StatsIcon />
          </Link>
          {row.status === "active" ? (
            <Link
              href={`/${row.code}`}
              className={iconButtonVariants()}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in new tab"
              title="Open in new tab"
            >
              <ExternalLinkIcon />
            </Link>
          ) : null}
          <CopyCodeButton code={row.code} module={row.module} />
          <Link
            href={`/codes/edit/${row.code}`}
            className={iconButtonVariants()}
            aria-label={`Edit ${row.note || row.code}`}
            title="Edit"
          >
            <EditIcon />
          </Link>
        </>
      ),
    },
  ];

  return (
    <Main>
      <SelectionProvider allIds={rows.map((row) => row.code)}>
        <DataList
          rows={rows}
          getRowKey={(row) => row.code}
          columns={columns}
          rowClassName={(row) => MODULE_ROW_ACCENT[row.module]}
          hint={
            <>
              All codes. Filter by note/code, activity, or tick “Only my codes”. Expired ones stay
              here so you can review their stats; delete a code to remove it and all of its
              conversation data.
            </>
          }
          actions={
            <>
              <Link href="/codes/new" className={buttonVariants()}>
                New code
              </Link>
              <DeleteSelectedButton action={deleteSelectedCodesAction} itemNoun="code" />
            </>
          }
          filterBar={
            <ListFilterBar
              hasActiveFilter={q !== "" || !onlyMine || moduleFilter !== undefined}
              resetKey={`${q}|${onlyMine ? "1" : "0"}|${moduleFilter ?? ""}`}
            >
              <Input
                type="search"
                name="q"
                className="w-72"
                placeholder="Filter by note or code…"
                defaultValue={q}
                aria-label="Filter codes"
              />
              <Select
                name="module"
                className="w-72"
                defaultValue={moduleFilter ?? ""}
                aria-label="Filter by activity"
              >
                <option value="">All activities</option>
                {CODE_MODULES.map((m) => (
                  <option key={m} value={m}>
                    {codeModuleLabels[m].badge}
                  </option>
                ))}
              </Select>
              <FilterCheckbox name="mine" label="Only my codes" defaultChecked={onlyMine} />
            </ListFilterBar>
          }
          isFiltered={q !== "" || moduleFilter !== undefined}
          emptyState={
            <>
              No codes yet. <Link href="/codes/new">Create one</Link> to share an activity with
              students — or untick “Only my codes” to see codes from other teachers.
            </>
          }
          noMatchState="No codes match your filter."
        />
      </SelectionProvider>
    </Main>
  );
}
