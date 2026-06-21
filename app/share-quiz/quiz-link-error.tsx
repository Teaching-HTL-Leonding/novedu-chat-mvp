import { Notice } from "@/components/notice";
import type { QuizLinkVerification } from "@/lib/quiz-link";
import { LocalTime } from "../local-time";

// Maps a failed quiz-link verification to a user-facing explanation. Students
// land here when they open `/q` without a link, with a tampered link, or outside
// the availability window. Revives the removed tutor share-link-error view.
export function QuizLinkError({
  verification,
}: {
  verification: Extract<QuizLinkVerification, { ok: false }>;
}) {
  switch (verification.reason) {
    case "missing-params":
      return (
        <Notice heading="No quiz link">
          <p>
            A quiz can only be opened through a quiz link. Ask your teacher for the link to your
            quiz.
          </p>
        </Notice>
      );
    case "invalid-signature":
      return (
        <Notice heading="Invalid quiz link">
          <p>
            This quiz link is invalid or has been modified and cannot be used. Ask your teacher for
            a new link.
          </p>
        </Notice>
      );
    case "not-started":
      return (
        <Notice heading="Quiz not available yet">
          <p>
            This quiz is not available yet. The link becomes active on{" "}
            <LocalTime seconds={verification.start} />.
          </p>
        </Notice>
      );
    case "expired":
      return (
        <Notice heading="Quiz link expired">
          <p>
            This quiz link has expired (it was valid until <LocalTime seconds={verification.end} />
            ). Ask your teacher for a new link.
          </p>
        </Notice>
      );
  }
}
