import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// The attention bar's counters in a real browser: one panel at a time, the
// first counter with something in it open from the start, all-clear pills that
// are no buttons. Needs the real stylesheet: the panel hides via `hidden`.
import "@/app/globals.css";
import { AttentionBar, type AttentionCounter } from "./attention-bar";

// next/link reads Next-server globals that don't exist in the browser test
// runner — a plain anchor keeps the href the assertions read.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const COUNTERS: AttentionCounter[] = [
  { id: "closing", total: 0, rows: [], more: 0 },
  {
    id: "reports",
    total: 3,
    more: 0,
    rows: [
      { code: "QZ1", label: "SQL joins quiz", badge: "2 open" },
      { code: "TU1", label: "Recursion tutor", badge: "1 open" },
    ],
  },
  {
    id: "unused",
    total: 7,
    more: 2,
    rows: [{ code: "LP1", label: "Loops warm-up", detail: "Created 18 Sep" }],
  },
];

test("the first counter with something in it starts open; one panel at a time", async () => {
  const screen = await render(<AttentionBar counters={COUNTERS} />);
  const reports = screen.getByRole("button", { name: /Open reports/ });
  const unused = screen.getByRole("button", { name: /Never used/ });
  // Both buttons control the one panel, named after the open counter.
  const controls = reports.element().getAttribute("aria-controls") ?? "";
  await expect.element(unused).toHaveAttribute("aria-controls", controls);
  const panel = screen.getByRole("region", { name: "Open reports" });

  await expect.element(reports).toHaveAttribute("aria-expanded", "true");
  await expect.element(unused).toHaveAttribute("aria-expanded", "false");
  expect(panel.element().id).toBe(controls);
  await expect
    .element(screen.getByRole("link", { name: /SQL joins quiz/ }))
    .toHaveAttribute("href", "/codes/QZ1");
  await expect
    .element(screen.getByRole("link", { name: "Open Reports" }))
    .toHaveAttribute("href", "/reports");

  await unused.click();
  await expect.element(unused).toHaveAttribute("aria-expanded", "true");
  await expect.element(reports).toHaveAttribute("aria-expanded", "false");
  await expect.element(screen.getByRole("region", { name: "Never used" })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: /Loops warm-up/ })).toBeVisible();
  await expect.element(screen.getByText("2 more codes not shown.", { exact: false })).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: /SQL joins quiz/ }))
    .not.toBeInTheDocument();

  // A second click closes it: nothing open, the panel hidden.
  await unused.click();
  await expect.element(unused).toHaveAttribute("aria-expanded", "false");
  expect(document.getElementById(controls)?.hidden).toBe(true);
});

test("an empty counter is an all-clear pill, not a button", async () => {
  const screen = await render(<AttentionBar counters={COUNTERS} />);
  await expect.element(screen.getByText("Nothing closes in the next 3 days")).toBeVisible();
  expect(screen.getByRole("button").elements()).toHaveLength(2);
});

test("all clear: nothing to open, no panel", async () => {
  const screen = await render(
    <AttentionBar
      counters={[
        { id: "closing", total: 0, rows: [], more: 0 },
        { id: "reports", total: 0, rows: [], more: 0 },
        { id: "unused", unavailable: true },
      ]}
    />,
  );
  expect(screen.getByRole("button").elements()).toHaveLength(0);
  await expect.element(screen.getByText("No open reports")).toBeVisible();
  await expect.element(screen.getByText("Never used: could not be loaded")).toBeVisible();
  expect(document.querySelector("section section")?.hasAttribute("hidden")).toBe(true);
});
