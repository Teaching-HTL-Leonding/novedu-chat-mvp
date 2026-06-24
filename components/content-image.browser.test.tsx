import { describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

// <ContentImage>'s rendering + lightbox contract: a bounded thumbnail <img> (with
// the supplied alt) inside a real button that opens a native <dialog> lightbox.
// Opening works by click AND keyboard (Enter / Space) on the button; the dialog
// closes via Escape, the Close button, and a backdrop click. A failed <img> load
// swaps in the muted fallback note. Pure-prop rendering — no infra, no @live tag.

import { ContentImage } from "@/components/content-image";

// A valid 1x1 transparent PNG so the thumbnail <img> actually LOADS — an invalid
// src would fire onError and collapse the component to the fallback note, hiding
// the button the lightbox tests need. The fallback path is exercised on its own
// below by dispatching a synthetic error event.
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M8AAAAGAAUjAVFrXQAAAABJRU5ErkJggg==";
const image = { url: PNG_1X1, alt: "A diagram of the flow" };

function dialogEl(): HTMLDialogElement {
  const dialog = document.querySelector("dialog");
  if (!dialog) throw new Error("dialog not rendered");
  return dialog as HTMLDialogElement;
}

// The thumbnail wraps a 1x1 test image, so its hit box is sub-pixel and a
// Playwright pointer click flakes on actionability. A native click on the button
// element still fires the real onClick (opening the dialog) — the genuine "user
// activates the button" path, just without pointer hit-testing.
function openViaButtonClick(button: { element: () => Element }): void {
  (button.element() as HTMLButtonElement).click();
}

describe("ContentImage", () => {
  test("renders a bounded thumbnail <img> with the given alt", async () => {
    const screen = await render(<ContentImage image={image} />);

    const thumb = screen.getByRole("img", { name: "A diagram of the flow" });
    await expect.element(thumb).toBeVisible();
    await expect.element(thumb).toHaveAttribute("src", image.url);
  });

  test("clicking the thumbnail button opens the dialog", async () => {
    const screen = await render(<ContentImage image={image} />);
    expect(dialogEl().open).toBe(false);

    openViaButtonClick(screen.getByRole("button", { name: "View larger image" }));

    await vi.waitFor(() => expect(dialogEl().open).toBe(true));
    await expect.element(screen.getByRole("dialog")).toBeVisible();
  });

  test("Enter on the focused button opens the dialog", async () => {
    const screen = await render(<ContentImage image={image} />);
    const button = screen.getByRole("button", { name: "View larger image" });

    button.element().focus();
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(dialogEl().open).toBe(true));
  });

  test("Space on the focused button opens the dialog", async () => {
    const screen = await render(<ContentImage image={image} />);
    const button = screen.getByRole("button", { name: "View larger image" });

    button.element().focus();
    await userEvent.keyboard("{ }");

    await vi.waitFor(() => expect(dialogEl().open).toBe(true));
  });

  test("Escape closes the open dialog", async () => {
    const screen = await render(<ContentImage image={image} />);
    openViaButtonClick(screen.getByRole("button", { name: "View larger image" }));
    await vi.waitFor(() => expect(dialogEl().open).toBe(true));

    await userEvent.keyboard("{Escape}");

    await vi.waitFor(() => expect(dialogEl().open).toBe(false));
  });

  test("the Close button closes the open dialog", async () => {
    const screen = await render(<ContentImage image={image} />);
    openViaButtonClick(screen.getByRole("button", { name: "View larger image" }));
    await vi.waitFor(() => expect(dialogEl().open).toBe(true));

    await screen.getByRole("button", { name: "Close" }).click();

    await vi.waitFor(() => expect(dialogEl().open).toBe(false));
  });

  test("a backdrop click closes the open dialog", async () => {
    const screen = await render(<ContentImage image={image} />);
    openViaButtonClick(screen.getByRole("button", { name: "View larger image" }));
    await vi.waitFor(() => expect(dialogEl().open).toBe(true));

    // Clicking the <dialog> element itself (the backdrop, not its inner content)
    // dismisses it — the onClick guard checks event.target === the dialog.
    dialogEl().dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await vi.waitFor(() => expect(dialogEl().open).toBe(false));
  });

  test("a failed <img> load swaps in the fallback note", async () => {
    const screen = await render(<ContentImage image={image} />);

    const thumb = screen.getByRole("img", { name: "A diagram of the flow" });
    thumb.element().dispatchEvent(new Event("error"));

    await expect.element(screen.getByText("Image could not be loaded")).toBeVisible();
    expect(screen.getByRole("img").query()).toBeNull();
    expect(screen.getByRole("button", { name: "View larger image" }).query()).toBeNull();
  });

  test("shows the Content Credentials text below the image when given", async () => {
    const screen = await render(
      <ContentImage image={{ ...image, credit: "Photo by Jane — CC BY 4.0" }} />,
    );

    // The credit renders below the thumbnail (and again inside the closed
    // lightbox), so assert the first, visible occurrence.
    await expect.element(screen.getByText("Photo by Jane — CC BY 4.0").first()).toBeVisible();
  });

  test("renders no credit element when none is given", async () => {
    const screen = await render(<ContentImage image={image} />);
    expect(screen.getByText("Photo by Jane — CC BY 4.0").query()).toBeNull();
  });
});
