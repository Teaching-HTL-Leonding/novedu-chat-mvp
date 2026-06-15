import { Notice } from "@/components/notice";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { resolveAppOriginOr } from "@/lib/app-origin";
import { getActiveFile } from "@/lib/file-store";
import { filePublicUrl } from "@/lib/file-url";
import pageStyles from "../../../page.module.css";
import { EditFileForm } from "./edit-file-form";

// Teacher-only: edit (save a new version of) or delete a hosted file. Keyed by
// the file NAME — the stable identity across versions. A catch-all segment so
// future `/`-separated folder paths work; today names carry no slash. Loads the
// active version's content for the editor.
export default async function EditFilePage({ params }: { params: Promise<{ name: string[] }> }) {
  const denied = await requireTeacherPage();
  if (denied) return denied;

  const { name: segments } = await params;
  const name = segments.join("/");
  const file = await getActiveFile(name);

  if (file === undefined) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="File temporarily unavailable">
          <p>This file could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </main>
    );
  }
  if (file === null) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="File not found">
          <p>This file does not exist or has been deleted.</p>
        </Notice>
      </main>
    );
  }

  const publicUrl = filePublicUrl(await resolveAppOriginOr(""), file.name);

  return (
    <main className={pageStyles.main}>
      <EditFileForm
        name={file.name}
        kind={file.kind}
        initialContent={file.content}
        publicUrl={publicUrl}
      />
    </main>
  );
}
