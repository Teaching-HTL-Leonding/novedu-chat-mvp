import { describe, expect, it } from "vitest";
import type { Achievement, FactGroup, Outcome } from "./catalog";
import { ALMOST_THERE_MAX, almostThere, badgeView, evaluate, newGrants } from "./evaluate";
import { levelFor, levelStart, xpTotal } from "./xp";

// Hand-built catalogs and facts — no database, no real catalog.
interface Facts {
  usage: { n: number } | undefined;
}

function entry(
  id: string,
  outcome: Outcome,
  extra: Partial<Achievement<Facts>> = {},
): Achievement<Facts> {
  return {
    id,
    audience: "student",
    family: "rhythm",
    order: 0,
    icon: "flame",
    name: id,
    criterion: `do ${id}`,
    hidden: false,
    xp: 20,
    needs: ["usage"],
    evaluate: () => outcome,
    ...extra,
  };
}

const USAGE = new Set<FactGroup>(["usage"]);
const NONE = new Set<FactGroup>();
const facts: Facts = { usage: { n: 1 } };

describe("evaluate", () => {
  it("diffs earned (stored), new (qualifies, not stored) and in progress", () => {
    const catalog = [
      entry("a-1", { earned: true, qualifiedOn: "2026-09-01" }),
      entry("a-2", { earned: true, qualifiedOn: "2026-09-02" }),
      entry("a-3", { earned: false, current: 2, target: 5 }),
    ];
    const result = evaluate(catalog, facts, USAGE, [
      { id: "a-1", qualifiedOn: "2026-08-31", seenAt: new Date() },
    ]);
    expect(result.map((r) => r.status)).toEqual([
      // The stored date wins over a recomputed one.
      { kind: "earned", qualifiedOn: "2026-08-31", isNew: false },
      { kind: "qualifies", qualifiedOn: "2026-09-02" },
      { kind: "progress", current: 2, target: 5 },
    ]);
    expect(newGrants(result)).toEqual([{ id: "a-2", qualifiedOn: "2026-09-02" }]);
  });

  it("a stored grant stays earned whatever the facts say, and is new while unseen", () => {
    const catalog = [entry("a-1", { earned: false, current: 0, target: 1 })];
    const [result] = evaluate(catalog, facts, USAGE, [
      { id: "a-1", qualifiedOn: "2026-09-01", seenAt: null },
    ]);
    expect(result?.status).toEqual({ kind: "earned", qualifiedOn: "2026-09-01", isNew: true });
  });

  it("never runs a rule whose fact group failed — unavailable, not zero", () => {
    let called = false;
    const catalog = [
      entry(
        "a-1",
        { earned: false, current: 0, target: 1 },
        {
          evaluate: () => {
            called = true;
            return { earned: false, current: 0, target: 1 };
          },
        },
      ),
    ];
    const result = evaluate(catalog, { usage: undefined }, NONE, []);
    expect(result[0]?.status).toEqual({ kind: "unavailable" });
    expect(called).toBe(false);
    expect(newGrants(result)).toEqual([]);
  });

  it("ignores stored grants of ids no longer in the catalog", () => {
    const result = evaluate([], facts, USAGE, [
      { id: "gone-1", qualifiedOn: "2026-09-01", seenAt: null },
    ]);
    expect(result).toEqual([]);
  });
});

describe("almostThere", () => {
  it("offers only the next unearned tier of each ladder", () => {
    const catalog = [
      entry("week-days-3", { earned: false, current: 2, target: 3 }),
      entry("week-days-5", { earned: false, current: 2, target: 5 }),
      entry("streak-2", { earned: true, qualifiedOn: "2026-09-01" }),
      entry("streak-4", { earned: false, current: 2, target: 4 }),
      entry("streak-8", { earned: false, current: 2, target: 8 }),
    ];
    const picked = almostThere(
      evaluate(catalog, facts, USAGE, [
        { id: "streak-2", qualifiedOn: "2026-09-01", seenAt: null },
      ]),
    ).map((e) => e.achievement.id);
    expect(picked).toEqual(["week-days-3", "streak-4"]);
  });

  it("lists unearned, listed entries with progress by ratio, catalog order breaking ties, at most four", () => {
    const catalog = [
      entry("p1", { earned: false, current: 1, target: 10 }), // 0.1
      entry("p2", { earned: false, current: 5, target: 10 }), // 0.5
      entry("p3", { earned: false, current: 1, target: 2 }), // 0.5 (later in catalog)
      entry("p4", { earned: false, current: 0, target: 3 }), // no progress
      entry("p5", { earned: false, current: 9, target: 10 }), // 0.9
      entry("p6", { earned: false, current: 2, target: 10 }), // 0.2
      entry("h-1", { earned: false, current: 9, target: 10 }, { hidden: true }),
      entry("e-1", { earned: true, qualifiedOn: "2026-09-01" }),
    ];
    const picked = almostThere(
      evaluate(catalog, facts, USAGE, [{ id: "e-1", qualifiedOn: "2026-09-01", seenAt: null }]),
    ).map((e) => e.achievement.id);
    expect(picked).toEqual(["p5", "p2", "p3", "p6"]);
    expect(picked).toHaveLength(ALMOST_THERE_MAX);
  });
});

describe("badgeView", () => {
  it("shows earned tiers plus the next tier of each ladder; the rest is 'more'", () => {
    const catalog = [
      entry("solo", { earned: false, current: 0, target: 1 }, { order: -1 }),
      entry("streak-2", { earned: true, qualifiedOn: "2026-09-01" }, { order: 0 }),
      entry("streak-4", { earned: false, current: 2, target: 4 }, { order: 1 }),
      entry("streak-8", { earned: false, current: 2, target: 8 }, { order: 2 }),
      entry("days-10", { earned: false, current: 0, target: 10 }, { order: 3 }),
      entry("days-30", { earned: false, current: 0, target: 30 }, { order: 4 }),
      entry("quiz-10", { earned: false, current: 0, target: 10 }, { family: "practice", order: 0 }),
    ];
    const evaluated = evaluate(catalog, facts, USAGE, [
      { id: "streak-2", qualifiedOn: "2026-09-01", seenAt: null },
    ]);
    const view = badgeView(evaluated, ["rhythm", "practice"]);
    expect(
      view.map((f) => [
        f.family,
        f.shown.map((e) => e.achievement.id),
        f.more.map((e) => e.achievement.id),
      ]),
    ).toEqual([
      // Earned first, then the next tiers (and unearned one-offs) in catalog order.
      ["rhythm", ["streak-2", "solo", "streak-4", "days-10"], ["streak-8", "days-30"]],
      ["practice", ["quiz-10"], []],
    ]);
  });

  it("lists a hidden entry only once earned, and leaves out unavailable ones", () => {
    const catalog = [
      entry(
        "secret",
        { earned: false, current: 0, target: 1 },
        { hidden: true, name: "Secret Name" },
      ),
      entry("earned-secret", { earned: true, qualifiedOn: "2026-09-01" }, { hidden: true }),
      entry(
        "needs-quiz",
        { earned: false, current: 0, target: 1 },
        {
          needs: ["usage", "quiz" as FactGroup],
        },
      ),
    ];
    const evaluated = evaluate(catalog, facts, USAGE, [
      { id: "earned-secret", qualifiedOn: "2026-09-01", seenAt: new Date() },
    ]);
    const [rhythm] = badgeView(evaluated, ["rhythm"]);
    const ids = [...(rhythm?.shown ?? []), ...(rhythm?.more ?? [])].map((e) => e.achievement.id);
    expect(ids).toEqual(["earned-secret"]);
  });
});

describe("XP and levels", () => {
  it("XP = 10 × active days + Σ grant XP", () => {
    expect(xpTotal(0, [])).toBe(0);
    expect(xpTotal(56, [20, 50, 20])).toBe(650);
  });

  it("level n starts at 50 · n · (n − 1)", () => {
    expect([1, 2, 3, 4, 5].map(levelStart)).toEqual([0, 100, 300, 600, 1000]);
  });

  it("puts a student exactly on a boundary into the higher level", () => {
    expect(levelFor(0)).toEqual({ level: 1, xp: 0, levelStart: 0, nextLevelStart: 100 });
    expect(levelFor(99)).toMatchObject({ level: 1, nextLevelStart: 100 });
    expect(levelFor(100)).toEqual({ level: 2, xp: 100, levelStart: 100, nextLevelStart: 300 });
    expect(levelFor(1180)).toEqual({ level: 5, xp: 1180, levelStart: 1000, nextLevelStart: 1500 });
  });
});
