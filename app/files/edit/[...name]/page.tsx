import { Notice } from "@/components/notice";
import { Main } from "@/components/page-main";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { resolveAppOriginOr } from "@/lib/app-origin";
import { getActiveFile } from "@/lib/file-store";
import { filePublicUrl } from "@/lib/file-url";
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
      <Main>
        <Notice heading="File temporarily unavailable">
          <p>This file could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </Main>
    );
  }
  if (file === null) {
    return (
      <Main>
        <Notice heading="File not found">
          <p>This file does not exist or has been deleted.</p>
        </Notice>
      </Main>
    );
  }

  const publicUrl = filePublicUrl(await resolveAppOriginOr(""), file.name);

  return (
    <Main>
      <EditFileForm
        name={file.name}
        kind={file.kind}
        initialContent={file.content}
        publicUrl={publicUrl}
      />
    </Main>
  );
}
