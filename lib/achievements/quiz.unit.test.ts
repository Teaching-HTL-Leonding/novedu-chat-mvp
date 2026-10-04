// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  compareScore,
  goldsReached,
  improvedOn,
  medalCounts,
  medalOf,
  type QuizAttempt,
  quizSummaries,
  RETAINED_NEWEST,
  refreshedOn,
  refreshNudges,
  resultsReached,
  scorePercent,
} from "./quiz";

let seq = 0;
/** An attempt on `date` (Vienna-local), 10:00Z, with `correct / total` unless overridden. */
function attempt(
  code: string,
  date: string,
  correct: number,
  total: number,
  extra: Partial<QuizAttempt> = {},
): QuizAttempt {
  seq += 1;
  const partial = extra.partial ?? 0;
  const incorrect = extra.incorrect ?? total - correct - partial;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    code,
    correct,
    partial,
    incorrect,
    unanswered: 0,
    total,
    finishedAt: new Date(`${date}T10:00:00Z`),
    finishedOn: date,
    note: `Quiz ${code}`,
    open: true,
    ...extra,
  };
}

describe("scores", () => {
  it("compares exact fractions, never rounded percentages", () => {
    // 2/3 vs 666/1000: 66.67 % vs 66.6 % — both "66 %" when rounded down.
    const a = attempt("q", "2026-09-01", 2, 3);
    const b = attempt("q", "2026-09-01", 666, 1000);
    expect(compareScore(a, b)).toBe(1);
    expect(compareScore(b, a)).toBe(-1);
    expect(scorePercent(a)).toBe(scorePercent(b));
  });

  it("counts partial as half and treats equal fractions as ties", () => {
    const half = attempt("q", "2026-09-01", 0, 2, { partial: 2 }); // 2 × 0.5 / 2 = 50 %
    const oneOfTwo = attempt("q", "2026-09-01", 1, 2);
    expect(compareScore(half, oneOfTwo)).toBe(0);
    expect(scorePercent(half)).toBe(50);
  });

  it("stays exact for attempt lengths beyond 32 bits of cross product", () => {
    const a = attempt("q", "2026-09-01", 2_000_000_000, 2_000_000_001);
    const b = attempt("q", "2026-09-01", 1_999_999_999, 2_000_000_000);
    expect(compareScore(a, b)).toBe(1);
  });

  it("rounds the shown percentage down, so 100 % always means gold", () => {
    expect(scorePercent(attempt("q", "2026-09-01", 199, 200, { partial: 1 }))).toBe(99);
  });
});

describe("medals", () => {
  it("gold = every slot correct; silver ≥ 80 %; bronze ≥ 50 %; else none", () => {
    expect(medalOf(attempt("q", "2026-09-01", 5, 5))).toBe("gold");
    // 99.75 % with a partial is not gold.
    expect(medalOf(attempt("q", "2026-09-01", 199, 200, { partial: 1 }))).toBe("silver");
    expect(medalOf(attempt("q", "2026-09-01", 4, 5))).toBe("silver"); // exactly 80 %
    expect(medalOf(attempt("q", "2026-09-01", 7, 10, { partial: 2 }))).toBe("silver"); // 80 %
    expect(medalOf(attempt("q", "2026-09-01", 7, 10, { partial: 1 }))).toBe("bronze"); // 75 %
    expect(medalOf(attempt("q", "2026-09-01", 1, 2))).toBe("bronze"); // exactly 50 %
    expect(medalOf(attempt("q", "2026-09-01", 0, 2, { partial: 1 }))).toBeUndefined(); // 25 %
    expect(medalOf(attempt("q", "2026-09-01", 0, 3))).toBeUndefined();
  });
});

describe("quizSummaries", () => {
  it("groups by code, orders attempts chronologically and picks last and best", () => {
    const first = attempt("b", "2026-09-01", 4, 5);
    const second = attempt("b", "2026-09-03", 2, 5);
    const other = attempt("a", "2026-09-02", 1, 1);
    const [a, b] = quizSummaries([second, other, first]);
    expect(a?.code).toBe("a");
    expect(b?.attempts).toEqual([first, second]);
    expect(b?.last).toBe(second);
    expect(b?.best).toBe(first);
    expect(b?.medal).toBe("silver");
  });

  it("hands a tied best to the newest attempt (the same row the store's prune keeps)", () => {
    const older = attempt("q", "2026-09-01", 3, 5);
    const newer = attempt("q", "2026-09-04", 3, 5);
    expect(quizSummaries([older, newer])[0]?.best).toBe(newer);
  });

  it("counts medals per quiz from each best attempt", () => {
    const quizzes = quizSummaries([
      attempt("a", "2026-09-01", 5, 5),
      attempt("b", "2026-09-01", 1, 5),
      attempt("b", "2026-09-02", 4, 5),
      attempt("c", "2026-09-01", 0, 5),
    ]);
    expect(medalCounts(quizzes)).toEqual({ gold: 1, silver: 1, bronze: 0 });
  });
});

describe("refreshNudges", () => {
  const TODAY = "2026-10-04";

  it("needs a last attempt ≥ 5 days old, below gold or > 14 days old, and an open code", () => {
    const quizzes = quizSummaries([
      attempt("fresh", "2026-09-30", 1, 2), // 4 days: too recent
      attempt("due", "2026-09-29", 1, 2), // 5 days, bronze
      attempt("gold-recent", "2026-09-20", 2, 2), // gold, 14 days: not yet
      attempt("gold-old", "2026-09-19", 2, 2), // gold, 15 days
      attempt("closed", "2026-09-01", 1, 2, { open: false }),
    ]);
    expect(refreshNudges(quizzes, TODAY).map((q) => q.code)).toEqual(["gold-old", "due"]);
  });

  it("lists at most three, oldest last attempt first, ties by code", () => {
    const quizzes = quizSummaries([
      attempt("d", "2026-09-10", 0, 2),
      attempt("c", "2026-09-01", 0, 2),
      attempt("b", "2026-09-01", 0, 2),
      attempt("a", "2026-09-20", 0, 2),
    ]);
    expect(refreshNudges(quizzes, TODAY).map((q) => q.code)).toEqual(["b", "c", "d"]);
  });

  it("reads the LAST attempt's age, not the first", () => {
    const quizzes = quizSummaries([
      attempt("q", "2026-09-01", 0, 2),
      attempt("q", "2026-10-02", 0, 2),
    ]);
    expect(refreshNudges(quizzes, TODAY)).toEqual([]);
  });
});

describe("Quiz-mastery dates", () => {
  it("results: the first saved attempt's day", () => {
    expect(
      resultsReached([attempt("b", "2026-09-05", 1, 2), attempt("a", "2026-09-03", 0, 2)]),
    ).toEqual(["2026-09-03", "2026-09-05"]);
  });

  it("golds: the day each distinct quiz got its first gold", () => {
    const quizzes = quizSummaries([
      attempt("a", "2026-09-01", 2, 2),
      attempt("a", "2026-09-02", 2, 2), // a second gold of the same quiz: not counted again
      attempt("b", "2026-09-03", 1, 2),
      attempt("b", "2026-09-07", 2, 2),
    ]);
    expect(goldsReached(quizzes)).toEqual(["2026-09-01", "2026-09-07"]);
  });

  it("improved: an attempt beating the best of ALL earlier ones, not just the previous", () => {
    const earlier = [
      attempt("q", "2026-09-01", 4, 5),
      attempt("q", "2026-09-02", 2, 5),
      attempt("q", "2026-09-03", 4, 5), // ties the best: not an improvement
    ];
    expect(improvedOn(quizSummaries(earlier))).toBeUndefined();
    const improved = quizSummaries([...earlier, attempt("q", "2026-09-04", 5, 5)]);
    expect(improvedOn(improved)).toBe("2026-09-04");
  });

  it("improved: the earliest across quizzes", () => {
    const quizzes = quizSummaries([
      attempt("a", "2026-09-10", 1, 5),
      attempt("a", "2026-09-12", 3, 5),
      attempt("b", "2026-09-01", 1, 5),
      attempt("b", "2026-09-05", 2, 5),
    ]);
    expect(improvedOn(quizzes)).toBe("2026-09-05");
  });

  it("refreshed: two consecutive attempts ≥ 5 calendar days apart, dated to the later", () => {
    expect(
      refreshedOn(
        quizSummaries([attempt("q", "2026-09-01", 1, 2), attempt("q", "2026-09-05", 1, 2)]),
      ),
    ).toBeUndefined();
    expect(
      refreshedOn(
        quizSummaries([
          attempt("q", "2026-09-01", 1, 2),
          attempt("q", "2026-09-04", 1, 2),
          attempt("q", "2026-09-09", 1, 2),
        ]),
      ),
    ).toBe("2026-09-09");
  });

  it("refreshed: never pairs the retained best row across the pruned gap", () => {
    // The old best (gold, 1 Aug) survives the prune beyond the newest 50, which all
    // fall on 1–2 Sep: the 31-day gap between them is NOT a refresh.
    const best = attempt("q", "2026-08-01", 2, 2);
    const run = Array.from({ length: RETAINED_NEWEST }, (_, i) =>
      attempt("q", i < 25 ? "2026-09-01" : "2026-09-02", 0, 2),
    );
    expect(refreshedOn(quizSummaries([best, ...run]))).toBeUndefined();
    // Without the gap (nothing pruned yet) the same pair would count.
    expect(refreshedOn(quizSummaries([best, ...run.slice(0, 1)]))).toBe("2026-09-01");
  });
});
