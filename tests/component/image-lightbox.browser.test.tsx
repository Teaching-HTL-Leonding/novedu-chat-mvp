import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { ImageLightbox } from "@/components/image-lightbox";
// The component project loads no global CSS — without the real utilities the
// UA's own `dialog { height: fit-content }` would answer every measurement
// below and the tests would pass vacuously (see docs/testing.md).
import "@/app/globals.css";

// The shared image lightbox (mounted by <ContentImage> and the /images list's
// View button) is the ONE DialogShell consumer whose `className` carries
// height-adjacent overrides on top of the `size` variant — and `cn()` is
// tailwind-merge, so caller classes BEAT the variant on conflict. That merge
// path is exactly how the shipped `h-auto` bug got in (a 1122px dialog around
// 429px of content), and the central dialog-shell tests cannot see a
// per-consumer override. Its only other coverage is `@live-storage` e2e, which
// CI never runs. So this file measures the lightbox's own geometry contract —
// hug + center, the widened 88vh cap, the credit staying visible under
// `min-h-0` — plus the load-failure fallback. Everything unique to the
// lightbox; the shell's open/close contract stays tested once, on the shell.

/** An SVG data URI with an exact intrinsic size — no network, no decode jank. */
function svgDataUri(width: number, height: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#8af"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function renderOpenLightbox(image: { url: string; alt?: string; credit?: string }) {
  const screen = await render(<ImageLightbox image={image} open={true} onClose={() => {}} />);
  const dialog = screen.container.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.open).toBe(true);
  const img = screen.container.querySelector("img");
  if (img) await img.decode();
  return { screen, dialog, img };
}

// 2px of slack absorbs borders and sub-pixel rounding.
const TOLERANCE = 2;

test("hugs a small image and centers in both axes", async () => {
  const { dialog } = await renderOpenLightbox({ url: svgDataUri(300, 200), alt: "small" });

  const rect = dialog.getBoundingClientRect();
  // `w-fit` overrides the shell's 48rem default and wraps the 300px image
  // (plus hairline borders). This assertion caught a REAL shipped bug when
  // first written: the lightbox passed `w-auto`, and because the UA zeroes a
  // dialog's inline insets too, the box stretched to the full 92vw cap
  // (1177px around a 300px image) — the inline-axis twin of the `h-auto` bug.
  expect(rect.width).toBeLessThan(400);
  expect(rect.width).toBeGreaterThanOrEqual(300);
  // …and `size="fit"` keeps the height to the content, not a screenful. This
  // is the assertion the shipped bug would have failed: an indefinite height
  // stretches an open modal to the viewport (block insets 0) and un-centers it.
  expect(rect.height).toBeLessThan(window.innerHeight / 2);
  expect(Math.abs(rect.top - (window.innerHeight - rect.bottom))).toBeLessThan(TOLERANCE);
  expect(Math.abs(rect.left - (window.innerWidth - rect.right))).toBeLessThan(TOLERANCE);
});

test("a tall image is capped at the widened 88vh, with the credit still visible below it", async () => {
  const credit = "Photo: Example Author";
  const { dialog, screen } = await renderOpenLightbox({
    url: svgDataUri(200, 4000),
    alt: "tall",
    credit,
  });

  const rect = dialog.getBoundingClientRect();
  // The lightbox's own `max-h-[88vh]` must WIN over the variant's 85vh cap
  // through the cn/tailwind-merge path — images want every pixel. Below 86vh
  // would mean the override was lost; above 88vh that the cap is gone.
  expect(rect.height).toBeLessThanOrEqual(window.innerHeight * 0.88 + TOLERANCE);
  expect(rect.height).toBeGreaterThan(window.innerHeight * 0.86);

  // `min-h-0` on the <img> lets it shrink inside the flex column; without it
  // the 4000px intrinsic height pushes the credit line past the clipped
  // bottom edge. The credit must sit fully inside the dialog box.
  const creditEl = screen.getByText(credit).element() as HTMLElement;
  const creditRect = creditEl.getBoundingClientRect();
  expect(creditRect.height).toBeGreaterThan(0);
  expect(creditRect.bottom).toBeLessThanOrEqual(rect.bottom + TOLERANCE);
});

test("a failed image load shows the fallback note instead of a broken image", async () => {
  const screen = await render(
    <ImageLightbox
      image={{ url: "data:image/png;base64,AAAA", alt: "broken" }}
      open={true}
      onClose={() => {}}
    />,
  );

  await expect.element(screen.getByText("Image could not be loaded")).toBeVisible();
  expect(screen.container.querySelector("img")).toBeNull();
});
