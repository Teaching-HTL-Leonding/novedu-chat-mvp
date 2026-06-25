import Link from "next/link";
import { DataList, type ListColumn } from "@/components/data-list";
import { ListFilterBar } from "@/components/list-filter-bar";
import listStyles from "@/components/list-page.module.css";
import { listSavers, type Saver } from "@/lib/writing-store";
import { LocalTime } from "../../local-time";
import styles from "./writing-review.module.css";

// The Writing module's teacher review: a list of the students who SAVED text for
// this code (newest save first), each row linking to that student's text page.
// Reading the saved text is the point — the chat is secondary, so its per-student
// count is just one column and the conversations themselves live on the student
// page. Saved-text LENGTH is not a column: it would mean loading every essay body
// just to render the list, so it is shown on the student page instead.
//
// The student id shown is the Entra `oid` (interim — human-readable names are
// tracked as issue #49); the search box filters by it IN THE DATABASE.
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
      render: (row) => (
        <Link
          href={`/codes/${code}/s/${encodeURIComponent(row.userId)}`}
          title={row.userId}
          data-testid="saver-link"
        >
          {row.userId}
        </Link>
      ),
    },
    {
      header: "Saved",
      className: listStyles.timeCell,
      render: (row) => <LocalTime seconds={seconds(row.textUpdatedAt)} />,
    },
    {
      header: "Conversations",
      headerClassName: styles.numCell,
      className: styles.numCell,
      render: (row) => row.conversationCount,
    },
  ];

  return (
    <DataList
      rows={savers}
      getRowKey={(row) => row.userId}
      columns={columns}
      filterBar={
        <ListFilterBar hasActiveFilter={isFiltered} resetKey={search ?? ""}>
          <input
            type="search"
            name="q"
            className={listStyles.searchInput}
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
