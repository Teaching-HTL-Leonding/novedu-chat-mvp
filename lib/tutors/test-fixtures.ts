// Shared test fixtures: the REAL tutor + fragment files from `tutors/`, plus a
// fake Fetcher that serves them offline. Not a test file (doesn't match the
// `*.unit.test` glob), so it is never executed on its own.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fetcher, FetchResponse } from "./fetcher";
import { parseYaml, validate } from "./parse";
import { type FragmentFile, FragmentFileSchema, type Tutor, TutorSchema } from "./schemas";

const TUTORS_DIR = join(process.cwd(), "tutors");

export function readFixture(name: string): string {
  return readFileSync(join(TUTORS_DIR, name), "utf8");
}

const RAW =
  "https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/tutors";
export const TUTOR_URL = `${RAW}/linked-list-tutor.yaml`;
export const GENERAL_URL = `${RAW}/general-fragments.yaml`;
export const LINKED_URL = `${RAW}/linked-list-fragments.yaml`;

export function fixtureResponse(
  body: string,
  init: { ok?: boolean; status?: number } = {},
): FetchResponse {
  return { ok: init.ok ?? true, status: init.status ?? 200, text: async () => body };
}

/** A fetcher serving the three real fixtures. Any other URL throws — a network-isolation guard. */
export function fixtureFetcher(overrides: Map<string, FetchResponse> = new Map()): Fetcher {
  const bodies = new Map<string, string>([
    [TUTOR_URL, readFixture("linked-list-tutor.yaml")],
    [GENERAL_URL, readFixture("general-fragments.yaml")],
    [LINKED_URL, readFixture("linked-list-fragments.yaml")],
  ]);
  return async (url) => {
    const override = overrides.get(url);
    if (override) return override;
    const body = bodies.get(url);
    if (body === undefined) throw new Error(`Unexpected fetch URL: ${url}`);
    return fixtureResponse(body);
  };
}

/** Parse + validate the real tutor file into a typed object (throws if the fixture is broken). */
export function loadRealTutor(): Tutor {
  const parsed = parseYaml(readFixture("linked-list-tutor.yaml"));
  if (!parsed.ok) throw new Error("fixture tutor YAML invalid");
  const valid = validate(parsed.value, TutorSchema, "TUTOR_SCHEMA_ERROR");
  if (!valid.ok)
    throw new Error(`fixture tutor schema invalid: ${JSON.stringify(valid.error.zodIssues)}`);
  return valid.data;
}

/** The real fragment files keyed by the aliases the tutor uses. */
export function loadRealFragmentFiles(): Map<string, FragmentFile> {
  const aliases: ReadonlyArray<readonly [string, string]> = [
    ["general_fragments", "general-fragments.yaml"],
    ["linked_list_fragments", "linked-list-fragments.yaml"],
  ];
  const map = new Map<string, FragmentFile>();
  for (const [alias, name] of aliases) {
    const parsed = parseYaml(readFixture(name));
    if (!parsed.ok) throw new Error(`fixture ${name} YAML invalid`);
    const valid = validate(parsed.value, FragmentFileSchema, "FRAGMENT_FILE_SCHEMA_ERROR");
    if (!valid.ok)
      throw new Error(`fixture ${name} schema invalid: ${JSON.stringify(valid.error.zodIssues)}`);
    map.set(alias, valid.data);
  }
  return map;
}
