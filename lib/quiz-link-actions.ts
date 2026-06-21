"use server";

import { resolveAppOrigin } from "@/lib/app-origin";
import { buildQuizLink, getQuizLinkSecret, validateQuizLinkRequest } from "@/lib/quiz-link";
import { requireEffectiveTeacher } from "@/lib/student-mode";

// Teacher-only server action that mints a signed quiz deep link for a quiz YAML
// URL + availability window. The HMAC secret never leaves the server. The
// browser submits `startTs`/`endTs` as unix seconds (computed client-side — only
// the browser knows the teacher's timezone); the raw datetime-local fields are
// display-only.
//
// Unlike the old tutor share-link action, the quiz YAML is NOT validated here:
// quizzes have no structural validator in the MVP (see docs/quizzes.md), so the
// link is signed for whatever URL the teacher provides. The `/q` page parses the
// quiz leniently at run time.

export type QuizLinkFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; link: string };

export async function createQuizLinkAction(
  _prev: QuizLinkFormState,
  formData: FormData,
): Promise<QuizLinkFormState> {
  // "Effective" teacher: a teacher in student mode is denied like a student.
  try {
    await requireEffectiveTeacher();
  } catch {
    return { status: "error", message: "Only teachers can create quiz links." };
  }

  const validation = validateQuizLinkRequest({
    quiz: formData.get("quiz"),
    start: formData.get("startTs"),
    end: formData.get("endTs"),
  });
  if (!validation.ok) return { status: "error", message: validation.message };

  let origin: string;
  try {
    origin = await resolveAppOrigin();
  } catch {
    return {
      status: "error",
      message:
        "Could not determine the app's public address. Set TUTOR_CODE_ORIGIN in the server configuration.",
    };
  }

  return {
    status: "success",
    link: buildQuizLink(origin, validation.payload, getQuizLinkSecret()),
  };
}
