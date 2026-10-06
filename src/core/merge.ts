/**
 * Merge kernel.
 *
 * Pure functions only: no IO, no clock, no randomness. Everything the merge
 * decides is derived from the two inputs, which keeps it directly unit
 * testable.
 *
 * The governing rule is monotonicity — score, lamp, FULL COMBO, ALL
 * JUSTICE and FULL CHAIN each independently keep whichever value is
 * higher. Nothing can ever downgrade an existing record.
 */

import {
  FULL_CHAIN_MAP,
  LAMP_MAP,
  LEVEL_NAMES,
  LEVEL_ULTIMA,
  RANK_MAP,
  RANK_NAMES,
  isLegacyScore,
  scoreToRank,
} from './constants';
import type {
  CsvRow,
  FullChain,
  Lamp,
  Level,
  MusicDetail,
  Playlog,
  SaveData,
  ScoreRank,
} from './types';
import { keyOf } from './types';

/** Collapse every CSV row for one chart into its best record. */
export interface BestRecord {
  musicId: number;
  level: Level;
  /** Highest score seen for this chart. */
  score: number;
  /** Rank derived from `score`; the CSV column is only cross-checked. */
  scoreRank: ScoreRank | null;
  /** Highest lamp seen. */
  lamp: Lamp;
  /** True if any row for this chart was an all-justice critical. */
  aj: boolean;
  /** True if any row was a full combo. */
  fc: boolean;
  /** Highest FULL CHAIN grade seen. */
  fullChain: FullChain;
  /** Name as printed in the CSV, for display. */
  songName: string;
  /** Earliest usable play time across rows, for playlog injection. */
  playTime: string | null;
  /** The CSV rank string that disagreed with the derived rank, if any. */
  rankMismatch: string | null;
}

export type WarningKind =
  | 'unknown-lamp'
  | 'unknown-rank'
  | 'unknown-fullchain'
  | 'rank-mismatch'
  | 'bad-row'
  | 'legacy-score';

export interface Warning {
  kind: WarningKind;
  musicId: number | null;
  level: Level | null;
  songName: string | null;
  detail: string;
}

export interface CsvIndex {
  best: Map<string, BestRecord>;
  warnings: Warning[];
  rowCount: number;
  skippedRows: number;
  malformedRows: number[];
}

/** Normalise "2025-03-06 10:12:00" into the save's wall-clock format. */
function normaliseTimestamp(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(raw);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

/** The date portion of a normalised timestamp, at midnight. */
function midnightOf(normalised: string): string {
  return `${normalised.slice(0, 10)}T00:00:00`;
}

/**
 * Fold CSV rows into one best record per (musicId, level).
 *
 * `level_index` is the stable internal chart id and is the only column
 * trusted for difficulty. The human-readable `level` text must not be used
 * to derive it: the two diverge because charts are re-rated between game
 * versions, and measured against a real save 16 songs disagreed outright
 * (e.g. CSV said index 2 / "10" where the save held level 3).
 */
export function indexCsv(rows: Record<string, string>[]): CsvIndex {
  const best = new Map<string, BestRecord>();
  const warnings: Warning[] = [];
  const malformedRows: number[] = [];
  let rowCount = 0;
  let skippedRows = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as Record<string, string>;
    rowCount++;

    const musicId = toInt(row.id);
    const level = toInt(row.level_index);
    const score = toInt(row.score);

    if (musicId === null || level === null || score === null) {
      skippedRows++;
      malformedRows.push(i + 2);
      warnings.push({
        kind: 'bad-row',
        musicId: musicId ?? null,
        level: (level as Level | null) ?? null,
        songName: row.song_name ?? null,
        detail: `row ${i + 2}: could not parse id/level_index/score`,
      });
      continue;
    }

    const lvl = level as Level;
    const songName = row.song_name ?? '';
    const key = keyOf({ musicId, level: lvl });

    const clearText = (row.clear ?? '').toLowerCase();
    const lampValue = lookupEnum(LAMP_MAP, clearText);
    let lamp: Lamp;
    if (lampValue !== undefined) {
      lamp = lampValue;
    } else {
      lamp = 0;
      if (clearText !== '') {
        warnings.push({
          kind: 'unknown-lamp',
          musicId,
          level: lvl,
          songName,
          detail: `row ${i + 2}: unknown clear "${row.clear}" -> FAILED (0)`,
        });
      }
    }

    // AJ and FC both come from the `full_combo` column: "alljustice" is a
    // superstring that also satisfies the FC test.
    const fcCol = (row.full_combo ?? '').trim().toLowerCase();
    const aj = fcCol.includes('alljustice');
    const fc = fcCol.length > 0 || aj;

    const chainText = (row.full_chain ?? '').trim().toLowerCase();
    const chainValue = lookupEnum(FULL_CHAIN_MAP, chainText);
    let fullChain: FullChain = 0;
    if (chainValue !== undefined) {
      fullChain = chainValue;
    } else if (chainText !== '') {
      warnings.push({
        kind: 'unknown-fullchain',
        musicId,
        level: lvl,
        songName,
        detail: `row ${i + 2}: unknown full_chain "${row.full_chain}" -> 0`,
      });
    }

    const derived = scoreToRank(score);
    const rankText = (row.rank ?? '').toLowerCase();
    const csvRank = RANK_MAP[rankText];

    let rankMismatch: string | null = null;
    if (csvRank !== undefined && derived !== null && csvRank !== derived) {
      rankMismatch = row.rank ?? '';
      warnings.push({
        kind: 'rank-mismatch',
        musicId,
        level: lvl,
        songName,
        detail:
          `row ${i + 2}: CSV rank "${row.rank}" (${csvRank}) ` +
          `disagrees with ${score} -> ${derived} (${RANK_NAMES[derived]})`,
      });
    }
    if (rankText !== '' && csvRank === undefined) {
      warnings.push({
        kind: 'unknown-rank',
        musicId,
        level: lvl,
        songName,
        detail: `row ${i + 2}: unknown rank "${row.rank}"`,
      });
    }
    if (derived === null && isLegacyScore(score)) {
      warnings.push({
        kind: 'legacy-score',
        musicId,
        level: lvl,
        songName,
        detail:
          `row ${i + 2}: score ${score} fits only the pre-VERSE ` +
          `threshold table; no current rank could be derived`,
      });
    }

    const playTime = normaliseTimestamp((row.play_time ?? '').trim());

    const existing = best.get(key);
    if (!existing) {
      best.set(key, {
        musicId,
        level: lvl,
        score,
        scoreRank: derived,
        lamp,
        aj,
        fc,
        fullChain,
        songName,
        playTime,
        rankMismatch,
      });
      continue;
    }

    // Take the highest of each dimension independently.
    if (score > existing.score) {
      existing.score = score;
      existing.scoreRank = derived;
      existing.rankMismatch = rankMismatch;
      existing.songName = songName;
    } else if (rankMismatch === null) {
      existing.rankMismatch ??= rankMismatch;
    }
    if (lamp > existing.lamp) existing.lamp = lamp;
    if (aj) existing.aj = true;
    if (fc) existing.fc = true;
    if (fullChain > existing.fullChain) existing.fullChain = fullChain;

    // Keep the earliest usable play time. Where several rows tie on the
    // top score, the earliest timestamp is the closest thing the export
    // offers to "when this record was set".
    if (playTime !== null) {
      if (existing.playTime === null || playTime < existing.playTime) {
        existing.playTime = playTime;
      }
    }
  }

  return { best, warnings, rowCount, skippedRows, malformedRows };
}

/**
 * Own-key enum lookup.
 *
 * Deliberately not `key in map`: the `in` operator walks the prototype
 * chain, so inherited names such as `toString` would resolve to a
 * function and be written into the save as a bogus value.
 */
function lookupEnum<T>(map: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(map, key)
    ? map[key]
    : undefined;
}

function toInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const t = raw.trim();
  if (t === '') return null;
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number.parseInt(t, 10);
  return Number.isSafeInteger(n) ? n : null;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface AddedRecord {
  musicId: number;
  level: Level;
  songName: string;
  after: MusicDetail;
}

export interface UpdatedRecord {
  musicId: number;
  level: Level;
  songName: string;
  before: MusicDetail;
  after: MusicDetail;
  changes: FieldChange[];
}

export interface MergeResult {
  data: SaveData;
  added: AddedRecord[];
  updated: UpdatedRecord[];
  warnings: Warning[];
  csv: CsvIndex;
  playlogs: PlaylogReport;
}

export interface MergeOptions {
  /** Inject playlog entries for charts whose score improved. Default true. */
  injectPlaylogs?: boolean;
}

/**
 * Build a complete new-record body.
 *
 * Every field is written, including `missCount: 0`. The server serialises
 * a fixed field set and models these as non-null ints, so an omitted field
 * is worse than a zero.
 */
export function buildRecord(best: BestRecord): MusicDetail {
  return {
    musicId: best.musicId,
    level: best.level,
    playCount: 1,
    scoreMax: best.score,
    // Note: playCount is intentionally 1, not a guess at how many times the
    // chart was actually played. Inflating it would misrepresent play
    // history that this tool has no way to know.
    missCount: 0,
    maxComboCount: 0,
    isFullCombo: best.fc,
    isAllJustice: best.aj,
    isSuccess: best.lamp,
    fullChain: best.fullChain,
    maxChain: 0,
    isLock: false,
    theoryCount: 0,
    ext1: 0,
    scoreRank: (best.scoreRank ?? 0) as ScoreRank,
  };
}

export function merge(
  save: SaveData,
  index: CsvIndex,
  options: MergeOptions = {},
): MergeResult {
  const injectPlaylogs = options.injectPlaylogs ?? true;

  const data: SaveData = structuredCloneSave(save);
  const list = data.userMusicDetailList;

  const byKey = new Map<string, MusicDetail>();
  for (const item of list) {
    byKey.set(keyOf({ musicId: item.musicId, level: item.level }), item);
  }

  const added: AddedRecord[] = [];
  const updated: UpdatedRecord[] = [];

  for (const best of index.best.values()) {
    const key = keyOf({ musicId: best.musicId, level: best.level });
    const current = byKey.get(key);

    if (!current) {
      const entry = buildRecord(best);
      list.push(entry);
      byKey.set(key, entry);
      added.push({
        musicId: best.musicId,
        level: best.level,
        songName: best.songName,
        after: entry,
      });
      continue;
    }

    const before: MusicDetail = { ...current };
    const changes: FieldChange[] = [];

    // Score, and the rank that follows from it.
    if (best.score > current.scoreMax) {
      if (current.scoreMax !== best.score) {
        changes.push({ field: 'scoreMax', from: current.scoreMax, to: best.score });
      }
      current.scoreMax = best.score;
    }
    // The rank is a function of the score, never of the CSV column. This
    // keeps scoreMax and scoreRank from drifting apart.
    const derived = scoreToRank(current.scoreMax);
    if (derived !== null && current.scoreRank !== derived) {
      changes.push({ field: 'scoreRank', from: current.scoreRank, to: derived });
      current.scoreRank = derived;
    }

    // Lamp: keep whichever is higher. A FAILED row with a higher score is
    // still merged — score and lamp are independent dimensions.
    if (best.lamp > current.isSuccess) {
      changes.push({ field: 'isSuccess', from: current.isSuccess, to: best.lamp });
      current.isSuccess = best.lamp;
    }

    if (best.fc && !current.isFullCombo) {
      changes.push({ field: 'isFullCombo', from: current.isFullCombo, to: true });
      current.isFullCombo = true;
      current.missCount = 0;
    }

    // An all-justice critical implies a full combo.
    if (best.aj && !current.isAllJustice) {
      changes.push({ field: 'isAllJustice', from: current.isAllJustice, to: true });
      current.isAllJustice = true;
      if (!current.isFullCombo) {
        changes.push({ field: 'isFullCombo', from: false, to: true });
        current.isFullCombo = true;
      }
      current.missCount = 0;
    }

    if (best.fullChain > current.fullChain) {
      changes.push({ field: 'fullChain', from: current.fullChain, to: best.fullChain });
      current.fullChain = best.fullChain;
    }

    // playCount is deliberately left untouched: this tool cannot know how
    // many times a chart was really played, and inventing a count would
    // misreport real play history.

    if (changes.length > 0) {
      updated.push({
        musicId: best.musicId,
        level: best.level,
        songName: best.songName,
        before,
        after: current,
        changes,
      });
    }
  }

  const emptyReport: PlaylogReport = {
    injected: 0,
    skippedNoPlayTime: [],
    skippedUltima: [],
  };
  const playlogs = injectPlaylogs
    ? injectPlaylogsInto(data, [...added, ...updated], index)
    : emptyReport;

  return {
    data,
    added,
    updated,
    warnings: index.warnings,
    csv: index,
    playlogs,
  };
}

/**
 * Deep-clone only what the merge mutates.
 *
 * A full `structuredClone` of a 3.4 MB save costs tens of milliseconds and
 * copies two thousand playlogs we are about to walk anyway. Records are
 * cloned individually so the caller's object is never aliased.
 */
function structuredCloneSave(save: SaveData): SaveData {
  return {
    ...save,
    userMusicDetailList: save.userMusicDetailList.map((d) => ({ ...d })),
    ...(save.userPlaylogList ? { userPlaylogList: save.userPlaylogList.slice() } : {}),
  };
}

/**
 * The template used for an injected playlog.
 *
 * Mirrors the field set the server serialises. Values that describe the
 * venue, the skill, or the per-note judgement breakdown are left at zero:
 * this export has no such data, and a plausible-looking fabrication would
 * be worse than an honest zero.
 */
function buildPlaylog(
  best: BestRecord,
  playTime: string,
  sortNumber: number,
): Playlog {
  return {
    romVersion: '2.27.00',
    orderId: 0,
    sortNumber,
    placeId: 0,
    playDate: midnightOf(playTime),
    userPlayDate: playTime,
    musicId: best.musicId,
    level: best.level,
    customId: 0,
    playedUserId1: 0,
    playedUserId2: 0,
    playedUserId3: 0,
    playedUserName1: '',
    playedUserName2: '',
    playedUserName3: '',
    playedMusicLevel1: 0,
    playedMusicLevel2: 0,
    playedMusicLevel3: 0,
    playedCustom1: 0,
    playedCustom2: 0,
    playedCustom3: 0,
    track: 1,
    score: best.score,
    rank: (best.scoreRank ?? 0) as ScoreRank,
    maxCombo: 0,
    maxChain: 0,
    rateTap: 0,
    rateHold: 0,
    rateSlide: 0,
    rateAir: 0,
    rateFlick: 0,
    judgeGuilty: 0,
    judgeAttack: 0,
    judgeJustice: 0,
    judgeCritical: 0,
    judgeHeaven: 0,
    eventId: -1,
    playerRating: 0,
    fullChainKind: 0,
    characterId: 0,
    charaIllustId: 0,
    skillId: 0,
    playKind: 0,
    skillLevel: 0,
    skillEffect: 0,
    placeName: '',
    commonId: 0,
    regionId: 0,
    machineType: 0,
    ticketId: -1,
    monthPoint: 0,
    eventPoint: 0,
    isNewRecord: true,
    isFullCombo: best.fc,
    isAllJustice: best.aj,
    isContinue: false,
    isFreeToPlay: false,
    isClear: best.lamp > 0,
  };
}

export interface PlaylogReport {
  injected: number;
  /** Charts improved but skipped because the CSV had no play time. */
  skippedNoPlayTime: { musicId: number; level: Level; songName: string }[];
  /** Charts skipped because ULTIMA never appears in recent plays. */
  skippedUltima: { musicId: number; level: Level; songName: string }[];
}

function injectPlaylogsInto(
  data: SaveData,
  touched: (AddedRecord | UpdatedRecord)[],
  index: CsvIndex,
): PlaylogReport {
  const report: PlaylogReport = {
    injected: 0,
    skippedNoPlayTime: [],
    skippedUltima: [],
  };

  const logs = data.userPlaylogList;
  if (!logs) return report;

  let nextSort = logs.reduce((m, l) => Math.max(m, l.sortNumber ?? 0), 0) + 1;

  for (const rec of touched) {
    const best = index.best.get(keyOf({ musicId: rec.musicId, level: rec.level }));
    if (!best) continue;

    if (rec.level === LEVEL_ULTIMA) {
      report.skippedUltima.push({
        musicId: rec.musicId,
        level: rec.level,
        songName: rec.songName,
      });
      continue;
    }
    if (best.playTime === null) {
      report.skippedNoPlayTime.push({
        musicId: rec.musicId,
        level: rec.level,
        songName: rec.songName,
      });
      continue;
    }

    logs.push(buildPlaylog(best, best.playTime, nextSort));
    nextSort++;
    report.injected++;
  }

  return report;
}

/** Human-readable summary line for a level index. */
export function levelLabel(level: Level): string {
  return LEVEL_NAMES[level] ?? `LEVEL ${level}`;
}

export function lampLabel(lamp: Lamp): string {
  return LAMP_NAMES[lamp] ?? `LAMP ${lamp}`;
}