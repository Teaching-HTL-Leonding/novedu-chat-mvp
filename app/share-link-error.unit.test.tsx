import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShareLinkError } from "./share-link-error";

// One assertion per rejection reason: the student must always learn WHY the
// link does not work, and (when the signature was valid) WHEN the window
// opens/closed — rendered in local time via <time>.

describe("ShareLinkError", () => {
  it("explains that a share link is required when parameters are missing", () => {
    render(<ShareLinkError verification={{ ok: false, reason: "missing-params" }} />);
    expect(screen.getByRole("heading", { name: "No tutor link" })).toBeInTheDocument();
    expect(screen.getByText(/ask your teacher/i)).toBeInTheDocument();
  });

  it("flags a tampered link", () => {
    render(<ShareLinkError verification={{ ok: false, reason: "invalid-signature" }} />);
    expect(screen.getByRole("heading", { name: "Invalid share link" })).toBeInTheDocument();
    expect(screen.getByText(/invalid or has been modified/i)).toBeInTheDocument();
  });

  it("shows the local opening time for a not-yet-active link", () => {
    const start = Math.floor(Date.UTC(2026, 5, 10, 12, 0, 0) / 1000);
    render(
      <ShareLinkError
        verification={{ ok: false, reason: "not-started", start, end: start + 3600 }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Tutor not available yet" })).toBeInTheDocument();
    const time = document.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.getAttribute("dateTime")).toBe(new Date(start * 1000).toISOString());
    expect(time?.textContent).toBe(new Date(start * 1000).toLocaleString());
  });

  it("shows the local end time for an expired link", () => {
    const end = Math.floor(Date.UTC(2026, 5, 10, 12, 0, 0) / 1000);
    render(
      <ShareLinkError verification={{ ok: false, reason: "expired", start: end - 3600, end }} />,
    );
    expect(screen.getByRole("heading", { name: "Share link expired" })).toBeInTheDocument();
    expect(document.querySelector("time")?.textContent).toBe(new Date(end * 1000).toLocaleString());
  });
});
