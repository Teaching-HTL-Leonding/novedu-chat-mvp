import { useState } from "react";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { DIALOG_BODY, DialogShell } from "@/components/ui/dialog-shell";

// Pins the DialogShell contract: a CLOSED dialog renders nothing visible (the
// shell must not override the UA's `dialog:not([open]) { display: none }` —
// a bare `flex` on the element once made every closed dialog render inline),
// `open` drives the native showModal()/close(), and closing routes through
// `onClose` from the header button.

function Harness({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <DialogShell open={open} onClose={() => setOpen(false)} title="Preview">
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
