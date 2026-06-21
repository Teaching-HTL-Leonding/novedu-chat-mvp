import { requireTeacherPage } from "@/components/require-teacher-page";
import pageStyles from "../page.module.css";
import { ShareQuizForm } from "./share-quiz-form";

// Teacher-only: mint a signed quiz deep link that grants students time-windowed
// access to a quiz. The server action enforces the same rule; this page-level
// check is for honest UX, not security.
//
// `?quiz=<url>` pre-fills the quiz URL field — the "Create quiz link" action from
// the YAML Files list lands here with a hosted quiz file's public URL.
export default async function ShareQuizPage({
  searchParams,
}: {
  searchParams: Promise<{ quiz?: string | string[] }>;
}) {
  const denied = await requireTeacherPage();
  if (denied) return denied;

  const params = await searchParams;
  const initialQuizUrl = Array.isArray(params.quiz) ? params.quiz[0] : (params.quiz ?? "");

  return (
    <main className={pageStyles.main}>
      <ShareQuizForm initialQuizUrl={initialQuizUrl} />
    </main>
  );
}
