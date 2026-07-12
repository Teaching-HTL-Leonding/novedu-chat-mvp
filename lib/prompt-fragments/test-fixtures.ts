// Synthetic, in-code fragment-library fixtures shared by the prompt-fragment unit
// tests (parse / consistency / assemble / fragment / load) and — re-exported — by the
// tutor tests. These are NOT real activities and are deliberately NOT read from disk:
// the content is built from explicit MARKER strings and role-named fragments so a
// reader immediately sees this is test scaffolding, not a demo. No `node:fs`, no
// dependency on the `activities/` folder.
//
// The two libraries pull six fragments spanning every case the consistency/assembly
// tests exercise: a required STRING var (`str_frag`), a required ARRAY var rendered
// with `{{#each}}` (`list_frag`), a BOOLEAN var in a `{{#unless}}` (`flag_frag`), an
// unescaped ASCII diagram (`diagram_frag`), a plain fragment (`plain_frag`), and a
// high-priority "last" fragment (`safety_frag`). Priorities are 10/20/30/40/50/60.

import type { Fetcher, FetchResponse } from "./fetcher";
import { parseYaml, validate } from "./parse";
import { type FragmentFile, FragmentFileSchema } from "./schemas";

// A synthetic base. These URLs are only ever used as keys for the fixture fetchers;
// nothing here touches the network. The path shape (a filename under `/tutors/`)
// is what makes relative fragment refs and `../` resolution meaningful.
const BASE = "https://fixtures.test/tutors";
export const LIB_A_URL = `${BASE}/lib-a.yaml`;
export const LIB_B_URL = `${BASE}/lib-b.yaml`;

export const LIB_A_YAML = `id: lib-a
fragments:
  - id: str_frag
    version: 1
    priority: 10
    input_schema:
      type: object
      required:
        - topic
      properties:
        topic:
          type: string
    content: |
      FIRST-MARKER topic={{topic}}
  - id: list_frag
    version: 1
    priority: 20
    input_schema:
      type: object
      required:
        - items
      properties:
        items:
          type: array
          items:
            type: string
    content: |
      Items:
      {{#each items}}
      - {{this}}
      {{/each}}
  - id: flag_frag
    version: 1
    priority: 30
    input_schema:
      type: object
      properties:
        enabled:
          type: boolean
    content: |
      {{#unless enabled}}NO-SOLUTION-MARKER{{/unless}}
  - id: safety_frag
    version: 1
    priority: 60
    content: |
      LAST-MARKER keep it safe.
`;

export const LIB_B_YAML = `id: lib-b
fragments:
  - id: diagram_frag
    version: 1
    priority: 40
    content: |
      [head] -> [ A ] -> [ B ] -> null
  - id: plain_frag
    version: 1
    priority: 50
    content: |
      PLAIN-MARKER nothing special.
`;

// A schema-valid library whose second fragment's template references a variable
// its input_schema never declares — the standalone check strict-renders it and
// reports FRAGMENT_TEMPLATE_ERROR for `undeclared_frag`.
export const BROKEN_TEMPLATE_YAML = `id: broken-template
fragments:
  - id: ok_frag
    version: 1
    priority: 10
    input_schema:
      type: object
      required:
        - topic
      properties:
        topic:
          type: string
    content: |
      OK topic={{topic}}
  - id: undeclared_frag
    version: 1
    priority: 20
    input_schema:
      type: object
      properties:
        items:
          type: array
          items:
            type: string
    content: |
      Uses {{undeclared_var}} which is never declared.
`;

export function fixtureResponse(
  body: string,
  init: { ok?: boolean; status?: number } = {},
): FetchResponse {
  return { ok: init.ok ?? true, status: init.status ?? 200, text: async () => body };
}

/** A fetcher serving the two fragment libraries. Any other URL throws — a network-isolation guard. */
export function fragmentFetcher(overrides: Map<string, FetchResponse> = new Map()): Fetcher {
  const bodies = new Map<string, string>([
    [LIB_A_URL, LIB_A_YAML],
    [LIB_B_URL, LIB_B_YAML],
  ]);
  return async (url) => {
    const override = overrides.get(url);
    if (override) return override;
    const body = bodies.get(url);
    if (body === undefined) throw new Error(`Unexpected fetch URL: ${url}`);
    return fixtureResponse(body);
  };
}

/** The two fragment libraries keyed by the aliases the workhorse fixtures use. */
export function loadFixtureFragmentFiles(): Map<string, FragmentFile> {
  const aliases: ReadonlyArray<readonly [string, string]> = [
    ["lib_a", LIB_A_YAML],
    ["lib_b", LIB_B_YAML],
  ];
  const map = new Map<string, FragmentFile>();
  for (const [alias, body] of aliases) {
    const parsed = parseYaml(body);
    if (!parsed.ok) throw new Error(`fixture ${alias} YAML invalid`);
    const valid = validate(parsed.value, FragmentFileSchema, "FRAGMENT_FILE_SCHEMA_ERROR");
    if (!valid.ok)
      throw new Error(`fixture ${alias} schema invalid: ${JSON.stringify(valid.error.zodIssues)}`);
    map.set(alias, valid.data);
  }
  return map;
}
