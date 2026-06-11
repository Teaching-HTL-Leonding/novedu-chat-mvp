import { Notice } from "@/components/notice";
import type { ResolveShortCodeResult } from "@/lib/share-link-store";
import type { ShareLinkVerification } from "@/lib/share-links";
import { LocalTime } from "./local-time";

// Everything that can be wrong with the way the chat was opened: a failed
// signature/window verification, or a short link (`/?link=<code>`) that could
// not be resolved to a stored share link. Both halves are DERIVED from the lib
// result types, so a new failure reason there surfaces here as a missing switch
// case. (Type-only imports — erased at compile time, so the lib modules'
// SERVER-ONLY rule is not violated.)
export type ShareLinkErrorInfo =
  | Extract<ShareLinkVerification, { ok: false }>
  | Extract<ResolveShortCodeResult, { ok: false }>;

// Maps a failed share-link verification to a user-facing explanation. Students
// land here when they open the chat without a link, with a tampered link, or
// outside the availability window.
export function ShareLinkError({ verification }: { verification: ShareLinkErrorInfo }) {
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
    case "unknown-code":
      return (
        <Notice heading="Unknown share link">
          <p>
            This short link does not exist (any more) — expired links are removed. Ask your teacher
            for a new link.
          </p>
        </Notice>
      );
    case "lookup-failed":
      return (
        <Notice heading="Share links temporarily unavailable">
          <p>
            The short link could not be looked up right now. Try again in a moment, or ask your
            teacher for the full share link — it keeps working.
          </p>
        </Notice>
      );
  }
}
