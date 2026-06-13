import { Notice } from "@/components/notice";
import type { CheckTutorCodeResult } from "@/lib/tutor-code-store";
import { LocalTime } from "./local-time";

// Everything that can be wrong with the tutor code a chat was opened with. The
// type is DERIVED from the store's result type, so a new failure reason there
// surfaces here as a missing switch case. (Type-only import — erased at compile
// time, so the store's SERVER-ONLY rule is not violated.)
export type TutorCodeErrorInfo = Extract<CheckTutorCodeResult, { ok: false }>;

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// Maps a failed tutor-code check to a user-facing explanation. Students land
// here when they open the chat with a mistyped/unknown code or outside the
// availability window. Pure presentation — the caller (app/[code]/page.tsx)
// also drops definitively dead codes from the user's recent-codes shortcuts.
export function TutorCodeError({ verification }: { verification: TutorCodeErrorInfo }) {
  switch (verification.reason) {
    case "unknown-code":
      return (
        <Notice heading="Unknown tutor code">
          <p>
            This tutor code does not exist (any more) — expired codes are removed. Check for typos,
            or ask your teacher for a new tutor code.
          </p>
        </Notice>
      );
    case "not-started":
      return (
        <Notice heading="Tutor not available yet">
          <p>
            This tutor is not available yet. The tutor code becomes active on{" "}
            <LocalTime seconds={seconds(verification.validFrom)} />.
          </p>
        </Notice>
      );
    case "expired":
      return (
        <Notice heading="Tutor code expired">
          <p>
            This tutor code has expired (it was valid until{" "}
            <LocalTime seconds={seconds(verification.validUntil)} />
            ). Ask your teacher for a new tutor code.
          </p>
        </Notice>
      );
    case "lookup-failed":
      return (
        <Notice heading="Tutor codes temporarily unavailable">
          <p>
            The tutor code could not be looked up right now. Try again in a moment — the code itself
            keeps working.
          </p>
        </Notice>
      );
  }
}
