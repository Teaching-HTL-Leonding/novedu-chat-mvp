import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TutorCodeError } from "./tutor-code-error";

// One assertion per rejection reason: the student must always learn WHY the
// code does not work, and (when the code exists) WHEN the window opens/closed —
// rendered in local time via <time>. Cleanup of dead codes from the user's
// recents happens in app/[code]/page.tsx, not here.

const FROM = new Date(Date.UTC(2026, 5, 10, 12, 0, 0));
const UNTIL = new Date(Date.UTC(2026, 5, 10, 13, 0, 0));

describe("TutorCodeError", () => {
  it("explains an unknown code", () => {
    render(<TutorCodeError verification={{ ok: false, reason: "unknown-code" }} />);
    expect(screen.getByRole("heading", { name: "Unknown tutor code" })).toBeInTheDocument();
    expect(screen.getByText(/ask your teacher/i)).toBeInTheDocument();
  });

  it("shows the local opening time for a not-yet-active code", () => {
    render(
      <TutorCodeError
        verification={{ ok: false, reason: "not-started", validFrom: FROM, validUntil: UNTIL }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Tutor not available yet" })).toBeInTheDocument();
    const time = document.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe(FROM.toISOString());
    expect(time?.textContent).toBe(FROM.toLocaleString());
  });

  it("shows the local end time for an expired code", () => {
    render(
      <TutorCodeError
        verification={{ ok: false, reason: "expired", validFrom: FROM, validUntil: UNTIL }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Tutor code expired" })).toBeInTheDocument();
    const time = document.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe(UNTIL.toISOString());
  });

  it("offers a retry for a failed lookup", () => {
    render(<TutorCodeError verification={{ ok: false, reason: "lookup-failed" }} />);
    expect(
      screen.getByRole("heading", { name: "Tutor codes temporarily unavailable" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/try again/i)).toBeInTheDocument();
  });
});
