// @vitest-environment node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { importSpecifiers, REPO_ROOT, resolveImport, walkClosure } from "@/tests/import-graph";
import { STUDENT_CATALOG, type StudentAchievement } from "./catalog";
import type { UsageDay } from "./derive";

const day = (date: string, extra: Partial<UsageDay> = {}): UsageDay => ({
  date,
  activeHours: 1,
  quizAnswers: 0,
  writingSaves: 0,
  ...extra,
});

function rule(id: string): StudentAchievement {
  const achievement = STUDENT_CATALOG.find((a) => a.id === id);
  if (!achievement) throw new Error(`no catalog entry ${id}`);
  return achievement;
}

const run = (id: string, usage: UsageDay[]) => rule(id).evaluate({ usage });

/** Consecutive Mondays starting at `first`, one active day each. */
function weeks(first: string, n: number): UsageDay[] {
  const start = Date.UTC(
    Number(first.slice(0, 4)),
    Number(first.slice(5, 7)) - 1,
    Number(first.slice(8, 10)),
  );
  return Array.from({ length: n }, (_, i) =>
    day(new Date(start + i * 7 * 86_400_000).toISOString().slice(0, 10)),
  );
}

/** `n` consecutive days starting at `first`. */
function consecutiveDays(first: string, n: number, extra: Partial<UsageDay> = {}): UsageDay[] {
  const start = Date.UTC(
    Number(first.slice(0, 4)),
    Number(first.slice(5, 7)) - 1,
    Number(first.slice(8, 10)),
  );
  return Array.from({ length: n }, (_, i) =>
    day(new Date(start + i * 86_400_000).toISOString().slice(0, 10), extra),
  );
}

describe("catalog shape", () => {
  it("has unique ids that fit the column, contain no code and follow the ladder pattern", () => {
    const ids = STUDENT_CATALOG.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.length).toBeLessThanOrEqual(64);
      expect(id).toMatch(/^[a-z]+(-[a-z]+)*(-\d+)?$/);
    }
  });

  it("ships only the Rhythm and Practice families, none hidden, all for students", () => {
    expect(new Set(STUDENT_CATALOG.map((a) => a.family))).toEqual(new Set(["rhythm", "practice"]));
    expect(STUDENT_CATALOG.every((a) => !a.hidden && a.audience === "student")).toBe(true);
    expect(STUDENT_CATALOG.every((a) => a.needs.length === 1 && a.needs[0] === "usage")).toBe(true);
  });

  it("has no chat-message tiers and no time-of-day badges", () => {
    expect(STUDENT_CATALOG.some((a) => /message|night|early/i.test(a.id))).toBe(false);
  });

  it("ids are literal: the source spells every ladder name, no interpolation from facts", () => {
    const source = readFileSync(join(REPO_ROOT, "lib/achievements/catalog.ts"), "utf8");
    for (const ladder of [
      "weekly-streak",
      "week-days",
      "active-days",
      "quiz-answers",
      "writing-saves",
    ]) {
      expect(source).toContain(`"${ladder}"`);
    }
  });
});

describe("Rhythm rules", () => {
  it("weekly streak tiers: below, at and above the threshold, dated to the k-th week", () => {
    expect(run("weekly-streak-2", weeks("2026-09-07", 1))).toEqual({
      earned: false,
      current: 1,
      target: 2,
    });
    expect(run("weekly-streak-2", weeks("2026-09-07", 2))).toEqual({
      earned: true,
      qualifiedOn: "2026-09-14",
    });
    expect(run("weekly-streak-4", weeks("2026-09-07", 5))).toEqual({
      earned: true,
      qualifiedOn: "2026-09-28",
    });
  });

  it("a streak reached before a break stays earned (lifetime predicate)", () => {
    const usage = [...weeks("2026-01-05", 4), day("2026-09-30")];
    expect(run("weekly-streak-4", usage)).toEqual({ earned: true, qualifiedOn: "2026-01-26" });
    expect(run("weekly-streak-8", usage)).toEqual({ earned: false, current: 4, target: 8 });
  });

  it("days in one week", () => {
    const usage = consecutiveDays("2026-09-07", 3); // Mon–Wed
    expect(run("week-days-3", usage)).toEqual({ earned: true, qualifiedOn: "2026-09-09" });
    expect(run("week-days-5", usage)).toEqual({ earned: false, current: 3, target: 5 });
  });

  it("active days in total", () => {
    expect(run("active-days-10", consecutiveDays("2026-09-01", 9))).toEqual({
      earned: false,
      current: 9,
      target: 10,
    });
    expect(run("active-days-10", consecutiveDays("2026-09-01", 10))).toEqual({
      earned: true,
      qualifiedOn: "2026-09-10",
    });
    expect(run("active-days-10", consecutiveDays("2026-09-01", 11))).toEqual({
      earned: true,
      qualifiedOn: "2026-09-10",
    });
  });
});

describe("Practice rules", () => {
  it("quiz answers: dated to the day the running total crossed the tier", () => {
    const usage = [day("2026-09-01", { quizAnswers: 9 }), day("2026-09-02", { quizAnswers: 1 })];
    expect(run("quiz-answers-10", usage)).toEqual({ earned: true, qualifiedOn: "2026-09-02" });
    expect(run("quiz-answers-100", usage)).toEqual({ earned: false, current: 10, target: 100 });
    expect(run("quiz-answers-10", [day("2026-09-01", { quizAnswers: 9 })])).toEqual({
      earned: false,
      current: 9,
      target: 10,
    });
  });

  it("writing saves", () => {
    const usage = [day("2026-09-01", { writingSaves: 7 })];
    expect(run("writing-saves-5", usage)).toEqual({ earned: true, qualifiedOn: "2026-09-01" });
    expect(run("writing-saves-25", usage)).toEqual({ earned: false, current: 7, target: 25 });
  });
});

describe("guard: the catalog never reaches a client bundle", () => {
  function* walk(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".next", "dist"].includes(name)) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) yield* walk(abs);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield abs;
    }
  }

  // Type-only imports are erased at build time and carry nothing to the browser.
  const valueSpecifiers = (source: string): string[] => {
    const typeOnly = new Set(
      [...source.matchAll(/^\s*import\s+type\s[^;]*?from\s+["']([^"']+)["']/gm)].map(
        (m) => m[1] ?? "",
      ),
    );
    return importSpecifiers(source).filter((s) => !typeOnly.has(s));
  };

  it("no 'use client' module's value-import closure includes lib/achievements/catalog.ts", () => {
    const clientRoots = ["app", "components", "lib"]
      .flatMap((dir) => [...walk(join(REPO_ROOT, dir))])
      .filter((abs) => /^\s*["']use client["']/.test(readFileSync(abs, "utf8")))
      .map((abs) => relative(REPO_ROOT, abs).replace(/\\/g, "/"));
    expect(clientRoots).toContain("app/_home/season-calendar.tsx"); // not vacuous

    for (const root of clientRoots) {
      // A "use server" module reaches the client only as action references, so
      // the walk stops there.
      const reached = walkClosure([root], ({ rel, source }) =>
        (rel !== root && /^\s*["']use server["']/.test(source) ? [] : valueSpecifiers(source))
          .map((s) => resolveImport(rel, s))
          .filter((r) => r.exists && r.rel !== null)
          .map((r) => r.rel as string),
      );
      expect([root, reached.has("lib/achievements/catalog.ts")]).toEqual([root, false]);
    }
  });
});
