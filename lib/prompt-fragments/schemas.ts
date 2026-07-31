// Zod 4 schemas for the reusable prompt-fragment format: the remote fragment
// FILES (libraries of reusable, parameterized templates) and the document-level
// declaration an activity makes to pull them in (`fragment_files:` only).
//
// These are activity-agnostic: tutor / quiz / writing / coding all compose the
// same `FragmentFileRefSchema` into their own top-level schema, and the loader
// (`load.ts`) + placement/assembly stages consume the same `FragmentFile` /
// `Fragment` shapes. WHICH fragments an activity uses, and with which variables,
// is expressed by inline `{{fragment "alias.id" …}}` markers in the host text — NOT
// a document-level `fragments:` list (deleted). Every object uses `z.strictObject`
// so typos in the source YAML (e.g. `variabels:`) surface as schema errors instead
// of silently dropping data and causing confusing downstream failures.
//
// Teacher-facing prose lives in inline `.meta({ description })`; the generator
// (`lib/schema-gen`) emits it into the JSON Schemas teachers point their editors
// at. Reused sub-schemas carry `.meta({ id })` so the generator emits them as
// named `$defs` rather than inlining. Engineer "why" stays in these comments.

import { z } from "zod";

/**
 * A fragment-file reference: either an absolute http(s) URL or a relative path that
 * `load.ts` resolves against the activity YAML's own URL. We reject any *other* absolute
 * scheme (`ftp:`, `mailto:`, …) so a typo can't smuggle in a non-http(s) target — the
 * refine reads as "if it carries a URI scheme at all, that scheme must be http(s)".
 * Strings without a scheme (relative paths) pass through and are resolved at load time.
 *
 * The `.refine()` is the RUNTIME enforcement. `z.toJSONSchema()` cannot derive a pattern
 * from a refinement, so the equivalent editor constraint is re-expressed via `.meta({ pattern })`
 * — the two MUST be kept consistent (both mean "http(s) URL or a scheme-less relative path").
 */
const FragmentUrlRef = z
  .string()
  .min(1)
  .refine((u) => !/^[a-z][a-z0-9+.-]*:/i.test(u) || /^https?:\/\//i.test(u), {
    message: "Must be an http(s) URL or a relative path",
  })
  .meta({
    pattern: "^(https?://|(?![A-Za-z][A-Za-z0-9+.-]*:).+)$",
    description: "HTTP(S) URL or relative path to the fragment library.",
  });

// --- input_schema (a constrained mini JSON-schema declared by a fragment) ---

/**
 * A declared property is a string, a boolean, or an array of strings. Each may carry an
 * optional `default`, typed to match its `type` (a string default on a boolean property
 * is a schema error). When the activity omits the variable, the default is used; supplying
 * a value overrides it. See `consistency.ts` for where defaults are injected.
 */
const StringPropertySchema = z
  .strictObject({
    type: z.literal("string").meta({ description: "Declares a string variable." }),
    default: z
      .string()
      .optional()
      .meta({ description: "Default string used when the activity omits this variable." }),
  })
  .meta({ id: "stringProperty", description: "A string variable, with an optional default." });

const BooleanPropertySchema = z
  .strictObject({
    type: z.literal("boolean").meta({ description: "Declares a boolean variable." }),
    default: z
      .boolean()
      .optional()
      .meta({ description: "Default boolean used when the activity omits this variable." }),
  })
  .meta({ id: "booleanProperty", description: "A boolean variable, with an optional default." });

const StringArrayPropertySchema = z
  .strictObject({
    type: z.literal("array").meta({ description: "Declares an array-of-strings variable." }),
    items: z
      .strictObject({
        type: z.literal("string").meta({ description: "Array elements are strings." }),
      })
      .meta({ description: "The element type of the array (always string)." }),
    default: z
      .array(z.string())
      .optional()
      .meta({ description: "Default string array used when the activity omits this variable." }),
  })
  .meta({
    id: "stringArrayProperty",
    description: "An array-of-strings variable, with an optional default.",
  });

const PropertySchema = z
  .discriminatedUnion("type", [
    StringPropertySchema,
    BooleanPropertySchema,
    StringArrayPropertySchema,
  ])
  .meta({
    id: "inputProperty",
    description:
      "A declared variable: a string, a boolean, or an array of strings, each with an optional matching default.",
  });

export const InputSchema = z
  .strictObject({
    type: z.literal("object").meta({ description: 'Always "object".' }),
    required: z
      .array(z.string())
      .default([])
      .meta({ description: "Names of the variables that must be supplied." }),
    properties: z
      .record(z.string(), PropertySchema)
      .default({})
      .meta({ description: "The declared variables, keyed by variable name." }),
  })
  .meta({
    id: "inputSchema",
    description: "A constrained mini JSON-schema declaring the variables a fragment accepts.",
  });
export type InputSchema = z.infer<typeof InputSchema>;

// --- fragment files (remote libraries of reusable prompt fragments) ---

const ClassificationSchema = z
  .strictObject({
    type: z.string().meta({ description: "Classification label for this fragment." }),
    override_allowed: z
      .boolean()
      .optional()
      .meta({ description: "Whether an activity may override this classification." }),
  })
  .meta({ id: "classification", description: "Optional classification metadata for a fragment." });

export const FragmentSchema = z
  .strictObject({
    id: z.string().meta({ description: "Unique fragment id within this library." }),
    // `version` is accepted but consumed by nothing (no versioning semantics exist).
    // Optional now — a library author may drop it entirely.
    version: z.number().optional().meta({ description: "Optional fragment version number." }),
    input_schema: InputSchema.optional(),
    classification: ClassificationSchema.optional(),
    content: z.string().meta({ description: "Prompt text as a Handlebars template." }),
  })
  .meta({ id: "fragment", description: "One reusable, parameterized prompt fragment." });
export type Fragment = z.infer<typeof FragmentSchema>;

export const FragmentFileSchema = z.strictObject({
  id: z.string().meta({ description: "Machine-readable id of this fragment library." }),
  fragments: z
    .array(FragmentSchema)
    .min(1)
    .meta({ description: "The reusable fragments this library provides (at least one)." }),
});
// NB: no root-level `.meta({ description })` here — the top-level title/description of
// the generated JSON Schema come from the `lib/schema-gen` registry (authoritative).
export type FragmentFile = z.infer<typeof FragmentFileSchema>;

// --- document-level references (what an activity declares to pull fragments in) ---

/** A supplied variable value mirrors what `input_schema` can declare. */
export const VariableValueSchema = z.union([z.string(), z.boolean(), z.array(z.string())]).meta({
  id: "variableValue",
  description: "A literal variable value: a string, a boolean, or an array of strings.",
});
export type VariableValue = z.infer<typeof VariableValueSchema>;

export const FragmentFileRefSchema = z
  .strictObject({
    id: z
      .string()
      // The alias is the part BEFORE the first dot in an inline `{{fragment "alias.id"}}`
      // marker, so it must not itself contain a dot (fragment ids may). The `.regex`
      // is both the runtime guard and the pattern `z.toJSONSchema` emits for editors.
      .regex(/^[^.]+$/, { message: "Alias must not contain a dot" })
      .meta({
        pattern: "^[^.]+$",
        description:
          'Local alias for this library, used before the dot in `{{fragment "alias.id"}}`. Must not contain a dot.',
      }),
    url: FragmentUrlRef,
  })
  .meta({
    id: "fragmentFileRef",
    description: "A reference to a fragment library by alias + URL.",
  });

export type FragmentFileRef = z.infer<typeof FragmentFileRefSchema>;

/**
 * A plain-text file reference: an `id` alias + a `url`, mirroring `FragmentFileRefSchema`
 * exactly (same no-dot alias regex, same http(s)-or-relative `FragmentUrlRef`). Unlike a
 * fragment library, a text file is arbitrary content (markdown course material, a
 * sample-solution source file) fetched over HTTP(S) and spliced VERBATIM into the host
 * text by an inline `{{file "alias"}}` marker — there is nothing to select inside it, so
 * the alias carries no dot. Text-file and fragment-file aliases share ONE namespace (an
 * `id` may not collide across the two lists), so every marker alias resolves unambiguously.
 */
export const TextFileRefSchema = z
  .strictObject({
    id: z
      .string()
      // The bare alias used in an inline `{{file "alias"}}` marker. Like a fragment
      // alias it must not contain a dot; the `.regex` is both the runtime guard and the
      // pattern `z.toJSONSchema` emits for editors.
      .regex(/^[^.]+$/, { message: "Alias must not contain a dot" })
      .meta({
        pattern: "^[^.]+$",
        description:
          'Local alias for this text file, used in `{{file "alias"}}`. Must not contain a dot.',
      }),
    // Same URL contract as a fragment ref, but with its own editor description — the
    // shared `FragmentUrlRef` meta says "fragment library", which would mislead here.
    url: FragmentUrlRef.meta({
      pattern: "^(https?://|(?![A-Za-z][A-Za-z0-9+.-]*:).+)$",
      description: "HTTP(S) URL or relative path to the plain-text file.",
    }),
  })
  .meta({
    id: "textFileRef",
    description: "A reference to a plain-text file (markdown / source) by alias + URL.",
  });

export type TextFileRef = z.infer<typeof TextFileRefSchema>;

/**
 * The document-level fragment block an activity declares: the fragment LIBRARIES it may
 * pull from (`fragment_files:`) and the plain-text FILES it may embed (`text_files:`).
 * WHICH fragments/files it actually uses, where, and with which variables lives in the
 * activity's host text as inline `{{fragment "alias.id" …}}` / `{{file "alias"}}`
 * markers — not here. The host text itself (tutor_instructions / instructions) is NOT
 * part of this block; it is passed alongside it to the loader's orchestrator as the
 * template to render.
 */
export interface FragmentBlock {
  fragment_files: FragmentFileRef[];
  text_files: TextFileRef[];
}
