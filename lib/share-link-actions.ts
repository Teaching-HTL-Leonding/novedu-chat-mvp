"use server";

import { headers } from "next/headers";
import { buildShareLink, getShareLinkSecret, validateShareRequest } from "@/lib/share-links";
import { requireEffectiveTeacher } from "@/lib/student-mode";
import { defaultFetcher, loadAndBuildTutorPrompt } from "@/lib/tutors";

export type ShareLinkFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; link: string };

// The origin the generated links point at. Prefer the explicit SHARE_LINK_ORIGIN
// env var (set it in production — forwarded headers are only as trustworthy as
// the proxy chain in front of the app). Without it, fall back to the request's
// forwarded/host headers, which is fine for local dev. Multi-hop proxies append
// comma-separated values, so only the first (client-most) entry counts.
async function resolveAppOrigin(): Promise<string> {
  const configured = process.env.SHARE_LINK_ORIGIN;
  if (configured) return new URL(configured).origin;

  const h = await headers();
  const first = (value: string | null) => value?.split(",")[0]?.trim() || undefined;
  const host = first(h.get("x-forwarded-host")) ?? first(h.get("host"));
  if (!host) throw new Error("No host header");
  const proto = first(h.get("x-forwarded-proto")) ?? "http";
  return new URL(`${proto}://${host}`).origin;
}

// Creates a signed deep link to the chat for a tutor + availability window.
// Server action so the HMAC secret never leaves the server. The browser submits
// `startTs`/`endTs` as unix seconds (computed client-side — only the browser
// knows the teacher's timezone); the raw datetime-local fields are display-only.
export async function createShareLinkAction(
  _prev: ShareLinkFormState,
  formData: FormData,
): Promise<ShareLinkFormState> {
  try {
    await requireEffectiveTeacher();
  } catch {
    return { status: "error", message: "Only teachers can create share links." };
  }

  const validation = validateShareRequest({
    tutor: formData.get("tutor"),
    start: formData.get("startTs"),
    end: formData.get("endTs"),
  });
  if (!validation.ok) return { status: "error", message: validation.message };

  // Catch broken tutors at share time, not when the first student clicks the
  // link. Reuses the same pipeline the chat page runs on the receiving end.
  const result = await loadAndBuildTutorPrompt(validation.payload.tutor, defaultFetcher);
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
        "Could not determine the app's public address. Set SHARE_LINK_ORIGIN in the server configuration.",
    };
  }

  return {
    status: "success",
    link: buildShareLink(`${origin}/`, validation.payload, getShareLinkSecret()),
  };
}
