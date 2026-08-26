import { type ComponentProps, StrictMode, useState } from "react";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { DIALOG_BODY, DialogShell } from "@/components/ui/dialog-shell";
// The component project loads no global CSS, so the height assertions below
// need the real utilities: without them the UA's own `dialog { height:
// fit-content }` answers every measurement and the tests pass vacuously.
import "@/app/globals.css";

// Pins the DialogShell contract: a CLOSED dialog renders nothing visible (the
// shell must not override the UA's `dialog:not([open]) { display: none }` —
// a bare `flex` on the element once made every closed dialog render inline),
// `open` drives the native showModal()/close(), and closing routes through
// `onClose` from the header button.

function Harness({
  initiallyOpen,
  size,
}: {
  initiallyOpen: boolean;
  size?: ComponentProps<typeof DialogShell>["size"];
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <DialogShell open={open} onClose={() => setOpen(false)} title="Preview" size={size}>
      <div className={DIALOG_BODY}>
        <p>dialog content</p>
      </div>
    </DialogShell>
  );
}

test("a closed dialog is not visible and takes no layout space", async () => {
  const screen = await render(<Harness initiallyOpen={false} />);

  const dialog = screen.container.querySelector("dialog");
  expect(dialog).not.toBeNull();
  // The load-bearing assertion: closed ⇒ UA display:none must survive the shell
  // classes (i.e. the computed display is none, not flex).
  expect(window.getComputedStyle(dialog as HTMLDialogElement).display).toBe("none");
});

test("a dialog that MOUNTS already open stays open under StrictMode", async () => {
  // The quiz discussion conditionally renders its shell with open=true from
  // the first render. StrictMode's simulated mount runs effect → cleanup →
  // effect; a cleanup that close()s fires a real close event and flips the
  // parent's state — the dialog would open and instantly close.
  const screen = await render(
    <StrictMode>
      <Harness initiallyOpen={true} />
    </StrictMode>,
  );

  const dialog = screen.container.querySelector("dialog") as HTMLDialogElement;
  await expect.element(screen.getByText("dialog content")).toBeVisible();
  expect(dialog.open).toBe(true);
});

test("open shows the modal with title, body, and Close; Close hides it again", async () => {
  const screen = await render(<Harness initiallyOpen={true} />);

  const dialog = screen.container.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.open).toBe(true);
  await expect.element(screen.getByText("dialog content")).toBeVisible();
  await expect.element(screen.getByRole("heading", { name: "Preview" })).toBeVisible();

  await screen.getByRole("button", { name: "Close" }).click();
  expect(dialog.open).toBe(false);
  expect(window.getComputedStyle(dialog).display).toBe("none");
});

// The `size` variant is the ONE place dialog height is decided, and both values
// are load-bearing in a way no other test would notice: an open modal is
// `position: fixed` with both block insets 0, so a non-definite height silently
// stretches to the viewport instead of wrapping its content (which is exactly
// what the old `h-auto` delta did). These measure the real box in a real
// browser, so a regression shows up as a number, not as a class-name diff.

test("size=fit shrink-wraps short content instead of stretching to the viewport", async () => {
  const screen = await render(<Harness initiallyOpen={true} size="fit" />);

  const dialog = screen.container.querySelector("dialog") as HTMLDialogElement;
  const height = dialog.getBoundingClientRect().height;

  // A title bar plus one line of text is nowhere near a screenful.
  expect(height).toBeLessThan(window.innerHeight / 2);
  // And a definite height means `m-auto` actually centers it: equal gaps.
  const { top, bottom } = dialog.getBoundingClientRect();
  expect(Math.abs(top - (window.innerHeight - bottom))).toBeLessThan(2);
});

test("the default size is the tall 80vh box the open-ended dialogs rely on", async () => {
  const screen = await render(<Harness initiallyOpen={true} />);

  const dialog = screen.container.querySelector("dialog") as HTMLDialogElement;

  // The transcript, the quiz discussion and the writing lightbox pass no size
  // and would collapse to their (tiny) content if the default ever changed.
  expect(dialog.getBoundingClientRect().height).toBeCloseTo(window.innerHeight * 0.8, 0);
});
