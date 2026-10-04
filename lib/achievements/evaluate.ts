// Catalog × facts × stored grants → what the page shows (docs/home.md). Pure.
// Earned state comes ONLY from stored grants; a rule that qualifies without a
// stored row is a NEW grant for the caller to insert first.

import { type Achievement, type FactGroup, ladderOf } from "./catalog";
import type { LocalDate } from "./time";

/** A stored `novedu_achievements` row. */
export interface Grant {
  id: string;
  qualifiedOn: LocalDate;
  /** null = not yet shown ("new"). */
  seenAt: Date | null;
}

export type Status =
  | { kind: "earned"; qualifiedOn: LocalDate; isNew: boolean }
  | { kind: "qualifies"; qualifiedOn: LocalDate }
  | { kind: "progress"; current: number; target: number }
  /** A fact group the rule needs failed to load. */
  | { kind: "unavailable" };

export interface Evaluated<F> {
  achievement: Achievement<F>;
  status: Status;
}

/**
 * Evaluates every catalog entry. A stored grant always wins (grants are never
 * revoked); otherwise the rule runs only when every group in its `needs` is
 * available, so an unavailable group is never read as zero.
 */
export function evaluate<F>(
  catalog: readonly Achievement<F>[],
  facts: F,
  available: ReadonlySet<FactGroup>,
  grants: readonly Grant[],
): Evaluated<F>[] {
  const stored = new Map(grants.map((g) => [g.id, g]));
  return catalog.map((achievement) => {
    const grant = stored.get(achievement.id);
    if (grant) {
      return {
        achievement,
        status: { kind: "earned", qualifiedOn: grant.qualifiedOn, isNew: grant.seenAt === null },
      };
    }
    if (!achievement.needs.every((group) => available.has(group))) {
      return { achievement, status: { kind: "unavailable" } };
    }
    const outcome = achievement.evaluate(facts);
    return {
      achievement,
      status: outcome.earned
        ? { kind: "qualifies", qualifiedOn: outcome.qualifiedOn }
        : { kind: "progress", current: outcome.current, target: outcome.target },
    };
  });
}

/** The grants to insert: qualifying entries without a stored row. */
export function newGrants<F>(
  evaluated: readonly Evaluated<F>[],
): { id: string; qualifiedOn: LocalDate }[] {
  return evaluated.flatMap(({ achievement, status }) =>
    status.kind === "qualifies" ? [{ id: achievement.id, qualifiedOn: status.qualifiedOn }] : [],
  );
}

/** How many entries Almost there lists at most. */
export const ALMOST_THERE_MAX = 4;

/**
 * Almost there: the next unearned tier of each ladder (a higher tier can't be
 * earned first), listed (not hidden) and with progress, by `current / target`
 * descending, catalog order breaking ties, at most four.
 */
export function almostThere<F>(evaluated: readonly Evaluated<F>[]): Evaluated<F>[] {
  const nextTaken = new Set<string>();
  return evaluated
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      if (entry.status.kind === "earned") return false;
      const ladder = ladderOf(entry.achievement.id);
      if (nextTaken.has(ladder)) return false;
      nextTaken.add(ladder);
      return true;
    })
    .filter(
      ({ entry }) =>
        !entry.achievement.hidden && entry.status.kind === "progress" && entry.status.current > 0,
    )
    .sort((a, b) => ratio(b.entry) - ratio(a.entry) || a.index - b.index)
    .slice(0, ALMOST_THERE_MAX)
    .map(({ entry }) => entry);
}

function ratio<F>({ status }: Evaluated<F>): number {
  return status.kind === "progress" ? status.current / status.target : 0;
}

export interface FamilyView<F> {
  family: string;
  /** Earned entries plus the next unearned tier of each ladder (and each unearned one-off). */
  shown: Evaluated<F>[];
  /** Everything else listable, revealed by "Show all badges". */
  more: Evaluated<F>[];
}

/**
 * The Badges section's default view, family by family (in `families` order).
 * Hidden entries appear only once earned; entries whose rule is unavailable
 * are left out.
 */
export function badgeView<F>(
  evaluated: readonly Evaluated<F>[],
  families: readonly string[],
): FamilyView<F>[] {
  return families.map((family) => {
    const shown: Evaluated<F>[] = [];
    const more: Evaluated<F>[] = [];
    const nextTaken = new Set<string>();
    const members = evaluated
      .filter((e) => e.achievement.family === family)
      .sort((a, b) => a.achievement.order - b.achievement.order);
    for (const entry of members) {
      const { achievement, status } = entry;
      if (status.kind === "earned") {
        shown.push(entry);
        continue;
      }
      if (achievement.hidden || status.kind === "unavailable") continue;
      const ladder = ladderOf(achievement.id);
      if (nextTaken.has(ladder)) {
        more.push(entry);
      } else {
        nextTaken.add(ladder);
        shown.push(entry);
      }
    }
    // Earned first, then the next tiers — each group in catalog order (stable sort).
    shown.sort((a, b) => Number(b.status.kind === "earned") - Number(a.status.kind === "earned"));
    return { family, shown, more };
  });
}
