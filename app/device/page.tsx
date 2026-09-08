import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { Notice } from "@/components/notice";
import { Main } from "@/components/page-main";
import { Button } from "@/components/ui/button";
import { deviceApproveAction, deviceDenyAction } from "@/lib/device-actions";
import { getSession } from "@/lib/session";

// Where a person approves the command line's sign-in request. The tool prints a
// link that carries its code (`?user_code=…`), so this page never asks anyone to
// type one: without a code there is nothing to show.
//
// Viewing a pending code CLAIMS it for the signed-in user — that is what
// `deviceVerify` does, and it is why approving is only ever possible for the
// person who opened this link. Someone else opening the same link sees no
// buttons.
export const dynamic = "force-dynamic";

function Message({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Main>
      <Notice heading={heading}>{children}</Notice>
    </Main>
  );
}

function UnknownCode() {
  return (
    <Message heading="Nothing to approve">
      <p className="text-foreground/70">
        This code is unknown, expired, or was requested by another account.
      </p>
    </Message>
  );
}

export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const userCode = typeof params.user_code === "string" ? params.user_code : undefined;

  // The proxy already bounced anyone without a session cookie; this is the real
  // check (and what makes the page safe to render at all).
  const session = await getSession();
  if (!session) {
    const page = userCode ? `/device?user_code=${encodeURIComponent(userCode)}` : "/device";
    redirect(`/sign-in?callbackURL=${encodeURIComponent(page)}`);
  }

  if (!userCode) {
    return (
      <Message heading="Nothing to approve">
        <p className="text-foreground/70">Open the link printed by the command line tool.</p>
      </Message>
    );
  }

  if (params.error !== undefined) {
    return (
      <Message heading="Nothing to approve">
        <p className="text-foreground/70">
          This request could not be completed. Ask for a new code in the command line and open the
          new link.
        </p>
      </Message>
    );
  }

  if (params.done === "approved") {
    return (
      <Message heading="Approved">
        <p className="text-foreground/70">Approved — you can return to the terminal.</p>
      </Message>
    );
  }
  if (params.done === "denied") {
    return (
      <Message heading="Denied">
        <p className="text-foreground/70">Denied. Nothing was granted to the waiting device.</p>
      </Message>
    );
  }

  // Claims the code for this user (and tells us whether it is still open).
  let info: Awaited<ReturnType<typeof auth.api.deviceVerify>>;
  try {
    info = await auth.api.deviceVerify({
      query: { user_code: userCode },
      headers: await headers(),
    });
  } catch {
    return <UnknownCode />;
  }

  if (info.status === "approved") {
    return (
      <Message heading="Approved">
        <p className="text-foreground/70">Approved — you can return to the terminal.</p>
      </Message>
    );
  }
  if (info.status === "denied") {
    return (
      <Message heading="Denied">
        <p className="text-foreground/70">Denied. Nothing was granted to the waiting device.</p>
      </Message>
    );
  }
  // A pending code that is claimed by SOMEONE ELSE comes back stripped down to
  // `{ user_code, status }` — no client. Approving it would be refused, so it
  // gets the same plain line as an unknown one.
  if (info.status !== "pending" || !info.client_id) return <UnknownCode />;

  return (
    <Message heading="Approve this sign-in?">
      <p className="text-foreground/70">
        <span className="font-semibold text-foreground">{info.client_id}</span> is asking to sign in
        as you.
      </p>
      <p className="text-foreground/70">
        Code <span className="font-mono font-semibold text-foreground">{info.user_code}</span>
      </p>
      <p className="text-foreground/70">
        You are signed in as{" "}
        <span className="font-semibold text-foreground">{session.user.name}</span> (
        {session.user.email}).
      </p>
      <p className="font-semibold text-warning">
        Approve only a code you requested yourself, on your own computer, a moment ago.
      </p>
      <div className="mt-2 flex gap-2">
        <form action={deviceApproveAction}>
          <input type="hidden" name="userCode" value={info.user_code} />
          <Button type="submit">Approve</Button>
        </form>
        <form action={deviceDenyAction}>
          <input type="hidden" name="userCode" value={info.user_code} />
          <Button type="submit" variant="outline">
            Deny
          </Button>
        </form>
      </div>
    </Message>
  );
}
