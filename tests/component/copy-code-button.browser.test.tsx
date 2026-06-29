import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CopyCodeButton } from "@/app/codes/copy-code-button";

// The /codes list copy button is module-aware: a `coding` code copies the little-coder
// config (models.json — a coding code is an API key, not a web link), every other
// module copies the `/<code>` share link. We spy on navigator.clipboard.writeText to
// capture exactly what lands on the clipboard.

const CODE = "z1yxblebm2";

test("coding: copies the little-coder config (models.json), not the share link", async () => {
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  try {
    const screen = await render(<CopyCodeButton code={CODE} module="coding" />);
    await screen.getByRole("button", { name: "Copy little-coder config" }).click();

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]?.[0] as string;
    const cfg = JSON.parse(copied);
    expect(cfg.providers.novedu.api).toBe("openai-completions");
    expect(cfg.providers.novedu.baseUrl).toBe(`${window.location.origin}/api/coding/v1`);
    expect(cfg.providers.novedu.apiKey).toBe(CODE);
    // It is NOT the share link.
    expect(copied).not.toBe(`${window.location.origin}/${CODE}`);
  } finally {
    writeText.mockRestore();
  }
});

test("non-coding (tutor): copies the /<code> share link", async () => {
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  try {
    const screen = await render(<CopyCodeButton code={CODE} module="tutor" />);
    await screen.getByRole("button", { name: "Copy link" }).click();

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/${CODE}`);
  } finally {
    writeText.mockRestore();
  }
});
