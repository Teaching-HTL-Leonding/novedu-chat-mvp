import Link from "next/link";
import { auth } from "@/auth";
import { CopyIconButton } from "@/components/copy-icon-button";
import { DataList, type ListColumn } from "@/components/data-list";
import { ListFilterBar, OwnerFilter } from "@/components/list-filter-bar";
import { DeleteSelectedButton, SelectionProvider } from "@/components/list-selection";
import { Notice } from "@/components/notice";
import { ownerColumn } from "@/components/owner-column";
import { Main } from "@/components/page-main";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { selectionColumn } from "@/components/selection-column";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type OwnerParams, parseOwner } from "@/lib/db/owner-filter";
import { type PagingParams, parsePaging } from "@/lib/db/paging";
import { parseSort, type SortParams } from "@/lib/db/sorting";
import { mintReadSas } from "@/lib/image-blob";
import { IMAGE_SORT_COLUMNS, listImageOwners, listImages } from "@/lib/image-store";
import { deleteSelectedImagesAction } from "@/lib/images-actions";
import { LocalTime } from "../local-time";
import { ViewImageButton } from "./view-image-button";

// One active image as shown in the list. `viewUrl` is a short-lived read SAS
// minted on the server (no app route serves image bytes) — the "View" button
// opens it in the lightbox; `updatedSeconds` is the active version's write time as
// unix seconds; `createdBy` is the OWNER's oid — here the last writer, since the
// table is append-only — which drives the owner filter, applied in the DB.
// `ownerName` is its `novedu_users` resolution, `null` for a teacher who has never
// signed in through the web app.
interface ImageRow {
  id: string;
  name: string;
  mimeType: string;
  byteSize: number;
  viewUrl: string;
  credit: string | null;
  updatedSeconds: number;
  createdBy: string;
  ownerName: string | null;
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
// contains-filter over the name and an owner dropdown (defaulting to the
// signed-in teacher) — both applied IN THE DATABASE via URL search params
// (see `docs/filtered-lists.md`), never in
// memory. No row-level security: every teacher sees and maintains every image.
// "Effective" teacher: a teacher in student mode is denied like a student.
export default async function ImagesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] } & OwnerParams & PagingParams & SortParams>;
}) {
  const denied = await requireTeacherPage();
  if (denied) return denied;

  const session = await auth();
  const currentUserId = session?.user?.id ?? "";

  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim();
  // Absent `?owner=` means the signed-in teacher, so the default view — and
  // "Clear" — need no param at all (docs/filtered-lists.md).
  const owner = parseOwner(sp, currentUserId);
  const paging = parsePaging(sp);
  const sort = parseSort(sp, IMAGE_SORT_COLUMNS);

  // The dropdown's options come from the whole (unfiltered) image set, so the owner
  // a teacher just picked can never disappear from the control that picked them.
  const [result, owners] = await Promise.all([
    listImages({ search: q || undefined, createdBy: owner.createdBy, paging, sort }),
    listImageOwners(),
  ]);

  if (result === undefined) {
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
    result.rows.map((entry) => mintReadSas(entry.blobPath).catch(() => "")),
  );

  const rows: ImageRow[] = result.rows.map((entry, index) => ({
    id: entry.id,
    name: entry.name,
    mimeType: entry.mimeType,
    byteSize: entry.byteSize,
    viewUrl: viewUrls[index] ?? "",
    credit: entry.credit,
    updatedSeconds: Math.floor(entry.validFrom.getTime() / 1000),
    createdBy: entry.createdBy,
    ownerName: entry.ownerName,
  }));

  const columns: ListColumn<ImageRow, keyof typeof IMAGE_SORT_COLUMNS>[] = [
    // Leading multi-select column; the selection key is the image NAME, which is
    // what `deleteSelectedImagesAction` deletes by (and is unique among active images).
    selectionColumn<ImageRow>(
      (row) => row.name,
      (row) => row.name,
    ),
    {
      header: "Name",
      sortKey: "name",
      className: "whitespace-nowrap font-mono",
      render: (row) => row.name,
    },
    {
      header: "Mime",
      sortKey: "mime",
      render: (row) => <Badge className="font-mono tracking-wide">{row.mimeType}</Badge>,
    },
    {
      header: "Size",
      sortKey: "size",
      className: "whitespace-nowrap tabular-nums",
      render: (row) => formatBytes(row.byteSize),
    },
    {
      header: "Credit",
      sortKey: "credit",
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
    ownerColumn<ImageRow>(),
    {
      header: "Last updated",
      sortKey: "updated",
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
              hasActiveFilter={q !== "" || owner.value !== ""}
              resetKey={`${q}|${owner.value}`}
              pageSize={result.pageSize}
              sort={sort}
            >
              <Input
                type="search"
                name="q"
                className="w-72"
                placeholder="Filter by name…"
                defaultValue={q}
                aria-label="Filter images"
              />
              <OwnerFilter
                className="w-56"
                noun="images"
                options={owners}
                value={owner.value}
                currentUserId={currentUserId}
                currentUserName={session?.user?.name}
              />
            </ListFilterBar>
          }
          isFiltered={q !== "" || owner.value !== ""}
          emptyState={
            <>
              No images yet. <Link href="/images/new">Upload one</Link> to reference it from your
              YAML content.
            </>
          }
          noMatchState="No images match your filter."
          pathname="/images"
          params={sp}
          pagination={result}
          sorting={sort}
        />
      </SelectionProvider>
    </Main>
  );
}
