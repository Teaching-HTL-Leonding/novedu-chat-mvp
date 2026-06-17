import { requireTeacherPage } from "@/components/require-teacher-page";
import pageStyles from "../../page.module.css";
import { TutorCodeForm } from "../tutor-code-form";

// Teacher-only: create a Tutor Code that grants students time-windowed access to
// a tutor chat. The server action enforces the same rule; this page-level check
// is for honest UX, not security. On success the action redirects to the new
// code's edit page (which shows the shareable link).
//
// `?tutor=<url>` pre-fills the tutor URL field — the "Create tutor code" deep link
// from the YAML Files list lands here with a hosted file's public URL.
export default async function NewTutorCodePage({
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
      <TutorCodeForm mode="create" initialTutorUrl={initialTutorUrl} />
    </main>
  );
}
