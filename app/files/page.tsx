import Link from "next/link";
import { auth } from "@/auth";
import { CopyIconButton } from "@/components/copy-icon-button";
import { DataList, type ListColumn } from "@/components/data-list";
import { EditIcon, ExternalLinkIcon, LayoutIcon, ShareIcon } from "@/components/icons";
import { FilterCheckbox, ListFilterBar } from "@/components/list-filter-bar";
import { DeleteSelectedButton, SelectionProvider } from "@/components/list-selection";
import { Notice } from "@/components/notice";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { selectionColumn } from "@/components/selection-column";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveAppOriginOr } from "@/lib/app-origin";
import { isCodeModule } from "@/lib/code-modules/types";
import { listFiles } from "@/lib/file-store";
import { filePublicUrl } from "@/lib/file-url";
import { deleteSelectedFilesAction } from "@/lib/files-actions";
import { LocalTime } from "../local-time";
import pageStyles from "../page.module.css";
import styles from "./files.module.css";

// One active file as shown in the list (no content). `updatedSeconds` is the
// active version's write time as unix seconds; `createdBy` is the last writer's
// oid (drives the "Only my files" filter, applied in the DB).
interface FileRow {
  id: string;
  name: string;
  kind: string;
  title: string | null;
  description: string | null;
  updatedSeconds: number;
  createdBy: string;
}

// Teacher-only: every app-hosted YAML file (active versions only), with a
// contains-filter over name/title/description and an "Only my files" toggle —
// both applied IN THE DATABASE via URL search params (see
// `docs/filtered-lists.md`), never in memory. No row-level security: every
// teacher sees and maintains every file. "Effective" teacher: a teacher in
// student mode is denied like a student.
export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; mine?: string | string[] }>;
}) {
  const denied = await requireTeacherPage();
  if (denied) return denied;

  const session = await auth();
  const currentUserId = session?.user?.id ?? "";

  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim();
  const onlyMine = sp.mine !== "0"; // default ON; "0" turns it off

  const entries = await listFiles({
    search: q || undefined,
    createdBy: onlyMine ? currentUserId : undefined,
  });

  if (entries === undefined) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Files temporarily unavailable">
          <p>Your files could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </main>
    );
  }

  // The public URL origin is resolved once on the server and threaded down, so
  // every Copy URL / open / share link is built identically (no client origin).
  const origin = await resolveAppOriginOr("");
  const fileUrl = (name: string) => filePublicUrl(origin, name);

  const rows: FileRow[] = entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    title: entry.title,
    description: entry.description,
    updatedSeconds: Math.floor(entry.validFrom.getTime() / 1000),
    createdBy: entry.createdBy,
  }));

  const columns: ListColumn<FileRow>[] = [
    // Leading multi-select column; the selection key is the file NAME, which is
    // what `deleteSelectedFilesAction` deletes by (and is unique among active files).
    selectionColumn<FileRow>(
      (row) => row.name,
      (row) => row.name,
    ),
    { header: "Name", className: styles.nameCell, render: (row) => row.name },
    {
      header: "Kind",
      render: (row) => (
        <span
          className={`${styles.kindBadge} ${
            row.kind === "tutor"
              ? styles.kindTutor
              : row.kind === "quiz"
                ? styles.kindQuiz
                : row.kind === "coding"
                  ? styles.kindCoding
                  : styles.kindFragment
          }`}
        >
          {row.kind}
        </span>
      ),
    },
    {
      header: "Title",
      className: styles.titleCell,
      render: (row) => <span title={row.description ?? undefined}>{row.title ?? "—"}</span>,
    },
    {
      header: "Last updated",
      kind: "time",
      render: (row) => <LocalTime seconds={row.updatedSeconds} />,
    },
    {
      header: "Actions",
      srOnlyHeader: true,
      kind: "actions",
      render: (row) => {
        const url = fileUrl(row.name);
        return (
          <>
            <CopyIconButton
              text={url}
              label="Copy URL"
              className={styles.iconButton}
              promptLabel="Copy the file URL:"
            />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.iconButton}
              aria-label="Open raw YAML"
              title="Open raw YAML"
            >
              <ExternalLinkIcon />
            </a>
            {isCodeModule(row.kind) ? (
              <Link
                href={`/codes/new?module=${row.kind}&file=${encodeURIComponent(url)}`}
                className={styles.iconButton}
                aria-label="Create code"
                title="Create code"
              >
                <ShareIcon />
              </Link>
            ) : null}
            <Link
              href={`/files/edit/${row.name}`}
              className={styles.iconButton}
              aria-label={`Edit ${row.name}`}
              title="Edit"
            >
              <EditIcon />
            </Link>
            <Link
              href={`/files/gui/edit/${row.name}`}
              className={styles.iconButton}
              aria-label={`Open ${row.name} in GUI editor`}
              title="Edit in GUI (experimental)"
            >
              <LayoutIcon />
            </Link>
          </>
        );
      },
    },
  ];

  return (
    <main className={pageStyles.main}>
      <SelectionProvider allIds={rows.map((row) => row.name)}>
        <DataList
          rows={rows}
          getRowKey={(row) => row.id}
          columns={columns}
          hint={
            <>
              App-hosted YAML files. Copy a file's public URL and paste it into a tutor code (tutor
              files offer a one-click shortcut). Every save is validated; an invalid file is
              rejected.
            </>
          }
          actions={
            <>
              <Link href="/files/new" className={buttonVariants()}>
                New file
              </Link>
              <Link href="/images" className={buttonVariants()}>
                Manage images
              </Link>
              <DeleteSelectedButton action={deleteSelectedFilesAction} itemNoun="file" />
            </>
          }
          filterBar={
            <ListFilterBar
              hasActiveFilter={q !== "" || !onlyMine}
              resetKey={`${q}|${onlyMine ? "1" : "0"}`}
            >
              <Input
                type="search"
                name="q"
                className="w-72"
                placeholder="Filter by name, title, description…"
                defaultValue={q}
                aria-label="Filter files"
              />
              <FilterCheckbox name="mine" label="Only my files" defaultChecked={onlyMine} />
            </ListFilterBar>
          }
          isFiltered={q !== ""}
          emptyState={
            <>
              No files yet. <Link href="/files/new">Create one</Link> to host a tutor, fragment or
              quiz YAML.
            </>
          }
          noMatchState="No files match your filter."
        />
      </SelectionProvider>
    </main>
  );
}
