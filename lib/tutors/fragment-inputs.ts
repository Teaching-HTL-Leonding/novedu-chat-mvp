import type { FragmentFile, InputSchema } from "./schemas";

// Pure helper (no I/O, no Handlebars) used by the student GUI via
// `@/lib/yaml-files`. Kept in its own module so it is client-safe and trivially
// testable without pulling in the database or the template engine.

/**
 * Returns the `input_schema` of one fragment inside a parsed fragment file, or
 * `undefined` if no fragment has that id (or it declares no schema).
 *
 * This is the key to building a tutor GUI: to let the user fill a tutor's
 * per-fragment `variables`, load the referenced fragment file (with
 * `loadYamlFromUrlAction`), parse it (`parseYaml` + `FragmentFileSchema`), then
 * call this to learn which variables that fragment expects — their names
 * (`properties` keys), types (`string` | `boolean` | `array`), which are
 * `required`, and any `default`.
 */
export function getFragmentInputSchema(
  file: FragmentFile,
  fragmentId: string,
): InputSchema | undefined {
  return file.fragments.find((fragment) => fragment.id === fragmentId)?.input_schema;
}
