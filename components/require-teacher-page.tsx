import type { ReactNode } from "react";
import { AccessDenied } from "@/components/notice";
import { Main } from "@/components/page-main";
import { isEffectiveTeacher } from "@/lib/student-mode";

// Page-level teacher gate, shared by every teacher-only page. Returns a rendered
// <AccessDenied> page when the visitor is NOT an effective teacher (a teacher in
// student mode is denied like a student), or `null` to proceed:
//
//   const denied = await requireTeacherPage();
//   if (denied) return denied;
//
// This is honest-UX only — the server ACTIONS (requireTeacherUserId) are what
// actually enforce the rule.
export async function requireTeacherPage(): Promise<ReactNode | null> {
  if (await isEffectiveTeacher()) return null;
  return (
    <Main>
      <AccessDenied />
    </Main>
  );
}
