// Zod 4 schemas for the tutor-definition format and the remote fragment files.
//
// Every object uses `z.strictObject` so typos in the source YAML (e.g.
// `prioirty:` or `variabels:`) surface as schema errors instead of silently
// dropping data and causing confusing downstream consistency failures.

import { z } from "zod";

/** An http(s) URL. `z.url()` alone also accepts e.g. `ftp:`/`mailto:`, so narrow the scheme. */
const HttpUrl = z.url().refine((u) => /^https?:\/\//i.test(u), {
  message: "URL must use http(s)",
});

// --- input_schema (a constrained mini JSON-schema declared by a fragment) ---

/** A declared property is a string, a boolean, or an array of strings. */
const PropertySchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("string") }),
  z.strictObject({ type: z.literal("boolean") }),
  z.strictObject({
    type: z.literal("array"),
    items: z.strictObject({ type: z.literal("string") }),
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

// --- tutor definition (the thing the user supplies a URL to) ---

/** A supplied variable value mirrors what `input_schema` can declare. */
export const VariableValueSchema = z.union([z.string(), z.boolean(), z.array(z.string())]);
export type VariableValue = z.infer<typeof VariableValueSchema>;

const FragmentFileRefSchema = z.strictObject({
  id: z.string(),
  url: HttpUrl,
});

const FragmentRefSchema = z.strictObject({
  file: z.string(),
  id: z.string(),
  variables: z.record(z.string(), VariableValueSchema).optional(),
  // `bind` (runtime references) is accepted so real tutor files validate, but it
  // is intentionally ignored by the consistency/assembly stages (out of scope).
  bind: z.record(z.string(), z.string()).optional(),
  required: z.boolean().optional(),
});

export const TutorSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  llm: z.strictObject({ model: z.string() }),
  prompt: z.strictObject({
    fragment_files: z.array(FragmentFileRefSchema).min(1),
    fragments: z.array(FragmentRefSchema).min(1),
    tutor_instructions: z.string(),
  }),
});
export type Tutor = z.infer<typeof TutorSchema>;
export type FragmentFileRef = z.infer<typeof FragmentFileRefSchema>;
export type FragmentRef = z.infer<typeof FragmentRefSchema>;
