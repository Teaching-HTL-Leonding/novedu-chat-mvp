import { describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

// The /images list "View" action: an icon button (no inline preview) that opens the
// shared <ImageLightbox> full-window. Opening shows a native <dialog> with the
// full image (alt = the image name) and a Close button; it closes via the button
// and Escape. The credit, when present, renders below the image; a failed <img>
// load swaps in the muted fallback note. Pure-prop rendering — no infra, no @live.

import { ViewImageButton } from "./view-image-button";

// A valid 1x1 transparent PNG so the lightbox <img> actually LOADS rather than
// firing onError and collapsing to the fallback note.
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M8AAAAGAAUjAVFrXQAAAABJRU5ErkJggg==";

function dialogEl(): HTMLDialogElement {
  const dialog = document.querySelector("dialog");
  if (!dialog) throw new Error("dialog not rendered");
  return dialog as HTMLDialogElement;
}

describe("ViewImageButton", () => {
  test("renders a View button and no inline image until opened", async () => {
    const screen = await render(
      <ViewImageButton name="australia-map" url={PNG_1X1} credit={null} />,
    );

    await expect
      .element(screen.getByRole("button", { name: "View image australia-map" }))
      .toBeVisible();
    // The closed <dialog> keeps its image out of the accessibility tree, so no img
    // is exposed while the lightbox is shut.
    expect(screen.getByRole("img").query()).toBeNull();
    expect(dialogEl().open).toBe(false);
  });

  test("clicking View opens the lightbox with the full image", async () => {
    const screen = await render(
      <ViewImageButton name="australia-map" url={PNG_1X1} credit={null} />,
    );

    await screen.getByRole("button", { name: "View image australia-map" }).click();

    await vi.waitFor(() => expect(dialogEl().open).toBe(true));
    await expect.element(screen.getByRole("img", { name: "australia-map" })).toBeVisible();
  });

  test("the Close button closes the lightbox", async () => {
    const screen = await render(
      <ViewImageButton name="australia-map" url={PNG_1X1} credit={null} />,
    );
    await screen.getByRole("button", { name: "View image australia-map" }).click();
    await vi.waitFor(() => expect(dialogEl().open).toBe(true));

    await screen.getByRole("button", { name: "Close" }).click();

    await vi.waitFor(() => expect(dialogEl().open).toBe(false));
  });

  test("Escape closes the open lightbox", async () => {
    const screen = await render(
      <ViewImageButton name="australia-map" url={PNG_1X1} credit={null} />,
    );
    await screen.getByRole("button", { name: "View image australia-map" }).click();
    await vi.waitFor(() => expect(dialogEl().open).toBe(true));

    await userEvent.keyboard("{Escape}");

    await vi.waitFor(() => expect(dialogEl().open).toBe(false));
  });

  test("shows the credit below the image when given", async () => {
    const screen = await render(
      <ViewImageButton name="australia-map" url={PNG_1X1} credit="© NDLA — CC BY-SA 4.0" />,
    );
    await screen.getByRole("button", { name: "View image australia-map" }).click();
    await vi.waitFor(() => expect(dialogEl().open).toBe(true));

    await expect.element(screen.getByText("© NDLA — CC BY-SA 4.0")).toBeVisible();
  });

  test("a failed <img> load swaps in the fallback note", async () => {
    const screen = await render(
      <ViewImageButton name="australia-map" url={PNG_1X1} credit={null} />,
    );
    await screen.getByRole("button", { name: "View image australia-map" }).click();
    await vi.waitFor(() => expect(dialogEl().open).toBe(true));

    screen.getByRole("img", { name: "australia-map" }).element().dispatchEvent(new Event("error"));

    await expect.element(screen.getByText("Image could not be loaded")).toBeVisible();
  });
});
