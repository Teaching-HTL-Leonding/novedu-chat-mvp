// Zod 4 schemas for the reusable prompt-fragment format: the remote fragment
// FILES (libraries of reusable, parameterized templates) and the document-level
// references an activity makes to them (`fragment_files:` + `fragments:`).
//
// These are activity-agnostic: tutor / quiz / writing / coding all compose the
// same `FragmentFileRefSchema` / `FragmentRefSchema` into their own top-level
// schema, and the loader (`load.ts`) + consistency/assembly stages consume the
// same `FragmentFile` / `Fragment` shapes. Every object uses `z.strictObject` so
// typos in the source YAML (e.g. `prioirty:` or `variabels:`) surface as schema
// errors instead of silently dropping data and causing confusing downstream
// consistency failures.

import { z } from "zod";

/**
 * A fragment-file reference: either an absolute http(s) URL or a relative path that
 * `load.ts` resolves against the activity YAML's own URL. We reject any *other* absolute
 * scheme (`ftp:`, `mailto:`, …) so a typo can't smuggle in a non-http(s) target — the
 * refine reads as "if it carries a URI scheme at all, that scheme must be http(s)".
 * Strings without a scheme (relative paths) pass through and are resolved at load time.
 */
const FragmentUrlRef = z
  .string()
  .min(1)
  .refine((u) => !/^[a-z][a-z0-9+.-]*:/i.test(u) || /^https?:\/\//i.test(u), {
    message: "Must be an http(s) URL or a relative path",
  });

// --- input_schema (a constrained mini JSON-schema declared by a fragment) ---

/**
 * A declared property is a string, a boolean, or an array of strings. Each may carry an
 * optional `default`, typed to match its `type` (a string default on a boolean property
 * is a schema error). When the activity omits the variable, the default is used; supplying
 * a value overrides it. See `consistency.ts` for where defaults are injected.
 */
const PropertySchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("string"), default: z.string().optional() }),
  z.strictObject({ type: z.literal("boolean"), default: z.boolean().optional() }),
  z.strictObject({
    type: z.literal("array"),
    items: z.strictObject({ type: z.literal("string") }),
    default: z.array(z.string()).optional(),
  }),
]);

export const InputSchema = z.strictObject({
  type: z.literal("object"),
  required: z.array(z.string()).default([]),
  properties: z.record(z.string(), PropertySchema).default({}),
});
export type InputSchema = z.infer<typeof InputSchema>;

// --- fragment files (remote libraries of reusable prompt fragments) ---

const ClassificationSchema = z.strictObject({
  type: z.string(),
  override_allowed: z.boolean().optional(),
});

export const FragmentSchema = z.strictObject({
  id: z.string(),
  version: z.number(),
  priority: z.number(),
  input_schema: InputSchema.optional(),
  classification: ClassificationSchema.optional(),
  content: z.string(),
});
export type Fragment = z.infer<typeof FragmentSchema>;

export const FragmentFileSchema = z.strictObject({
  id: z.string(),
  fragments: z.array(FragmentSchema).min(1),
});
export type FragmentFile = z.infer<typeof FragmentFileSchema>;

// --- document-level references (what an activity declares to pull fragments in) ---

/** A supplied variable value mirrors what `input_schema` can declare. */
export const VariableValueSchema = z.union([z.string(), z.boolean(), z.array(z.string())]);
export type VariableValue = z.infer<typeof VariableValueSchema>;

export const FragmentFileRefSchema = z.strictObject({
  id: z.string(),
  url: FragmentUrlRef,
});

export const FragmentRefSchema = z.strictObject({
  file: z.string(),
  id: z.string(),
  variables: z.record(z.string(), VariableValueSchema).optional(),
  // `bind` (runtime references) is accepted so real activity files validate, but it
  // is intentionally ignored by the consistency/assembly stages (out of scope).
  bind: z.record(z.string(), z.string()).optional(),
  required: z.boolean().optional(),
});

export type FragmentFileRef = z.infer<typeof FragmentFileRefSchema>;
export type FragmentRef = z.infer<typeof FragmentRefSchema>;

/**
 * The document-level fragment block an activity declares: the shared shape tutor /
 * quiz / writing / coding all embed and hand to the loader's orchestrator. The
 * activity's own trailing text (tutor_instructions / instructions / a grading frame)
 * is NOT part of this block — it is appended after the assembled fragments.
 */
export interface FragmentBlock {
  fragment_files: FragmentFileRef[];
  fragments: FragmentRef[];
}
