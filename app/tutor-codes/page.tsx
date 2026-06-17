import Link from "next/link";
import { auth } from "@/auth";
import { DataList, type ListColumn } from "@/components/data-list";
import { EditIcon, ExternalLinkIcon, StatsIcon } from "@/components/icons";
import { ListFilterBar } from "@/components/list-filter-bar";
import listStyles from "@/components/list-page.module.css";
import { AccessDenied, Notice } from "@/components/notice";
import { isEffectiveTeacher } from "@/lib/student-mode";
import { listAllTutorCodes } from "@/lib/tutor-code-store";
import { getInteractionCounts } from "@/lib/tutor-stats-store";
import { LocalTime } from "../local-time";
import pageStyles from "../page.module.css";
import { CopyCodeButton } from "./copy-code-button";
import { DeleteCodeButton } from "./delete-code-button";
import styles from "./tutor-codes.module.css";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

type WindowStatus = "active" | "upcoming" | "expired";

// Where "now" falls relative to a code's window. Codes are no longer garbage-
// collected, so expired ones stay listed — their chat won't open, but their
// stats are still reachable and they can be deleted.
function windowStatus(entry: { validFrom: Date; validUntil: Date }, now: Date): WindowStatus {
  if (now < entry.validFrom) return "upcoming";
  if (now > entry.validUntil) return "expired";
  return "active";
}

interface TutorCodeRow {
  code: string;
  note: string;
  tutorUrl: string;
  createdBy: string;
  validFromSeconds: number;
  validUntilSeconds: number;
  status: WindowStatus;
  /** Qualifying-conversation count, or null when the count query failed. */
  conversationCount: number | null;
}

function statusBadge(status: WindowStatus) {
  if (status === "expired") return <span className={styles.badgeExpired}>expired</span>;
  if (status === "upcoming") return <span className={styles.badgeUpcoming}>upcoming</span>;
  return null;
}

// Teacher-only: lists ALL tutor codes (any effective teacher may see/manage every
// code — finer-grained RBAC is planned), with a contains-filter over note/code and
// an "Only my codes" toggle — both applied IN THE DATABASE via URL search params
// (see `docs/filtered-lists.md`), never in memory. Each row shows how many
// conversations the code has seen (one aggregate query for the whole filtered
// set), a link to detailed stats, an edit link, and an irreversible delete.
// "Effective" teacher: a teacher in student mode is denied like a student.
export default async function TutorCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; mine?: string | string[] }>;
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

  const codes = await listAllTutorCodes({
    search: q || undefined,
    createdBy: onlyMine ? currentUserId : undefined,
  });

  if (codes === undefined) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Tutor codes temporarily unavailable">
          <p>Tutor codes could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </main>
    );
  }

  // One round trip for all conversation counts (no per-row query). `undefined` =
  // the count query failed; the column then shows "—" rather than a wrong zero.
  const counts = await getInteractionCounts(codes.map((entry) => entry.code));
  const now = new Date();

  const rows: TutorCodeRow[] = codes.map((entry) => ({
    code: entry.code,
    note: entry.note,
    tutorUrl: entry.tutorUrl,
    createdBy: entry.createdBy,
    validFromSeconds: seconds(entry.validFrom),
    validUntilSeconds: seconds(entry.validUntil),
    status: windowStatus(entry, now),
    conversationCount: counts === undefined ? null : (counts.get(entry.code) ?? 0),
  }));

  const columns: ListColumn<TutorCodeRow>[] = [
    {
      header: "Note",
      className: styles.noteCell,
      // The tooltip carries the tutor YAML URL — the one piece of context that
      // does not fit a column.
      render: (row) => (
        <span title={row.tutorUrl}>
          {row.note || row.code}
          {statusBadge(row.status)}
        </span>
      ),
    },
    {
      header: "Valid from",
      className: listStyles.timeCell,
      render: (row) => <LocalTime seconds={row.validFromSeconds} />,
    },
    {
      header: "Valid until",
      className: listStyles.timeCell,
      render: (row) => <LocalTime seconds={row.validUntilSeconds} />,
    },
    {
      header: "Conversations",
      headerClassName: styles.numCell,
      className: styles.numCell,
      render: (row) => (row.conversationCount === null ? "—" : row.conversationCount),
    },
    {
      header: "Actions",
      srOnlyHeader: true,
      className: listStyles.actionsCell,
      render: (row) => (
        <>
          <Link
            href={`/tutor-codes/${row.code}`}
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
              aria-label="Open"
              title="Open chat"
            >
              <ExternalLinkIcon />
            </Link>
          ) : null}
          <CopyCodeButton code={row.code} />
          <Link
            href={`/tutor-codes/edit/${row.code}`}
            className={styles.iconButton}
            aria-label={`Edit ${row.note || row.code}`}
            title="Edit"
          >
            <EditIcon />
          </Link>
          <DeleteCodeButton code={row.code} label={row.note || row.code} />
        </>
      ),
    },
  ];

  return (
    <main className={pageStyles.main}>
      <DataList
        rows={rows}
        getRowKey={(row) => row.code}
        columns={columns}
        hint={
          <>
            All tutor codes. Filter by note or code, or tick “Only my codes”. Expired ones stay here
            so you can review their stats; delete a code to remove it and all of its conversation
            data.
          </>
        }
        actions={
          <Link href="/tutor-codes/new" className={listStyles.button}>
            New Tutor Code
          </Link>
        }
        filterBar={
          <ListFilterBar
            hasActiveFilter={q !== "" || !onlyMine}
            resetKey={`${q}|${onlyMine ? "1" : "0"}`}
          >
            <input
              type="search"
              name="q"
              className={listStyles.searchInput}
              placeholder="Filter by note or code…"
              defaultValue={q}
              aria-label="Filter tutor codes"
            />
            <label className={listStyles.onlyMine}>
              <input type="checkbox" name="mine" defaultChecked={onlyMine} />
              Only my codes
            </label>
          </ListFilterBar>
        }
        isFiltered={q !== ""}
        emptyState={
          <>
            No tutor codes yet. <Link href="/tutor-codes/new">Create one</Link> to share a tutor
            with students — or untick “Only my codes” to see codes from other teachers.
          </>
        }
        noMatchState="No tutor codes match your filter."
      />
    </main>
  );
}
