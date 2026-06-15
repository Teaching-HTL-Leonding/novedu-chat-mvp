import { auth } from "@/auth";
import { Notice } from "@/components/notice";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { resolveAppOriginOr } from "@/lib/app-origin";
import { listFiles } from "@/lib/file-store";
import pageStyles from "../page.module.css";
import { type FileRow, FilesBrowser } from "./files-browser";

// Teacher-only: lists every app-hosted YAML file (active versions only), with a
// contains-filter and an "Only my files" toggle. Server component — the list
// comes straight from the database; the filtering and the copy/delete controls
// run on the client. "Effective" teacher: a teacher in student mode is denied
// like a student. No row-level security: every teacher sees and maintains every
// file.
export default async function FilesPage() {
  const denied = await requireTeacherPage();
  if (denied) return denied;

  const session = await auth();
  const currentUserId = session?.user?.id ?? "";
  const entries = await listFiles();

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

  const rows: FileRow[] = entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    title: entry.title,
    description: entry.description,
    updatedSeconds: Math.floor(entry.validFrom.getTime() / 1000),
    createdBy: entry.createdBy,
  }));

  return (
    <main className={pageStyles.main}>
      <FilesBrowser origin={origin} rows={rows} currentUserId={currentUserId} />
    </main>
  );
}
