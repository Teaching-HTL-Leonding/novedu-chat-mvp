import Link from "next/link";
import { DataList, type ListColumn } from "@/components/data-list";
import { ListFilterBar } from "@/components/list-filter-bar";
import { Input } from "@/components/ui/input";
import { listSavers, type Saver } from "@/lib/writing-store";
import { LocalTime } from "../../local-time";
import styles from "./writing-review.module.css";

// The Writing module's teacher review: a list of the students who SAVED text for
// this code (newest save first), each row carrying a "View" link to that student's
// text page (matching the View action in ConversationStats for tutor/quiz).
// Reading the saved text is the point — the chat is secondary, so its per-student
// count is just one column and the conversations themselves live on the student
// page. Saved-text LENGTH is not a column: it would mean loading every essay body
// just to render the list, so it is shown on the student page instead.
//
// Each row shows the student's display name (resolved from `novedu_users` via
// `listSavers`' LEFT JOIN), falling back to the raw Entra `oid` when no name has
// been recorded yet; the oid is always the `title` so a teacher can still read it on
// hover. The search box filters by name OR oid IN THE DATABASE.
//
// SERVER COMPONENT: reads the database via `listSavers`. The writing descriptor in
// lib/code-modules/writing.ts calls this as a plain function so no JSX lives in
// that server-only .ts file. Access is ROLE-gated upstream (the /codes/[code] page
// calls requireTeacherPage()); only a non-anonymous writing code reaches here (an
// anonymous one has no savers and renders the conversation stats instead).

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

export async function WritingSaversList({ code, search }: { code: string; search?: string }) {
  const savers = await listSavers(code, { search });
  const isFiltered = (search ?? "").trim() !== "";

  const columns: ListColumn<Saver>[] = [
    {
      header: "Student",
      className: styles.student,
      render: (row) => <span title={row.userId}>{row.displayName ?? row.userId}</span>,
    },
    {
      header: "Saved",
      kind: "time",
      render: (row) => <LocalTime seconds={seconds(row.textUpdatedAt)} />,
    },
    {
      header: "Conversations",
      kind: "numeric",
      render: (row) => row.conversationCount,
    },
    {
      header: "Actions",
      srOnlyHeader: true,
      kind: "actions",
      render: (row) => (
        <Link
          href={`/codes/${code}/s/${encodeURIComponent(row.userId)}`}
          className={styles.viewLink}
          data-testid="saver-link"
        >
          View
        </Link>
      ),
    },
  ];

  return (
    <DataList
      rows={savers}
      getRowKey={(row) => row.userId}
      columns={columns}
      filterBar={
        <ListFilterBar hasActiveFilter={isFiltered} resetKey={search ?? ""}>
          <Input
            type="search"
            name="q"
            className="w-72"
            placeholder="Filter by student…"
            defaultValue={search ?? ""}
            aria-label="Filter savers"
          />
        </ListFilterBar>
      }
      isFiltered={isFiltered}
      emptyState="Nothing yet — a student appears here once they save their text."
      noMatchState="No students match your filter."
    />
  );
}
