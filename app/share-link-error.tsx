import { Notice } from "@/components/notice";
import type { ShareLinkVerification } from "@/lib/share-links";
import { LocalTime } from "./local-time";

// Maps a failed share-link verification to a user-facing explanation. Students
// land here when they open the chat without a link, with a tampered link, or
// outside the availability window.
export function ShareLinkError({
  verification,
}: {
  verification: Extract<ShareLinkVerification, { ok: false }>;
}) {
  switch (verification.reason) {
    case "missing-params":
      return (
        <Notice heading="No tutor link">
          <p>
            The chat can only be opened through a tutor share link. Ask your teacher for the link to
            your tutor.
          </p>
        </Notice>
      );
    case "invalid-signature":
      return (
        <Notice heading="Invalid share link">
          <p>
            This share link is invalid or has been modified and cannot be used. Ask your teacher for
            a new link.
          </p>
        </Notice>
      );
    case "not-started":
      return (
        <Notice heading="Tutor not available yet">
          <p>
            This tutor is not available yet. The link becomes active on{" "}
            <LocalTime seconds={verification.start} />.
          </p>
        </Notice>
      );
    case "expired":
      return (
        <Notice heading="Share link expired">
          <p>
            This share link has expired (it was valid until <LocalTime seconds={verification.end} />
            ). Ask your teacher for a new link.
          </p>
        </Notice>
      );
  }
}
