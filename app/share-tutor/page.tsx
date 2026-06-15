import { requireTeacherPage } from "@/components/require-teacher-page";
import pageStyles from "../page.module.css";
import { ShareTutorForm } from "./share-tutor-form";

// Teacher-only: creates Tutor Codes that grant students time-windowed access
// to a tutor chat. The server action enforces the same rule; this page-level
// check is for honest UX, not security.
// "Effective" teacher: a teacher in student mode is denied like a student.
//
// `?tutor=<url>` pre-fills the tutor URL field — the "Create tutor code" deep
// link from the YAML Files list lands here with a hosted file's public URL.
export default async function ShareTutorPage({
  searchParams,
}: {
  searchParams: Promise<{ tutor?: string | string[] }>;
}) {
  const denied = await requireTeacherPage();
  if (denied) return denied;

  const params = await searchParams;
  const initialTutorUrl = Array.isArray(params.tutor) ? params.tutor[0] : (params.tutor ?? "");
  return (
    <main className={pageStyles.main}>
      <ShareTutorForm initialTutorUrl={initialTutorUrl} />
    </main>
  );
}
