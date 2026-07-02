import { Main } from "@/components/page-main";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { CreateFileForm } from "./create-file-form";

// Teacher-only: create a new app-hosted YAML file. The server action enforces the
// rule too; this page-level check is for honest UX.
export default async function NewFilePage() {
  const denied = await requireTeacherPage();
  if (denied) return denied;

  return (
    <Main>
      <CreateFileForm />
    </Main>
  );
}
