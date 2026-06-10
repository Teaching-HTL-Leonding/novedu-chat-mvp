import { AccessDenied } from "@/components/notice";
import { isEffectiveTeacher } from "@/lib/student-mode";
import pageStyles from "../page.module.css";
import { ShareTutorForm } from "./share-tutor-form";

// Teacher-only: creates signed deep links that grant students time-windowed
// access to a tutor chat. The server action enforces the same rule; this
// page-level check is for honest UX, not security.
// "Effective" teacher: a teacher in student mode is denied like a student.
export default async function ShareTutorPage() {
  if (!(await isEffectiveTeacher())) {
    return (
      <main className={pageStyles.main}>
        <AccessDenied />
      </main>
    );
  }
  return (
    <main className={pageStyles.main}>
      <ShareTutorForm />
    </main>
  );
}
