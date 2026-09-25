import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The time filter's client logic: preset links keep the zone and drop a custom
// window; Apply converts the local inputs to ISO UTC (jsdom runs in the process
// zone, so the expectation is built the same way) and validates inline; the
// zone redirect adds today's range and the browser zone.

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/diagnostics",
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => nav.params,
}));

import { EnsureRange } from "./ensure-range";
import { RangeControls } from "./range-controls";

beforeEach(() => {
  vi.clearAllMocks();
  nav.params = new URLSearchParams();
});

describe("RangeControls", () => {
  it("links presets with the zone kept and the custom window dropped", () => {
    nav.params = new URLSearchParams("tz=Europe%2FVienna&from=a&to=b");
    render(<RangeControls active="custom" />);
    const href = screen.getByRole("link", { name: "Yesterday" }).getAttribute("href") ?? "";
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("tz")).toBe("Europe/Vienna");
    expect(params.get("range")).toBe("yesterday");
    expect(params.has("from")).toBe(false);
    expect(params.has("to")).toBe(false);
    expect(screen.getByText("Custom")).toHaveAttribute("aria-current", "page");
  });

  it("marks the active preset", () => {
    render(<RangeControls active="today" />);
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  });

  it("pushes the custom window as ISO UTC", () => {
    render(<RangeControls active="today" />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-25T09:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-25T10:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(nav.push).toHaveBeenCalledTimes(1);
    const url = String(nav.push.mock.calls[0]?.[0]);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("from")).toBe(new Date("2026-09-25T09:00").toISOString());
    expect(params.get("to")).toBe(new Date("2026-09-25T10:30").toISOString());
    expect(params.has("range")).toBe(false);
  });

  it("rejects an inverted or missing window inline", () => {
    render(<RangeControls active="today" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a start and an end.");

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-25T11:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-25T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The start must be before the end.");
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("prefills the form from the resolved window", () => {
    render(
      <RangeControls
        active="today"
        from={new Date("2026-09-25T09:00").toISOString()}
        to={new Date("2026-09-25T10:30").toISOString()}
      />,
    );
    expect(screen.getByLabelText("From")).toHaveValue("2026-09-25T09:00");
    expect(screen.getByLabelText("To")).toHaveValue("2026-09-25T10:30");
  });
});

describe("EnsureRange", () => {
  it("replaces the URL with today's range and the browser zone", () => {
    render(<EnsureRange />);
    const url = String(nav.replace.mock.calls[0]?.[0]);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("range")).toBe("today");
    expect(params.get("tz")).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("keeps a preset that is already set", () => {
    nav.params = new URLSearchParams("range=last7d");
    render(<EnsureRange />);
    expect(String(nav.replace.mock.calls[0]?.[0])).toContain("range=last7d");
  });
});
