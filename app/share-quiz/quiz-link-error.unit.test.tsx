// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { QuizLinkVerification } from "@/lib/quiz-link";
import { QuizLinkError } from "./quiz-link-error";

// The student-facing explanation for a rejected quiz link. Pure presentation —
// rendered with plain props, no infra — so each rejection reason maps to the
// right heading (and the windowed reasons surface their bound).

type Rejection = Extract<QuizLinkVerification, { ok: false }>;

function render(verification: Rejection) {
  return renderToStaticMarkup(<QuizLinkError verification={verification} />);
}

describe("QuizLinkError", () => {
  it("explains a missing link", () => {
    expect(render({ ok: false, reason: "missing-params" })).toContain("No quiz link");
  });

  it("explains a tampered link", () => {
    expect(render({ ok: false, reason: "invalid-signature" })).toContain("Invalid quiz link");
  });

  it("explains a not-yet-available quiz and renders the start time", () => {
    const html = render({ ok: false, reason: "not-started", start: 1_000, end: 2_000 });
    expect(html).toContain("not available yet");
    expect(html).toContain("<time");
  });

  it("explains an expired link and renders the end time", () => {
    const html = render({ ok: false, reason: "expired", start: 1_000, end: 2_000 });
    expect(html).toContain("expired");
    expect(html).toContain("<time");
  });
});
