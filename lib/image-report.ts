// Turning what we learned about a picked photo into ONE plain-text block a
// student can copy and paste back to a teacher. Pure formatting over
// `ImageDiagnostics` (lib/image-normalize.ts) plus a probe of the browser
// itself — the half of an image bug that never survives a verbal description.
//
// CONTENT-FREE by construction, the same rule the telemetry seam follows
// (docs/telemetry.md): no pixels, no filename (only its extension and length —
// a real upload can be `Mathe_Hausaufgabe_Lisa.jpg`), and EXIF is reported as
// present/absent plus the one orientation value, never its contents. What is
// left is exactly the set of facts that distinguish "your phone's format",
// "too big", "sideways" and "the model simply could not read it".

import { MAX_IMAGE_BYTES } from "@/lib/answer-images";
import {
  type ImageDiagnostics,
  MAX_NORMALIZED_EDGE,
  MAX_RAW_IMAGE_BYTES,
  NORMALIZED_JPEG_QUALITY,
} from "@/lib/image-normalize";

/** What the browser can actually do — the reason the same file behaves differently on two devices. */
export interface ImageEnvironment {
  userAgent: string;
  /** From `navigator.userAgentData`; absent on Safari and Firefox, which is itself informative. */
  platform?: string;
  mobile?: boolean;
  screen?: string;
  /** Feature probes. A `false` here explains a failure no file inspection could. */
  hasImageDecode: boolean;
  hasCreateImageBitmap: boolean;
  hasCanvasToBlob: boolean;
}

interface UserAgentData {
  platform?: string;
  mobile?: boolean;
}

/** Probes the running browser. Safe to call anywhere — everything absent degrades to `undefined`. */
export function collectImageEnvironment(): ImageEnvironment {
  if (typeof navigator === "undefined") {
    return {
      userAgent: "(not a browser)",
      hasImageDecode: false,
      hasCreateImageBitmap: false,
      hasCanvasToBlob: false,
    };
  }
  const uaData = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  return {
    userAgent: navigator.userAgent,
    ...(uaData?.platform ? { platform: uaData.platform } : {}),
    ...(typeof uaData?.mobile === "boolean" ? { mobile: uaData.mobile } : {}),
    ...(typeof screen === "undefined"
      ? {}
      : { screen: `${screen.width}x${screen.height} @${devicePixelRatio}` }),
    hasImageDecode:
      typeof HTMLImageElement !== "undefined" && "decode" in HTMLImageElement.prototype,
    hasCreateImageBitmap: typeof createImageBitmap === "function",
    hasCanvasToBlob:
      typeof HTMLCanvasElement !== "undefined" && "toBlob" in HTMLCanvasElement.prototype,
  };
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * One line saying, in words a student can relay, what happened to this file and
 * what it means. This is the part a teacher reads first.
 */
export function verdictFor(d: ImageDiagnostics): string {
  if (d.failureReason === undefined) {
    const shrunk =
      d.passedThrough === true
        ? "sent unchanged (already within limits)"
        : `resized to ${d.outputWidth}x${d.outputHeight}, ${megabytes(d.outputBytes ?? 0)}`;
    const rotated =
      (d.exifOrientation ?? 1) !== 1 ? " — was rotated by an EXIF tag, now baked in upright" : "";
    return `ACCEPTED: ${shrunk}${rotated}`;
  }
  switch (d.failureReason) {
    case "heif-undecodable":
      return `REJECTED: the file is ${d.sniffedContainer.toUpperCase()}, which this browser cannot open (${d.decodeError ?? "decode failed"}).`;
    case "undecodable":
      return `REJECTED: could not be decoded as an image (${d.decodeError ?? "decode failed"}); sniffed container was "${d.sniffedContainer}".`;
    case "raw-too-large":
      return `REJECTED: ${megabytes(d.rawBytes)} exceeds the ${megabytes(MAX_RAW_IMAGE_BYTES)} pick limit.`;
    case "encode-failed":
      return "REJECTED: the browser failed to re-encode the image (canvas encoder returned nothing).";
    case "too-large":
      return `REJECTED: still over the ${megabytes(MAX_IMAGE_BYTES)} send limit after resizing.`;
  }
}

function fileSection(d: ImageDiagnostics, index: number): string[] {
  const typeNote =
    d.reportedType === ""
      ? "(empty — the platform gave no MIME type)"
      : d.reportedType.replace("image/", "") === d.sniffedContainer
        ? d.reportedType
        : `${d.reportedType}  << MISMATCH, bytes say "${d.sniffedContainer}"`;
  return [
    `file ${index + 1}`,
    `  extension:    ${d.extension || "(none)"}  (name length ${d.nameLength})`,
    `  reportedType: ${typeNote}`,
    `  sniffed:      ${d.sniffedContainer}`,
    `  rawBytes:     ${d.rawBytes} (${megabytes(d.rawBytes)})`,
    ...(d.lastModified === undefined
      ? []
      : [`  lastModified: ${new Date(d.lastModified).toISOString()}`]),
    `  exif:         ${d.hasExif ? "present" : "none"}${
      d.exifOrientation === undefined ? "" : `, orientation=${d.exifOrientation}`
    }`,
    `  decoded:      ${
      d.decodedWidth === undefined
        ? `FAILED (${d.decodeError ?? "unknown"})`
        : `${d.decodedWidth}x${d.decodedHeight}`
    }`,
    ...(d.outputBytes === undefined
      ? []
      : [
          `  output:       ${d.outputWidth}x${d.outputHeight} ${d.outputMimeType} ${d.outputBytes} bytes (${megabytes(d.outputBytes)})`,
        ]),
    ...(d.elapsedMs === undefined ? [] : [`  elapsed:      ${d.elapsedMs} ms`]),
    `  verdict:      ${verdictFor(d)}`,
  ];
}

export interface ImageReportInput {
  files: ImageDiagnostics[];
  environment: ImageEnvironment;
  /** Where the report was produced — `"tutor chat"`, `"quiz"`, `"image check"`. */
  origin: string;
  /** Build identity from `/api/version`, when the surface has it. */
  appVersion?: string;
  /** ISO timestamp; injected so the formatter itself stays pure. */
  timestamp: string;
}

/** The whole block, ready for the clipboard. */
export function formatImageReport(input: ImageReportInput): string {
  const env = input.environment;
  const lines = [
    "=== Novedu image check ===",
    `when:    ${input.timestamp}`,
    `where:   ${input.origin}`,
    ...(input.appVersion ? [`build:   ${input.appVersion}`] : []),
    `ua:      ${env.userAgent}`,
    ...(env.platform ? [`platform: ${env.platform}${env.mobile ? " (mobile)" : ""}`] : []),
    ...(env.screen ? [`screen:  ${env.screen}`] : []),
    `support: decode=${env.hasImageDecode} createImageBitmap=${env.hasCreateImageBitmap} toBlob=${env.hasCanvasToBlob}`,
    `limits:  maxEdge=${MAX_NORMALIZED_EDGE} quality=${NORMALIZED_JPEG_QUALITY} pick<=${megabytes(MAX_RAW_IMAGE_BYTES)} send<=${megabytes(MAX_IMAGE_BYTES)}`,
    "",
    ...input.files.flatMap((file, index) => [...fileSection(file, index), ""]),
  ];
  return lines.join("\n").trimEnd();
}
