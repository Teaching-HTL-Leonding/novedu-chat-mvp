import Link from "next/link";
import { auth } from "@/auth";
import { DataList, type ListColumn } from "@/components/data-list";
import { EditIcon, ExternalLinkIcon, StatsIcon } from "@/components/icons";
import { ListFilterBar } from "@/components/list-filter-bar";
import listStyles from "@/components/list-page.module.css";
import { DeleteSelectedButton, SelectionProvider } from "@/components/list-selection";
import { AccessDenied, Notice } from "@/components/notice";
import { selectionColumn } from "@/components/selection-column";
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
import pageStyles from "../page.module.css";
import styles from "./codes.module.css";
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
  if (status === "expired") return <span className={styles.badgeExpired}>expired</span>;
  if (status === "upcoming") return <span className={styles.badgeUpcoming}>upcoming</span>;
  return null;
}

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
      <main className={pageStyles.main}>
        <AccessDenied />
      </main>
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
      <main className={pageStyles.main}>
        <Notice heading="Codes temporarily unavailable">
          <p>Codes could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </main>
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
        <span className={styles.moduleBadge}>{codeModuleLabels[row.module].badge}</span>
      ),
    },
    {
      header: "Note",
      className: styles.noteCell,
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
      className: listStyles.timeCell,
      render: (row) => <LocalTime seconds={row.validFromSeconds} fallback="No start" />,
    },
    {
      header: "Valid until",
      className: listStyles.timeCell,
      render: (row) => <LocalTime seconds={row.validUntilSeconds} fallback="No end" />,
    },
    {
      header: "Interactions",
      headerClassName: listStyles.numHeader,
      className: styles.numCell,
      render: (row) => (row.interactionCount === null ? "—" : row.interactionCount),
    },
    {
      header: "Actions",
      srOnlyHeader: true,
      className: listStyles.actionsCell,
      render: (row) => (
        <>
          <Link
            href={`/codes/${row.code}`}
            className={styles.iconButton}
            aria-label="View stats"
            title="View stats"
          >
            <StatsIcon />
          </Link>
          {row.status === "active" ? (
            <Link
              href={`/${row.code}`}
              className={styles.iconButton}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in new tab"
              title="Open in new tab"
            >
              <ExternalLinkIcon />
            </Link>
          ) : null}
          <CopyCodeButton code={row.code} />
          <Link
            href={`/codes/edit/${row.code}`}
            className={styles.iconButton}
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
    <main className={pageStyles.main}>
      <SelectionProvider allIds={rows.map((row) => row.code)}>
        <DataList
          rows={rows}
          getRowKey={(row) => row.code}
          columns={columns}
          hint={
            <>
              All codes. Filter by note/code, activity, or tick “Only my codes”. Expired ones stay
              here so you can review their stats; delete a code to remove it and all of its
              conversation data.
            </>
          }
          actions={
            <>
              <Link href="/codes/new" className={listStyles.button}>
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
              <input
                type="search"
                name="q"
                className={listStyles.searchInput}
                placeholder="Filter by note or code…"
                defaultValue={q}
                aria-label="Filter codes"
              />
              <select
                name="module"
                className={listStyles.searchInput}
                defaultValue={moduleFilter ?? ""}
                aria-label="Filter by activity"
              >
                <option value="">All activities</option>
                {CODE_MODULES.map((m) => (
                  <option key={m} value={m}>
                    {codeModuleLabels[m].badge}
                  </option>
                ))}
              </select>
              <label className={listStyles.onlyMine}>
                <input type="checkbox" name="mine" defaultChecked={onlyMine} />
                Only my codes
              </label>
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
    </main>
  );
}
