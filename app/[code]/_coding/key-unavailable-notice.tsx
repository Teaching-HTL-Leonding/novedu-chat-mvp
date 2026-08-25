import { Notice } from "@/components/notice";

// The one fallback both key-holding surfaces render when the key store cannot
// answer (database unavailable): the student page (render-coding.tsx, a `null`
// from `getOrCreateCodingKey`) and the teacher's own block on the detail page
// (coding-detail.tsx, the `error` status of `getStoredCodingKey`). Shared so the
// wording cannot drift between them. Server component — pure presentation.
export function KeyUnavailableNotice() {
  return (
    <Notice heading="Connection details temporarily unavailable">
      <p>Your connection details could not be loaded right now. Try again in a moment.</p>
    </Notice>
  );
}
