import Link from "next/link";
import { auth } from "@/auth";
import { CopyIconButton } from "@/components/copy-icon-button";
import { DataList, type ListColumn } from "@/components/data-list";
import { FilterCheckbox, ListFilterBar } from "@/components/list-filter-bar";
import { DeleteSelectedButton, SelectionProvider } from "@/components/list-selection";
import { Notice } from "@/components/notice";
import { Main } from "@/components/page-main";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { selectionColumn } from "@/components/selection-column";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mintReadSas } from "@/lib/image-blob";
import { listImages } from "@/lib/image-store";
import { deleteSelectedImagesAction } from "@/lib/images-actions";
import { LocalTime } from "../local-time";
import { ViewImageButton } from "./view-image-button";

// One active image as shown in the list. `viewUrl` is a short-lived read SAS
// minted on the server (no app route serves image bytes) — the "View" button
// opens it in the lightbox; `updatedSeconds` is the active version's write time as
// unix seconds; `createdBy` is the writer's oid (drives the "Only my images"
// filter, applied in the DB).
interface ImageRow {
  id: string;
  name: string;
  mimeType: string;
  byteSize: number;
  viewUrl: string;
  credit: string | null;
  updatedSeconds: number;
  createdBy: string;
}

// Renders a byte count as a short human-readable size (e.g. "512 B", "1.4 MB").
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// Teacher-only: every app-hosted image (active versions only), with a
// contains-filter over the name and an "Only my images" toggle — both applied IN
// THE DATABASE via URL search params (see `docs/filtered-lists.md`), never in
// memory. No row-level security: every teacher sees and maintains every image.
// "Effective" teacher: a teacher in student mode is denied like a student.
export default async function ImagesPage({
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

  const entries = await listImages({
    search: q || undefined,
    createdBy: onlyMine ? currentUserId : undefined,
  });

  if (entries === undefined) {
    return (
      <Main>
        <Notice heading="Images temporarily unavailable">
          <p>Your images could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </Main>
    );
  }

  // Mint every row's read SAS up front (in parallel) so the "View" button opens
  // the image directly from Blob Storage — there is no app route serving bytes.
  // Each mint is guarded independently: a transient failure on one blob yields an
  // empty src (that row's lightbox shows its fallback note) instead of rejecting
  // the whole page, which already loaded the list successfully.
  const viewUrls = await Promise.all(
    entries.map((entry) => mintReadSas(entry.blobPath).catch(() => "")),
  );

  const rows: ImageRow[] = entries.map((entry, index) => ({
    id: entry.id,
    name: entry.name,
    mimeType: entry.mimeType,
    byteSize: entry.byteSize,
    viewUrl: viewUrls[index] ?? "",
    credit: entry.credit,
    updatedSeconds: Math.floor(entry.validFrom.getTime() / 1000),
    createdBy: entry.createdBy,
  }));

  const columns: ListColumn<ImageRow>[] = [
    // Leading multi-select column; the selection key is the image NAME, which is
    // what `deleteSelectedImagesAction` deletes by (and is unique among active images).
    selectionColumn<ImageRow>(
      (row) => row.name,
      (row) => row.name,
    ),
    { header: "Name", className: "whitespace-nowrap font-mono", render: (row) => row.name },
    {
      header: "Mime",
      render: (row) => <Badge className="font-mono tracking-wide">{row.mimeType}</Badge>,
    },
    {
      header: "Size",
      className: "whitespace-nowrap tabular-nums",
      render: (row) => formatBytes(row.byteSize),
    },
    {
      header: "Credit",
      render: (row) =>
        row.credit ? (
          <span
            className="inline-block max-w-64 overflow-hidden text-ellipsis whitespace-nowrap align-bottom text-foreground/70"
            title={row.credit}
          >
            {row.credit}
          </span>
        ) : (
          "—"
        ),
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
      render: (row) => (
        <>
          <ViewImageButton name={row.name} url={row.viewUrl} credit={row.credit} />
          <CopyIconButton text={row.name} label="Copy name" promptLabel="Copy the image name:" />
        </>
      ),
    },
  ];

  return (
    <Main>
      <SelectionProvider allIds={rows.map((row) => row.name)}>
        <DataList
          rows={rows}
          getRowKey={(row) => row.id}
          columns={columns}
          hint={
            <>
              App-hosted images. Upload a PNG, JPEG or SVG (max 5 MB) and reference it by name from
              a tutor, fragment or quiz. Bytes are served direct from Blob Storage.
            </>
          }
          actions={
            <>
              <Link href="/images/new" className={buttonVariants()}>
                New image
              </Link>
              <DeleteSelectedButton action={deleteSelectedImagesAction} itemNoun="image" />
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
                placeholder="Filter by name…"
                defaultValue={q}
                aria-label="Filter images"
              />
              <FilterCheckbox name="mine" label="Only my images" defaultChecked={onlyMine} />
            </ListFilterBar>
          }
          isFiltered={q !== ""}
          emptyState={
            <>
              No images yet. <Link href="/images/new">Upload one</Link> to reference it from your
              YAML content.
            </>
          }
          noMatchState="No images match your filter."
        />
      </SelectionProvider>
    </Main>
  );
}
