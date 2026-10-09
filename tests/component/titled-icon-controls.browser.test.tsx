import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
// The real stylesheet: the pass-through IS a Tailwind class, and without it the
// controls would have no size to hover either.
import "@/app/globals.css";

// Every titled icon control shows its tooltip through the native `title`, and
// Chrome shows no HTML title while the pointer is over inline SVG content. So
// each icon must be transparent to the pointer: hovering the middle of the
// control, where the icon sits, has to hit the control ITSELF, or the tooltip
// only appears on its thin rim. One case per recipe that renders such controls.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/auth-actions", () => ({ signOutAction: vi.fn(async () => {}) }));
vi.mock("@/lib/student-mode-actions", () => ({
  enterStudentModeAction: vi.fn(async () => {}),
  exitStudentModeAction: vi.fn(async () => {}),
}));

import { HistoryIcon, RotateCcwIcon } from "@/components/icons";
import { SelectAllControls, SelectionProvider } from "@/components/list-selection";
import { buttonVariants } from "@/components/ui/button";
import { IconButton, iconButtonVariants } from "@/components/ui/icon-button";
import { UserMenu } from "@/components/user-menu";

/** Asserts the icon really covers the centre, yet the pointer reaches the control there. */
function expectCentreHitsControl(control: Element) {
  const svg = control.querySelector("svg");
  if (!svg) throw new Error("no icon rendered");
  // Not vacuous: the icon has a size and spans the control's centre…
  const icon = svg.getBoundingClientRect();
  const rect = control.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  expect(icon.width).toBeGreaterThan(0);
  expect(x >= icon.left && x <= icon.right && y >= icon.top && y <= icon.bottom).toBe(true);
  // …and still the control itself is what the pointer hits.
  expect(document.elementFromPoint(x, y)).toBe(control);
}

test.each([
  ["Start over", RotateCcwIcon],
  ["Previous conversations", HistoryIcon],
])("IconButton: hovering the icon of %s hits the button", async (label, Icon) => {
  const screen = await render(
    <IconButton aria-label={label} title={label}>
      <Icon />
    </IconButton>,
  );
  const button = screen.getByRole("button", { name: label });
  await expect.element(button).toHaveAttribute("title", label);
  expectCentreHitsControl(button.element());
});

test("an anchor styled with iconButtonVariants gets the same pass-through", async () => {
  const screen = await render(
    <a href="/x" aria-label="Open" title="Open" className={iconButtonVariants()}>
      <HistoryIcon />
    </a>,
  );
  expectCentreHitsControl(screen.getByRole("link", { name: "Open" }).element());
});

test("buttonVariants (e.g. the code page's 'Open in new tab' link) passes through too", async () => {
  const screen = await render(
    <a href="/x" aria-label="Open in new tab" title="Open in new tab" className={buttonVariants()}>
      <HistoryIcon />
    </a>,
  );
  expectCentreHitsControl(screen.getByRole("link", { name: "Open in new tab" }).element());
});

test("the lists' select-all / unselect-all icons pass through", async () => {
  const screen = await render(
    <SelectionProvider allIds={["a"]}>
      <SelectAllControls />
    </SelectionProvider>,
  );
  for (const button of screen.getByRole("button").elements()) {
    expect(button.getAttribute("title")).toBeTruthy();
    expectCentreHitsControl(button);
  }
});

test("the user menu's teacher badge passes through", async () => {
  const screen = await render(<UserMenu user={{ name: "Tina Teacher", isTeacher: true }} />);
  const badge = screen.getByRole("img", { name: "Teacher" });
  expect(badge.element().getAttribute("title")).toMatch(/^Teacher/);
  expectCentreHitsControl(badge.element());
});
