// @vitest-environment node

import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, validateAnswerImages } from "@/lib/answer-images";

// The SERVER-SIDE image checks both quiz actions run — pure string validation
// (count, data-URL shape, decoded size, the question's effective imageInput
// gate). `readAnswerImage` is browser-only (FileReader) and is exercised by the
// quiz-runner component test instead.

/** A well-formed image data URL whose decoded payload is `bytes` long. */
function dataUrlOfBytes(bytes: number): string {
  return `data:image/png;base64,${Buffer.alloc(bytes).toString("base64")}`;
}

const SMALL = dataUrlOfBytes(16);

describe("validateAnswerImages", () => {
  it("accepts no images regardless of the flag", () => {
    expect(validateAnswerImages(undefined, false)).toEqual({ ok: true, images: [] });
    expect(validateAnswerImages([], false)).toEqual({ ok: true, images: [] });
  });

  it("accepts up to 3 well-formed images when allowed", () => {
    const images = [SMALL, dataUrlOfBytes(32), dataUrlOfBytes(64)];
    expect(validateAnswerImages(images, true)).toEqual({ ok: true, images });
  });

  it("rejects images outright when the question does not accept them", () => {
    const result = validateAnswerImages([SMALL], false);
    expect(result).toEqual({ ok: false, message: "Images are not accepted for this question." });
  });

  it("rejects more than 3 images", () => {
    const result = validateAnswerImages([SMALL, SMALL, SMALL, SMALL], true);
    expect(result).toEqual({ ok: false, message: "At most 3 photos per answer." });
  });

  it("rejects an image over 5 MB by its decoded base64 size", () => {
    const exactlyMax = dataUrlOfBytes(MAX_IMAGE_BYTES);
    expect(validateAnswerImages([exactlyMax], true).ok).toBe(true);
    const oneOver = dataUrlOfBytes(MAX_IMAGE_BYTES + 1);
    expect(validateAnswerImages([oneOver], true)).toEqual({
      ok: false,
      message: "Each photo must be 5 MB or smaller.",
    });
  });

  it.each([
    ["a non-image mime", "data:application/pdf;base64,AAAA"],
    ["a plain URL", "https://example.com/pic.png"],
    ["a non-base64 data URL", "data:image/png,rawpixels"],
    ["arbitrary text", "not an image at all"],
  ])("rejects %s", (_label, value) => {
    const result = validateAnswerImages([value], true);
    expect(result).toEqual({ ok: false, message: "The submitted photos could not be read." });
  });

  it("rejects a non-string entry without throwing", () => {
    const result = validateAnswerImages([SMALL, 42 as unknown as string], true);
    expect(result).toEqual({ ok: false, message: "The submitted photos could not be read." });
  });
});
