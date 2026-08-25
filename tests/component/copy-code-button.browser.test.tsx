import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CopyCodeButton } from "@/app/codes/copy-code-button";

// The /codes list copy button: every module's code is a regular activity URL (coding
// included), so it always copies the `/<code>` share link. We spy on
// navigator.clipboard.writeText to capture exactly what lands on the clipboard.

const CODE = "z1yxblebm2";

test("copies the /<code> share link", async () => {
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  try {
    const screen = await render(<CopyCodeButton code={CODE} />);
    await screen.getByRole("button", { name: "Copy link" }).click();

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/${CODE}`);
  } finally {
    writeText.mockRestore();
  }
});
