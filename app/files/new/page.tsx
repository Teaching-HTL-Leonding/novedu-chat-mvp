import { requireTeacherPage } from "@/components/require-teacher-page";
import pageStyles from "../../page.module.css";
import { CreateFileForm } from "./create-file-form";

// Teacher-only: create a new app-hosted YAML file. The server action enforces the
// rule too; this page-level check is for honest UX.
export default async function NewFilePage() {
  const denied = await requireTeacherPage();
  if (denied) return denied;

  return (
    <main className={pageStyles.main}>
      <CreateFileForm />
    </main>
  );
}
