"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSession } from "@/lib/session";
import { recordError } from "@/lib/telemetry";

// The two decisions the /device page offers. They are server actions so the page
// itself stays a plain server component: the form posts, the action calls
// better-auth, and a redirect brings the person back to /device with the outcome
// in the query.
//
// Both decisions require the SAME signed-in user to have viewed the code first
// (the page's `deviceVerify` claims it); better-auth enforces that and answers
// 401 without a session — the session check here is defence in depth, not the
// gate.

type Decision = "approved" | "denied";

async function decide(formData: FormData, decision: Decision): Promise<void> {
  const userCode = formData.get("userCode");
  // No code in the form: nothing to decide about. Back to the bare page, which
  // then points at the link the command line printed.
  if (typeof userCode !== "string" || userCode === "") redirect("/device");

  const page = `/device?user_code=${encodeURIComponent(userCode)}`;
  const session = await getSession();
  if (!session) redirect(`/sign-in?callbackURL=${encodeURIComponent(page)}`);

  // `redirect()` works by throwing, so it must stay OUT of the try block — a
  // catch here would swallow the navigation and report it as a failure.
  let failed = false;
  try {
    const requestHeaders = await headers();
    if (decision === "approved") {
      await auth.api.deviceApprove({ body: { userCode }, headers: requestHeaders });
    } else {
      await auth.api.deviceDeny({ body: { userCode }, headers: requestHeaders });
    }
  } catch (error) {
    // Expired, already decided, never claimed by this user, … — the page shows
    // one generic line either way; the reason stays server-side.
    recordError(error, { "novedu.area": "device-approval" });
    failed = true;
  }

  redirect(failed ? `${page}&error=1` : `${page}&done=${decision}`);
}

/** Grants the waiting device a session as the signed-in user. */
export async function deviceApproveAction(formData: FormData): Promise<void> {
  await decide(formData, "approved");
}

/** Refuses the waiting device; its polling ends with an error. */
export async function deviceDenyAction(formData: FormData): Promise<void> {
  await decide(formData, "denied");
}
