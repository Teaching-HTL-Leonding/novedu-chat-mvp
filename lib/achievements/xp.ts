// XP and levels (docs/home.md). XP pays per active day and per earned
// achievement — never per message, answer or request — and is computed on every
// load, never stored. It is monotonic: active days and stored grants are never
// deleted.

/** XP per Vienna-local active day. */
export const XP_PER_ACTIVE_DAY = 10;

/** `XP = 10 × active days + Σ xp of the stored grants`. */
export function xpTotal(activeDayCount: number, grantXp: readonly number[]): number {
  return XP_PER_ACTIVE_DAY * activeDayCount + grantXp.reduce((sum, xp) => sum + xp, 0);
}

/** The XP at which level `n` starts: 50 · n · (n − 1) (level 2 at 100, 3 at 300, …). */
export function levelStart(n: number): number {
  return 50 * n * (n - 1);
}

export interface Level {
  level: number;
  xp: number;
  /** XP at which the current level started. */
  levelStart: number;
  /** XP at which the next level starts. */
  nextLevelStart: number;
}

export function levelFor(xp: number): Level {
  let level = 1;
  while (levelStart(level + 1) <= xp) level++;
  return { level, xp, levelStart: levelStart(level), nextLevelStart: levelStart(level + 1) };
}
