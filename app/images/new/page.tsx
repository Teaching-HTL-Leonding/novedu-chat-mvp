import { requireTeacherPage } from "@/components/require-teacher-page";
import pageStyles from "../../page.module.css";
import { UploadImageForm } from "./upload-image-form";

// Teacher-only: upload a new app-hosted image. The server actions enforce the rule
// too; this page-level check is for honest UX.
export default async function NewImagePage() {
  const denied = await requireTeacherPage();
  if (denied) return denied;

  return (
    <main className={pageStyles.main}>
      <UploadImageForm />
    </main>
  );
}
