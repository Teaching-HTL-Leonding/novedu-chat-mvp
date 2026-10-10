import { describe, expect, it } from "vitest";
import { importSpecifiers, readModule, sourceFiles, walkClosure } from "@/tests/import-graph";

// The isolation invariant (see docs/prompt-fragments.md): ALL Handlebars handling —
// compilation, COMPILE_OPTIONS, consistency, assembly — lives ONLY in
// `lib/prompt-fragments/`. No activity module (tutor / quiz / writing / coding) may
// import `handlebars` or re-implement any of it. This grep-guard fails the build if a
// future change copies template handling into `lib/quiz-*` / `lib/writing-*` /
// `lib/coding-*` (or anywhere else outside the shared module).

const PKG = "handlebars";
const production = sourceFiles("lib", "app", "cli");
const isAllowed = (rel: string) => rel.startsWith("lib/prompt-fragments/");

describe("prompt-fragment isolation invariant", () => {
  it("imports `handlebars` ONLY from files under lib/prompt-fragments/, the three known importers included", () => {
    const importers = production.filter((rel) =>
      importSpecifiers(readModule(rel)).some((spec) => spec === PKG || spec.startsWith(`${PKG}/`)),
    );
    // Not vacuous: the scan still finds the real importers.
    expect(importers).toEqual(
      expect.arrayContaining([
        "lib/prompt-fragments/assemble.ts",
        "lib/prompt-fragments/fragment.ts",
        "lib/prompt-fragments/host-template.ts",
      ]),
    );
    expect(importers.filter((rel) => !isAllowed(rel))).toEqual([]);
  });

  it("references COMPILE_OPTIONS ONLY from files under lib/prompt-fragments/", () => {
    const offenders = production.filter(
      (rel) => !isAllowed(rel) && /\bCOMPILE_OPTIONS\b/.test(readModule(rel)),
    );
    expect(
      offenders,
      `COMPILE_OPTIONS referenced outside lib/prompt-fragments/: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps lib/llm/endpoint.ts's import closure free of app/**, the model resolver, the fragment core and the DB", () => {
    // The coding proxy resolves fragments in the load layer, never in endpoint.ts —
    // whose whole closure must stay side-effect-free: no app/mastra/scch.ts, no
    // fragment assembly (see docs/coding.md).
    const FORBIDDEN = [
      /^app\//,
      /^lib\/llm\/model\.ts$/,
      /^lib\/prompt-fragments\//,
      /^lib\/db(\/|\.ts$)/,
    ];
    const offenders: string[] = [];
    const visited = walkClosure(["lib/llm/endpoint.ts"], ({ rel, imports }) =>
      imports.flatMap(({ rel: target }) => {
        if (target === null) return [];
        if (FORBIDDEN.some((pattern) => pattern.test(target))) offenders.push(`${rel} → ${target}`);
        return [target];
      }),
    );
    expect(visited).toContain("lib/scch-endpoint.ts"); // not vacuous
    expect(offenders).toEqual([]);
  });
});
