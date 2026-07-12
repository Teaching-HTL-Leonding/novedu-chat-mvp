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
    version: z.number().meta({ description: "Fragment version number." }),
    priority: z.number().meta({ description: "Assembly order. Lower priorities appear earlier." }),
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
      .meta({ description: "Local alias for this library, referenced by each fragment's `file`." }),
    url: FragmentUrlRef,
  })
  .meta({
    id: "fragmentFileRef",
    description: "A reference to a fragment library by alias + URL.",
  });

export const FragmentRefSchema = z
  .strictObject({
    file: z
      .string()
      .meta({ description: "The alias of the fragment library this fragment is drawn from." }),
    id: z.string().meta({ description: "Fragment id inside the referenced library." }),
    variables: z
      .record(z.string(), VariableValueSchema)
      .optional()
      .meta({ description: "Literal values passed into the fragment template." }),
    // `bind` (runtime references) is accepted so real activity files validate, but it
    // is intentionally ignored by the consistency/assembly stages (out of scope).
    bind: z
      .record(z.string(), z.string())
      .optional()
      .meta({ description: "Accepted for compatibility but ignored by the current assembler." }),
    required: z.boolean().optional().meta({
      description: "Marker for important fragments. Accepted but not currently enforced.",
    }),
  })
  .meta({ id: "fragmentRef", description: "Selects one fragment from a referenced library." });

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
