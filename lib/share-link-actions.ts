"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { gcExpiredShareLinks, storeShareLink } from "@/lib/share-link-store";
import {
  buildShareLink,
  getShareLinkSecret,
  signSharePayload,
  validateShareRequest,
} from "@/lib/share-links";
import { requireEffectiveTeacher } from "@/lib/student-mode";
import { defaultFetcher, loadAndBuildTutorPrompt } from "@/lib/tutors";

export type ShareLinkFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  // `shortLink` is present when the link was stored in the share-link table;
  // otherwise `warning` explains that only the full link is available.
  | { status: "success"; link: string; shortLink?: string; warning?: string };

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
  // The guard returns the session, so the user id below needs no second
  // auth() round trip (each auth() call re-decrypts the session cookie).
  let session: Awaited<ReturnType<typeof requireEffectiveTeacher>>;
  try {
    session = await requireEffectiveTeacher();
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

  // Sign ONCE: the issued URL and the stored row must carry the identical
  // signature (a resolved short code goes through the same verifyShareLink).
  const sig = signSharePayload(validation.payload, getShareLinkSecret());
  const link = buildShareLink(`${origin}/`, validation.payload, sig);

  // Persist the link so it can also be opened through a short `/?link=<code>`
  // URL. Storage failures must not block the teacher: the full signed link is
  // self-contained and always returned.
  const fullLinkOnly: ShareLinkFormState = {
    status: "success",
    link,
    warning:
      "The link could not be stored, so no short link is available. The full link below still works.",
  };
  const userId = session.user?.id;
  if (!userId) return fullLinkOnly;
  const stored = await storeShareLink(userId, { ...validation.payload, sig, origin });
  if (!stored.stored) return fullLinkOnly;

  // Housekeeping AFTER the response is sent: the teacher never sees the GC
  // result, so it must not delay the form.
  after(() => gcExpiredShareLinks(userId));
  return { status: "success", link, shortLink: `${origin}/?link=${stored.code}` };
}
