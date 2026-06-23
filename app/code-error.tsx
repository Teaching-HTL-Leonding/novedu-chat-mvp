import { Notice } from "@/components/notice";
import type { CheckCodeResult } from "@/lib/code-store";
import { LocalTime } from "./local-time";

// Everything that can be wrong with the code an activity was opened with. The
// type is DERIVED from the store's result type, so a new failure reason there
// surfaces here as a missing switch case. (Type-only import — erased at compile
// time, so the store's SERVER-ONLY rule is not violated.)
export type CodeErrorInfo = Extract<CheckCodeResult, { ok: false }>;

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// Maps a failed code check to a user-facing explanation. Students land here when
// they open an activity with a mistyped/unknown code or outside the availability
// window. Pure presentation — the caller (app/[code]/page.tsx) also drops
// definitively dead codes from the user's recent-codes shortcuts.
export function CodeError({ verification }: { verification: CodeErrorInfo }) {
  switch (verification.reason) {
    case "unknown-code":
      return (
        <Notice heading="Unknown code">
          <p>This code does not exist. Check for typos, or ask your teacher for a new code.</p>
        </Notice>
      );
    case "not-started":
      return (
        <Notice heading="Not available yet">
          <p>
            This activity is not available yet. The code becomes active on{" "}
            <LocalTime seconds={seconds(verification.validFrom)} />.
          </p>
        </Notice>
      );
    case "expired":
      return (
        <Notice heading="Code expired">
          <p>
            This code has expired (it was valid until{" "}
            <LocalTime seconds={seconds(verification.validUntil)} />
            ). Ask your teacher for a new code.
          </p>
        </Notice>
      );
    case "lookup-failed":
      return (
        <Notice heading="Codes temporarily unavailable">
          <p>
            The code could not be looked up right now. Try again in a moment — the code itself keeps
            working.
          </p>
        </Notice>
      );
  }
}
