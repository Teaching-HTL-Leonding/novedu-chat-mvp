import { Main } from "@/components/page-main";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { UploadImageForm } from "./upload-image-form";

// Teacher-only: upload a new app-hosted image. The server actions enforce the rule
// too; this page-level check is for honest UX.
export default async function NewImagePage() {
  const denied = await requireTeacherPage();
  if (denied) return denied;

  return (
    <Main>
      <UploadImageForm />
    </Main>
  );
}
