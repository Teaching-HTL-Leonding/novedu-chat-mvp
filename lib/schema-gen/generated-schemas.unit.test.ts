// The coupling guarantee that makes zod the PERMANENT single source of truth for the
// authoring JSON Schemas. Two hermetic, secret-free checks over all seven kinds:
//
//  1. Drift guard — the committed `activities/**/*-yaml.schema.json` is byte-identical
//     to a fresh in-memory generation. Editing a zod schema (or its `.meta()` prose)
//     without re-running `npm run generate:schemas` fails here, so a stale schema can
//     never reach a green CI run (and thus never a merge — novedu-publish inherits this).
//
//  2. Doc coverage — every authorable field (every `properties` entry, everywhere,
//     including `$defs`) carries a non-empty `description`. This keeps zod-as-source-of-
//     docs true over time and guarantees the metadata a future teacher-markdown
//     generator needs is always present.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  schemaRegistry,
  serializeActivityJsonSchema,
  toActivityJsonSchema,
} from "@/lib/schema-gen";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("generated activity JSON Schemas", () => {
  describe("drift guard (committed === freshly generated)", () => {
    for (const entry of schemaRegistry) {
      it(`${entry.kind}: ${entry.outPath} is up to date`, () => {
        const committed = readFileSync(resolve(repoRoot, entry.outPath), "utf8");
        expect(
          committed,
          `${entry.outPath} is stale — run \`npm run generate:schemas\` and commit the result.`,
        ).toBe(serializeActivityJsonSchema(entry));
      });
    }
  });

  describe("doc coverage (every field has a description)", () => {
    for (const entry of schemaRegistry) {
      it(`${entry.kind}: every field carries a .meta().description`, () => {
        const missing = fieldsMissingDescription(toActivityJsonSchema(entry));
        expect(
          missing,
          `Fields without a description in ${entry.kind}: ${missing.join(", ")}. ` +
            "Add `.meta({ description: … })` to the zod field, then regenerate.",
        ).toEqual([]);
      });
    }
  });
});

/**
 * Walk a generated JSON Schema and return the paths of everything that should carry a
 * non-empty `description` but doesn't. Two rules:
 *   - Every `properties` map value (a real authorable field) needs a description, UNLESS
 *     it is a pure `$ref` — then the referenced `$def` carries it (the YAML language
 *     server resolves the ref and shows the target's prose on hover).
 *   - Every `$def` object needs a top-level description, so every ref resolves to
 *     documented prose.
 * Array `items`, `additionalProperties`, and `oneOf`/`anyOf` members are recursed into
 * but not themselves required to carry one.
 */
function fieldsMissingDescription(schema: unknown, path = "", acc: string[] = []): string[] {
  if (!isObject(schema)) return acc;

  const properties = schema.properties;
  if (isObject(properties)) {
    for (const [key, sub] of Object.entries(properties)) {
      const here = path ? `${path}.${key}` : key;
      if (!isRef(sub) && !hasDescription(sub)) acc.push(here);
      fieldsMissingDescription(sub, here, acc);
    }
  }

  for (const key of ["items", "additionalProperties"] as const) {
    fieldsMissingDescription(schema[key], `${path}.${key}`, acc);
  }
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const branches = schema[key];
    if (Array.isArray(branches)) {
      branches.forEach((b, i) => {
        fieldsMissingDescription(b, `${path}.${key}[${i}]`, acc);
      });
    }
  }
  const defs = schema.$defs;
  if (isObject(defs)) {
    for (const [name, def] of Object.entries(defs)) {
      if (!hasDescription(def)) acc.push(`$defs.${name}`);
      fieldsMissingDescription(def, `$defs.${name}`, acc);
    }
  }

  return acc;
}

function hasDescription(node: unknown): boolean {
  return isObject(node) && typeof node.description === "string" && node.description.length > 0;
}

function isRef(node: unknown): boolean {
  return isObject(node) && typeof node.$ref === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
