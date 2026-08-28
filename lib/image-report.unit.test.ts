import { describe, expect, it } from "vitest";
import type { ImageDiagnostics } from "@/lib/image-normalize";
import { formatImageReport, type ImageEnvironment, verdictFor } from "@/lib/image-report";

// The copyable block a student sends a teacher. Two things are being protected
// here: that it says something USEFUL (the verdict names the actual problem),
// and that it stays CONTENT-FREE — no filename, no pixels — because it is meant
// to be pasted into a chat message or a bug thread.

const ENVIRONMENT: ImageEnvironment = {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Safari/605.1.15",
  hasImageDecode: true,
  hasCreateImageBitmap: true,
  hasCanvasToBlob: true,
};

function diagnostics(overrides: Partial<ImageDiagnostics> = {}): ImageDiagnostics {
  return {
    extension: ".jpg",
    nameLength: 12,
    reportedType: "image/jpeg",
    sniffedContainer: "jpeg",
    rawBytes: 2_908_241,
    hasExif: false,
    decodedWidth: 5712,
    decodedHeight: 4284,
    passedThrough: false,
    outputWidth: 2000,
    outputHeight: 1500,
    outputBytes: 284_672,
    outputMimeType: "image/jpeg",
    elapsedMs: 377,
    ...overrides,
  };
}

describe("verdictFor", () => {
  it("says what happened to an accepted photo", () => {
    expect(verdictFor(diagnostics())).toContain("ACCEPTED");
    expect(verdictFor(diagnostics())).toContain("2000x1500");
  });

  it("calls out a photo that was only upright because of an EXIF tag", () => {
    // The half of #26 that is invisible to everyone: browsers apply the tag, the
    // server-side decoder does not, so "it looked fine on my phone" is expected.
    expect(verdictFor(diagnostics({ exifOrientation: 6, hasExif: true }))).toContain("rotated");
  });

  it("distinguishes a pass-through from a re-encode", () => {
    const passed = verdictFor(
      diagnostics({ passedThrough: true, decodedWidth: 300, decodedHeight: 200 }),
    );
    expect(passed).toContain("unchanged");
  });

  it("names the container when the browser could not decode it", () => {
    const verdict = verdictFor(
      diagnostics({
        sniffedContainer: "heif",
        decodeError: "EncodingError",
        failureReason: "heif-undecodable",
        decodedWidth: undefined,
        decodedHeight: undefined,
      }),
    );
    expect(verdict).toContain("REJECTED");
    expect(verdict).toContain("HEIF");
  });

  it("has a verdict for every failure reason", () => {
    for (const reason of ["raw-too-large", "encode-failed", "too-large", "undecodable"] as const) {
      expect(verdictFor(diagnostics({ failureReason: reason }))).toContain("REJECTED");
    }
  });
});

describe("formatImageReport", () => {
  const report = formatImageReport({
    files: [diagnostics()],
    environment: ENVIRONMENT,
    origin: "tutor chat",
    appVersion: "0.1.0.142 (abcdef12)",
    timestamp: "2026-06-16T06:48:31.000Z",
  });

  it("carries the facts that distinguish one image failure from another", () => {
    expect(report).toContain("tutor chat");
    expect(report).toContain("0.1.0.142");
    expect(report).toContain("iPhone");
    expect(report).toContain("5712x4284");
    expect(report).toContain(".jpg");
    expect(report).toContain("decode=true");
    // The limits travel with the report: the same file behaves differently
    // against a different build's caps.
    expect(report).toContain("maxEdge=2000");
  });

  // The report is meant to be pasted somewhere public-ish, so it must never
  // become a channel for the student's own data (docs/telemetry.md's rule,
  // applied to a user-visible artefact).
  it("never carries the filename, only its extension and length", () => {
    const named = formatImageReport({
      files: [diagnostics()],
      environment: ENVIRONMENT,
      origin: "quiz photo answer",
      timestamp: "2026-06-16T06:48:31.000Z",
    });
    expect(named).not.toContain("Hausaufgabe");
    expect(named).toContain("name length 12");
  });

  it("flags a MIME type that disagrees with the bytes", () => {
    const mismatched = formatImageReport({
      files: [diagnostics({ reportedType: "image/png", sniffedContainer: "jpeg" })],
      environment: ENVIRONMENT,
      origin: "image check page",
      timestamp: "2026-06-16T06:48:31.000Z",
    });
    expect(mismatched).toContain("MISMATCH");
  });

  it("reports an empty MIME type as a finding rather than a blank", () => {
    const empty = formatImageReport({
      files: [diagnostics({ reportedType: "" })],
      environment: ENVIRONMENT,
      origin: "image check page",
      timestamp: "2026-06-16T06:48:31.000Z",
    });
    expect(empty).toContain("empty");
  });

  it("numbers each file when several were checked at once", () => {
    const many = formatImageReport({
      files: [diagnostics(), diagnostics({ extension: ".png" })],
      environment: ENVIRONMENT,
      origin: "image check page",
      timestamp: "2026-06-16T06:48:31.000Z",
    });
    expect(many).toContain("file 1");
    expect(many).toContain("file 2");
  });
});
