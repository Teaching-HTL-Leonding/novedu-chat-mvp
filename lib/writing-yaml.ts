import { parse as parseYamlText } from "yaml";
import type { WritingPublic } from "./writing-types";

// LENIENT runtime parse of a writing YAML — the STUDENT path. Writing activities
// are stored in `novedu_files` under `kind: "writing"`. This is a small typed read
// that checks just the essentials needed to run the activity, with a friendly
// message when something required is missing, so a student never hits a hard crash.
// It is NOT the authoring gate: the strict schema/Zod validator that blocks a bad
// SAVE lives in `lib/writing-validate.ts` (`WritingYamlSchema`) and is deliberately
// separate and stricter than this read.
//
// SERVER-SIDE: parses YAML and exposes the server-only `instructions` (the
// teacher's system prompt) and `model`. The student render path must call
// `toPublicWriting` before sending anything to the browser, so those never cross
// the wire.

/** A fully parsed writing activity. `instructions` and `model` are server-side only. */
export interface Writing {
  id: string;
  name: string;
  title?: string;
  description?: string;
  /**
   * Privacy flag, read LIVE from the YAML. DEFAULT `false` (the writing
   * divergence): review and the Save feature need attribution, so writing opts
   * IN to attribution by default. A teacher who wants ephemeral writing sets
   * `anonymous: true`, which disables saving.
   */
  anonymous: boolean;
  /** The model id that drives the feedback chat. SERVER-ONLY. */
  model: string;
  /** The teacher-provided system prompt for the feedback chat. SERVER-ONLY. */
  instructions: string;
  /** Optional starter text prefilled into the editor. */
  placeholder?: string;
}

export type WritingParseResult = { ok: true; writing: Writing } | { ok: false; message: string };

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() !== "" ? value : undefined;
  // YAML types unquoted scalars by value, so `id: 1` arrives as a number and
  // `id: true` as a boolean. Coerce a finite number / boolean to its string form
  // rather than silently dropping the field. NaN/Infinity stay rejected.
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === "boolean") return String(value);
  return undefined;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Parses and lightly validates a writing YAML. Returns a friendly error message
 * (not structured errors) when an essential field is missing — the student page
 * shows it as a notice. `anonymous` DEFAULTS to `false` (the writing divergence).
 */
export function parseWriting(content: string): WritingParseResult {
  let doc: unknown;
  try {
    doc = parseYamlText(content);
  } catch {
    return {
      ok: false,
      message: "This writing activity could not be read — its YAML is not valid.",
    };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { ok: false, message: "This writing activity is empty or malformed." };
  }
  const root = doc as Record<string, unknown>;

  const model = asString((root.llm as Record<string, unknown> | undefined)?.model);
  if (!model) {
    return { ok: false, message: "This writing activity does not specify a model (llm.model)." };
  }

  const instructions = asString(root.instructions);
  if (!instructions) {
    return { ok: false, message: "This writing activity has no instructions for the assistant." };
  }

  return {
    ok: true,
    writing: {
      id: asString(root.id) ?? asString(root.name) ?? "writing",
      name: asString(root.name) ?? "writing",
      title: asString(root.title),
      description: asString(root.description),
      anonymous: asBool(root.anonymous, false),
      model,
      instructions,
      placeholder: asString(root.placeholder),
    },
  };
}

/**
 * The student-facing projection — strips every server-only field, above all the
 * teacher's `instructions` and the `model`, before anything reaches the browser.
 */
export function toPublicWriting(writing: Writing): WritingPublic {
  return {
    title: writing.title,
    description: writing.description,
    placeholder: writing.placeholder,
  };
}
