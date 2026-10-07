/**
 * Serialisable request/response contract between the page and the worker.
 *
 * Keeping this in its own module means the page and the worker cannot
 * drift, and the types survive the structured-clone boundary.
 */

import type { MergeResult } from '../core/merge';
import type { Warning } from '../core/merge';

export interface MergeRequest {
  kind: 'merge';
  csvText: string;
  saveText: string;
  injectPlaylogs: boolean;
}

export interface MergeSuccess {
  ok: true;
  /** Serialised merged save, compact. */
  outputText: string;
  /** Structured summary for the report tables. */
  summary: MergeSummary;
}

export interface MergeFailure {
  ok: false;
  message: string;
  stage: 'parse-save' | 'parse-csv' | 'merge';
}

export type MergeResponse = MergeSuccess | MergeFailure;

export interface MergeSummary {
  musicCount: number;
  addedCount: number;
  updatedCount: number;
  playlogsInjected: number;
  playlogsSkippedNoPlayTime: number;
  playlogsSkippedUltima: number;
  warningCount: number;
  warnings: Warning[];
  added: SerializableAdded[];
  updated: SerializableUpdated[];
  skippedNoPlayTime: { musicId: number; level: number; songName: string }[];
  skippedUltima: { musicId: number; level: number; songName: string }[];
  /** Size of the input and output, for the size summary. */
  inputBytes: number;
  outputBytes: number;
}

export interface SerializableAdded {
  musicId: number;
  level: number;
  songName: string;
  scoreMax: number;
  scoreRank: number;
  lamp: number;
  isFullCombo: boolean;
  isAllJustice: boolean;
  fullChain: number;
}

export interface SerializableUpdated {
  musicId: number;
  level: number;
  songName: string;
  changes: { field: string; from: unknown; to: unknown }[];
  scoreMax: number;
  scoreRank: number;
  lamp: number;
  isFullCombo: boolean;
  isAllJustice: boolean;
  fullChain: number;
  playCount: number;
}

export function toSummary(
  result: MergeResult,
  inputBytes: number,
  outputText: string,
): MergeSummary {
  return {
    musicCount: result.data.userMusicDetailList.length,
    addedCount: result.added.length,
    updatedCount: result.updated.length,
    playlogsInjected: result.playlogs.injected,
    playlogsSkippedNoPlayTime: result.playlogs.skippedNoPlayTime.length,
    playlogsSkippedUltima: result.playlogs.skippedUltima.length,
    warningCount: result.warnings.length,
    warnings: result.warnings,
    added: result.added.map((r) => ({
      musicId: r.musicId,
      level: r.level,
      songName: r.songName,
      scoreMax: r.after.scoreMax,
      scoreRank: r.after.scoreRank,
      lamp: r.after.isSuccess,
      isFullCombo: r.after.isFullCombo,
      isAllJustice: r.after.isAllJustice,
      fullChain: r.after.fullChain,
    })),
    updated: result.updated.map((r) => ({
      musicId: r.musicId,
      level: r.level,
      songName: r.songName,
      changes: r.changes,
      scoreMax: r.after.scoreMax,
      scoreRank: r.after.scoreRank,
      lamp: r.after.isSuccess,
      isFullCombo: r.after.isFullCombo,
      isAllJustice: r.after.isAllJustice,
      fullChain: r.after.fullChain,
      playCount: r.after.playCount,
    })),
    skippedNoPlayTime: result.playlogs.skippedNoPlayTime,
    skippedUltima: result.playlogs.skippedUltima,
    inputBytes,
    outputBytes: outputText.length,
  };
}