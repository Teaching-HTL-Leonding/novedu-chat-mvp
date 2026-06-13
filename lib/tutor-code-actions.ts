"use server";

import { headers } from "next/headers";
import { requireEffectiveTeacher } from "@/lib/student-mode";
import { createTutorCode, validateTutorCodeRequest } from "@/lib/tutor-code-store";
import { defaultFetcher, loadAndBuildTutorPrompt } from "@/lib/tutors";

export type TutorCodeFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  // `link` is the full chat URL (`https://<origin>/<code>`), ready to hand out.
  | { status: "success"; link: string; note: string };

// The origin the generated chat URLs point at. Prefer the explicit
// TUTOR_CODE_ORIGIN env var (set it in production — forwarded headers are only
// as trustworthy as the proxy chain in front of the app). Without it, fall back
// to the request's forwarded/host headers, which is fine for local dev.
// Multi-hop proxies append comma-separated values, so only the first
// (client-most) entry counts. Display-only: a code works on ANY origin.
async function resolveAppOrigin(): Promise<string> {
  const configured = process.env.TUTOR_CODE_ORIGIN;
  if (configured) return new URL(configured).origin;

  const h = await headers();
  const first = (value: string | null) => value?.split(",")[0]?.trim() || undefined;
  const host = first(h.get("x-forwarded-host")) ?? first(h.get("host"));
  if (!host) throw new Error("No host header");
  const proto = first(h.get("x-forwarded-proto")) ?? "http";
  return new URL(`${proto}://${host}`).origin;
}

// Creates a Tutor Code for a tutor + availability window. The stored row is the
// only artifact — there is no stateless fallback, so a storage failure is a
// hard error. The browser submits `startTs`/`endTs` as unix seconds (computed
// client-side — only the browser knows the teacher's timezone); the raw
// datetime-local fields are display-only.
export async function createTutorCodeAction(
  _prev: TutorCodeFormState,
  formData: FormData,
): Promise<TutorCodeFormState> {
  // The guard returns the session, so the user id below needs no second
  // auth() round trip (each auth() call re-decrypts the session cookie).
  let session: Awaited<ReturnType<typeof requireEffectiveTeacher>>;
  try {
    session = await requireEffectiveTeacher();
  } catch {
    return { status: "error", message: "Only teachers can create tutor codes." };
  }

  const validation = validateTutorCodeRequest({
    tutor: formData.get("tutor"),
    start: formData.get("startTs"),
    end: formData.get("endTs"),
    note: formData.get("note"),
  });
  if (!validation.ok) return { status: "error", message: validation.message };

  // Catch broken tutors at create time, not when the first student opens the
  // code. Reuses the same pipeline the chat page runs on the receiving end.
  const result = await loadAndBuildTutorPrompt(validation.payload.tutorUrl, defaultFetcher);
  if (!result.ok) {
    const first = result.errors[0];
    return {
      status: "error",
      message: first
        ? `The tutor failed validation (${first.code}): ${first.message}`
        : "The tutor failed validation.",
    };
  }

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

  const userId = session.user?.id;
  if (!userId) {
    return { status: "error", message: "Your session carries no user id — sign in again." };
  }
  const stored = await createTutorCode(userId, { ...validation.payload, origin });
  if (!stored.stored) {
    return {
      status: "error",
      message: "The tutor code could not be stored. Try again, or contact the operator.",
    };
  }

  return {
    status: "success",
    link: `${origin}/${stored.code}`,
    note: validation.payload.note,
  };
}
