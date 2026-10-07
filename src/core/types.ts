/**
 * CHUNITHM save-data type definitions.
 *
 * Field sets and semantics are derived from the ALLNET protocol entity
 * definitions (aqua `UserMusicDetail` / `UserPlaylog`), which serialise a
 * fixed field set. That matters: omitting a field is worse than writing a
 * zero, because the server models these columns as non-null ints.
 */

/** Difficulty index. 4 = ULTIMA, 5 = WORLD'S END (not ULTIMA). */
export type Level = 0 | 1 | 2 | 3 | 4 | 5;

/** Clear lamp. 5 = ABSOLUTE+, a LUMINOUS-era value that VERSE removed. */
export type Lamp = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** FULL CHAIN grade; higher is stronger. */
export type FullChain = 0 | 1 | 2 | 3 | 4;

/** Score rank, 0 = D .. 13 = SSS+ (SSSP). */
export type ScoreRank = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

/**
 * One best-score record. The server enforces a unique constraint on
 * (musicId, level), so entries are only ever updated, never duplicated.
 */
export interface MusicDetail {
  musicId: number;
  level: Level;
  playCount: number;
  scoreMax: number;
  missCount: number;
  maxComboCount: number;
  isFullCombo: boolean;
  isAllJustice: boolean;
  isSuccess: Lamp;
  fullChain: FullChain;
  maxChain: number;
  isLock: boolean;
  theoryCount: number;
  ext1: number;
  scoreRank: ScoreRank;
}

/**
 * One played song within a session. `sortNumber` is a session id, not a
 * timestamp — the three songs of a single credit share one value, which is
 * why the entry also carries `playedMusicLevel1..3`.
 */
export interface Playlog {
  romVersion: string;
  orderId: number;
  sortNumber: number;
  placeId: number;
  playDate: string;
  userPlayDate: string;
  musicId: number;
  level: Level;
  customId: number;
  playedUserId1: number;
  playedUserId2: number;
  playedUserId3: number;
  playedUserName1: string;
  playedUserName2: string;
  playedUserName3: string;
  playedMusicLevel1: number;
  playedMusicLevel2: number;
  playedMusicLevel3: number;
  playedCustom1: number;
  playedCustom2: number;
  playedCustom3: number;
  track: number;
  score: number;
  rank: ScoreRank;
  maxCombo: number;
  maxChain: number;
  rateTap: number;
  rateHold: number;
  rateSlide: number;
  rateAir: number;
  rateFlick: number;
  judgeGuilty: number;
  judgeAttack: number;
  judgeJustice: number;
  judgeCritical: number;
  judgeHeaven: number;
  eventId: number;
  playerRating: number;
  fullChainKind: number;
  characterId: number;
  charaIllustId: number;
  skillId: number;
  playKind: number;
  skillLevel: number;
  skillEffect: number;
  placeName: string;
  commonId: number;
  regionId: number;
  machineType: number;
  ticketId: number;
  monthPoint: number;
  eventPoint: number;
  isNewRecord: boolean;
  isFullCombo: boolean;
  isAllJustice: boolean;
  isContinue: boolean;
  isFreeToPlay: boolean;
  isClear: boolean;
}

export interface SaveData {
  gameId?: string;
  userData?: Record<string, unknown>;
  userMusicDetailList: MusicDetail[];
  userPlaylogList?: Playlog[];
  [key: string]: unknown;
}

/** Identity of a song chart within a save file. */
export interface RecordKey {
  musicId: number;
  level: Level;
}

export function keyOf(k: RecordKey): string {
  return `${k.musicId}/${k.level}`;
}