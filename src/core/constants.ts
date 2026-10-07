/**
 * Game constants.
 *
 * Sources:
 *  - Score thresholds: Artemis `titles/chuni/const.py` (reverse-engineered
 *    source of truth), cross-checked against the CHUNITHM English Guide
 *    wiki. They agree item for item.
 *  - Lamp names: the CHUNITHM JP wiki's skill <-> clear-mark rename table,
 *    plus the `chuni-net` user script which maps on-screen icon names
 *    straight onto these numeric values.
 */

import type { FullChain, Lamp, ScoreRank } from './types';

/**
 * Lower score bound for each score rank, VERSE and later.
 *
 * Verified against a real 1033-record save spanning all five difficulties
 * and all fourteen ranks: zero violations.
 *
 * Note the legacy table (PARADISE LOST and earlier) differs — it had only
 * 11 grades, with S topping out at 999,999 instead of 989,999 and no S+.
 * Since reverse-lookup failure is a meaningful signal, the legacy bounds
 * are kept here purely so the validator can explain *why* a row failed.
 */
const RANK_THRESHOLDS: ReadonlyArray<readonly [number, ScoreRank]> = [
  [0, 0], // D
  [500000, 1], // C
  [600000, 2], // B
  [700000, 3], // BB
  [800000, 4], // BBB
  [900000, 5], // A
  [925000, 6], // AA
  [950000, 7], // AAA
  [975000, 8], // S
  [990000, 9], // SP
  [1000000, 10], // SS
  [1005000, 11], // SSP
  [1007500, 12], // SSS
  [1009000, 13], // SSS+ (SSSP)
];

/** Theoretical maximum score, an all-justice critical. */
const MAX_SCORE = 1010000;

/**
 * Legacy (LUMINOUS and earlier) lower bounds. Only used to explain a
 * failed reverse-lookup; never used to assign a rank.
 */
const LEGACY_THRESHOLDS: ReadonlyArray<readonly [number, ScoreRank]> = [
  [0, 0],
  [500000, 1],
  [600000, 2],
  [700000, 3],
  [800000, 4],
  [900000, 5],
  [925000, 6],
  [950000, 7],
  [975000, 8],
  [1000000, 10],
  [1007500, 12],
];

/** Display names for each score rank. */
export const RANK_NAMES: readonly string[] = [
  'D',
  'C',
  'B',
  'BB',
  'BBB',
  'A',
  'AA',
  'AAA',
  'S',
  'S+',
  'SS',
  'SS+',
  'SSS',
  'SSS+',
];

/** Display names for each clear lamp. */
export const LAMP_NAMES: readonly string[] = [
  'FAILED',
  'CLEAR',
  'HARD',
  'BRAVE',
  'ABSOLUTE',
  'ABSOLUTE+',
  'CATASTROPHY',
];

/**
 * CSV `clear` text -> `isSuccess` value.
 *
 * `absolutep` is retained even though VERSE withdrew ABSOLUTE+: dropping it
 * would make a legacy row fall through to 0 (FAILED) instead of keeping
 * its lamp. Any fallthrough is reported to the user rather than applied
 * silently.
 */
export const LAMP_MAP: Readonly<Record<string, Lamp>> = {
  failed: 0,
  clear: 1,
  hard: 2,
  brave: 3,
  absolute: 4,
  absolutep: 5,
  'catastrophy': 6,
};

/** CSV `full_chain` text -> `fullChain` value. Higher is stronger. */
export const FULL_CHAIN_MAP: Readonly<Record<string, FullChain>> = {
  fullchain: 1,
  fullchain1: 1,
  fullchain2: 2,
  fullchain3: 3,
  fullchain4: 4,
};

/** CSV `rank` text -> `scoreRank` value. */
export const RANK_MAP: Readonly<Record<string, ScoreRank>> = {
  d: 0,
  c: 1,
  b: 2,
  bb: 3,
  bbb: 4,
  a: 5,
  aa: 6,
  aaa: 7,
  s: 8,
  sp: 9,
  's+': 9,
  ss: 10,
  ssp: 11,
  'ss+': 11,
  sss: 12,
  sssp: 13,
  'sss+': 13,
};

/** Difficulty index -> name. 4 = ULTIMA, 5 = WORLD'S END. */
export const LEVEL_NAMES: readonly string[] = [
  'BASIC',
  'ADVANCED',
  'EXPERT',
  'MASTER',
  'ULTIMA',
  "WORLD'S END",
];

/**
 * ULTIMA is excluded from the server-side "recent plays" query
 * (`findByUser_Card_ExtIdAndLevelNot(..., 4, ...)`), so playlogs written at
 * that difficulty would never be shown. The merge itself still applies.
 */
export const LEVEL_ULTIMA = 4;

/**
 * Derive a score rank from a score.
 *
 * Returns null for a score outside the known range, which callers treat as
 * a signal that the row may predate the current threshold table.
 */
export function scoreToRank(score: number): ScoreRank | null {
  if (!Number.isFinite(score)) return null;
  if (score > MAX_SCORE) return null;
  for (let i = RANK_THRESHOLDS.length - 1; i >= 0; i--) {
    const [lower, rank] = RANK_THRESHOLDS[i];
    if (score >= lower) return rank;
  }
  return null;
}

/**
 * True when a score is only explicable by the pre-VERSE threshold table.
 *
 * A legacy score lands in a gap the modern table has no answer for: for
 * example 995,000 was SP under the old 11-grade table but sits above the
 * modern S ceiling of 989,999. In the modern table it would still be S+, so
 * the test is "the two tables disagree", not "the modern table is silent".
 */
export function isLegacyScore(score: number): boolean {
  if (!Number.isFinite(score)) return false;
  const modern = scoreToRank(score);
  const legacy = legacyScoreToRank(score);
  if (modern === null && legacy === null) return false;
  if (legacy === null) return false;
  return modern !== legacy;
}

function legacyScoreToRank(score: number): ScoreRank | null {
  if (!Number.isFinite(score)) return null;
  for (let i = LEGACY_THRESHOLDS.length - 1; i >= 0; i--) {
    const [lower, rank] = LEGACY_THRESHOLDS[i];
    if (score >= lower) return rank;
  }
  return null;
}