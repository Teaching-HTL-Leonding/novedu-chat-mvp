import { describe, expect, it } from "vitest";
import { readExifSummary, sniffImageContainer } from "@/lib/image-normalize";

// The PURE half of the normalizer: what a file really is, and whether it carries
// an orientation tag. Both answers are load-bearing — the container is what lets
// an error message name the student's actual problem ("your phone saved this as
// HEIC") when no decoder got far enough to say so, and the orientation decides
// whether a file may skip the canvas. The decode/resize/re-encode half needs a
// real browser and lives in image-normalize.browser.test.tsx.

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function withAscii(prefix: number[], text: string, padTo = 0): Uint8Array {
  const out = [...prefix, ...[...text].map((c) => c.charCodeAt(0))];
  while (out.length < padTo) out.push(0);
  return new Uint8Array(out);
}

describe("sniffImageContainer", () => {
  it("identifies the raster containers a phone or laptop can produce", () => {
    expect(sniffImageContainer(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffImageContainer(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(sniffImageContainer(withAscii([], "GIF89a"))).toBe("gif");
    expect(sniffImageContainer(withAscii([], "RIFF0000WEBPVP8 "))).toBe("webp");
    expect(sniffImageContainer(bytes(0x42, 0x4d, 0x00, 0x00))).toBe("bmp");
    expect(sniffImageContainer(bytes(0x49, 0x49, 0x2a, 0x00))).toBe("tiff");
    expect(sniffImageContainer(bytes(0x4d, 0x4d, 0x00, 0x2a))).toBe("tiff");
  });

  // The whole reason this function exists: an iPhone/Files-app pick can hand over
  // HEIC, which no non-Apple browser decodes, and a decoder failure alone cannot
  // tell the student which setting to change.
  it("identifies the ISO-BMFF brands by the brand at offset 8", () => {
    for (const brand of ["heic", "heix", "hevc", "mif1", "msf1"]) {
      expect(sniffImageContainer(withAscii([0, 0, 0, 0x18], `ftyp${brand}`))).toBe("heif");
    }
    expect(sniffImageContainer(withAscii([0, 0, 0, 0x18], "ftypavif"))).toBe("avif");
    // An unrelated ISO-BMFF file (a Live Photo's movie half) is not an image.
    expect(sniffImageContainer(withAscii([0, 0, 0, 0x18], "ftypqt  "))).toBe("unknown");
  });

  it("recognizes SVG text with or without a leading XML declaration", () => {
    expect(sniffImageContainer(withAscii([], '<svg xmlns="http://www.w3.org/2000/svg">'))).toBe(
      "svg",
    );
    expect(sniffImageContainer(withAscii([], '<?xml version="1.0"?><svg width="1">'))).toBe("svg");
  });

  it("reports unknown rather than guessing", () => {
    expect(sniffImageContainer(withAscii([], "not an image at all"))).toBe("unknown");
    expect(sniffImageContainer(new Uint8Array(0))).toBe("unknown");
  });
});

/**
 * A JPEG head carrying one APP1/Exif segment whose IFD0 holds a single
 * `Orientation` entry. Built by hand so the test owns every byte — the parser is
 * walking a real segment chain, not a fixture nobody can read.
 */
function jpegWithOrientation(orientation: number, littleEndian = true): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  const tiff: number[] = [];
  const u16 = (value: number) =>
    littleEndian ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff];
  const u32 = (value: number) =>
    littleEndian
      ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff]
      : [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  tiff.push(...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]));
  tiff.push(...u16(42), ...u32(8));
  tiff.push(...u16(1)); // one IFD entry
  tiff.push(...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0);
  tiff.push(...u32(0)); // no next IFD
  const payload = [...[..."Exif\0\0"].map((c) => c.charCodeAt(0)), ...tiff];
  out.push(0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload);
  out.push(0xff, 0xda); // start of scan — nothing past here is EXIF
  return new Uint8Array(out);
}

describe("readExifSummary", () => {
  it("reads the orientation tag in both byte orders", () => {
    expect(readExifSummary(jpegWithOrientation(6))).toEqual({ hasExif: true, orientation: 6 });
    expect(readExifSummary(jpegWithOrientation(8, false))).toEqual({
      hasExif: true,
      orientation: 8,
    });
    expect(readExifSummary(jpegWithOrientation(1))).toEqual({ hasExif: true, orientation: 1 });
  });

  it("reports EXIF presence even when no orientation tag is there", () => {
    const withExifButNoOrientation = jpegWithOrientation(6);
    // Blank the tag id so the entry no longer matches, leaving the segment intact.
    withExifButNoOrientation[22] = 0x00;
    withExifButNoOrientation[23] = 0x00;
    expect(readExifSummary(withExifButNoOrientation)).toEqual({ hasExif: true });
  });

  it("returns no EXIF for a JPEG without an APP1 segment, and for non-JPEG bytes", () => {
    expect(readExifSummary(bytes(0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02))).toEqual({ hasExif: false });
    expect(readExifSummary(bytes(0x89, 0x50, 0x4e, 0x47))).toEqual({ hasExif: false });
    expect(readExifSummary(new Uint8Array(0))).toEqual({ hasExif: false });
  });

  it("rejects an out-of-range orientation instead of passing it on", () => {
    expect(readExifSummary(jpegWithOrientation(99))).toEqual({ hasExif: true });
  });

  it("does not run off the end of a truncated segment", () => {
    const truncated = jpegWithOrientation(6).slice(0, 14);
    expect(() => readExifSummary(truncated)).not.toThrow();
    expect(readExifSummary(truncated).hasExif).toBe(true);
  });
});
