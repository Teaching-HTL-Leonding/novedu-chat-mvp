// Synthetic, in-code tutor fixture shared by the tutor unit tests (parse /
// consistency / assemble / load). Built on the shared fragment-library fixtures in
// `@/lib/prompt-fragments/test-fixtures` (re-exported here for the tutor tests'
// convenience); this file adds only the workhorse TUTOR definition that references
// both libraries and pulls all six fragments. NOT a real activity, deliberately not
// read from disk.

import type { Fetcher, FetchResponse } from "@/lib/prompt-fragments";
import { parseYaml, validate } from "@/lib/prompt-fragments";
import {
  fixtureResponse,
  LIB_A_URL,
  LIB_A_YAML,
  LIB_B_URL,
  LIB_B_YAML,
} from "@/lib/prompt-fragments/test-fixtures";
import { type Tutor, TutorSchema } from "./schemas";

export {
  fixtureResponse,
  LIB_A_URL,
  LIB_A_YAML,
  LIB_B_URL,
  LIB_B_YAML,
  loadFixtureFragmentFiles,
} from "@/lib/prompt-fragments/test-fixtures";

const BASE = "https://fixtures.test/tutors";
export const TUTOR_URL = `${BASE}/test-tutor.yaml`;

export const TUTOR_YAML = `id: test-tutor
name: "Functional Test Tutor"
title: "Functional Test Tutor"
description: "Synthetic tutor used only by automated tests."
exampleQuestions:
  - title: "First example"
    question: "What is the first example question?"
  - title: "Second example"
    question: "What is the second example question?"
llm:
  model: test-model
prompt:
  fragment_files:
    - id: lib_a
      url: "lib-a.yaml"
    - id: lib_b
      url: "lib-b.yaml"
  fragments:
    - file: lib_a
      id: str_frag
      variables:
        topic: "TEST-TOPIC"
    - file: lib_a
      id: list_frag
      variables:
        items:
          - "ITEM-ALPHA"
          - "ITEM-BETA"
    - file: lib_a
      id: flag_frag
      variables:
        enabled: false
    - file: lib_b
      id: diagram_frag
    - file: lib_b
      id: plain_frag
    - file: lib_a
      id: safety_frag
      required: true
  tutor_instructions: |
    TUTOR-INSTRUCTIONS-MARKER stay in test mode.
`;

/** A fetcher serving the tutor and its two fragment libraries. Any other URL throws. */
export function fixtureFetcher(overrides: Map<string, FetchResponse> = new Map()): Fetcher {
  const bodies = new Map<string, string>([
    [TUTOR_URL, TUTOR_YAML],
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

/** Parse + validate the workhorse tutor into a typed object (throws if the fixture is broken). */
export function loadFixtureTutor(): Tutor {
  const parsed = parseYaml(TUTOR_YAML);
  if (!parsed.ok) throw new Error("fixture tutor YAML invalid");
  const valid = validate(parsed.value, TutorSchema, "TUTOR_SCHEMA_ERROR");
  if (!valid.ok)
    throw new Error(`fixture tutor schema invalid: ${JSON.stringify(valid.error.zodIssues)}`);
  return valid.data;
}
