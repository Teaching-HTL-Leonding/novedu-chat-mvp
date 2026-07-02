import { AccessDenied } from "@/components/notice";
import { Main } from "@/components/page-main";
import { isEffectiveTeacher } from "@/lib/student-mode";
import { ValidateTutorForm } from "./validate-tutor-form";

// Teacher-only: validating tutor definitions — or a fragment library on its own
// (the form's Tutor / Fragment selector) — is an authoring concern. The API
// route this form posts to (/api/validate-tutor) enforces the same rule
// server-side; this page-level check is for honest UX, not security.
// "Effective" teacher: a teacher in student mode is denied like a student.
export default async function ValidateTutorPage() {
  if (!(await isEffectiveTeacher())) {
    return (
      <Main>
        <AccessDenied />
      </Main>
    );
  }
  return (
    <Main>
      <ValidateTutorForm />
    </Main>
  );
}
