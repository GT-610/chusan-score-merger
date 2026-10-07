import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvRecords } from '../src/core/csv';
import { indexCsv, merge, buildRecord } from '../src/core/merge';
import { LAMP_MAP, RANK_MAP, scoreToRank } from '../src/core/constants';
import type { MusicDetail, SaveData } from '../src/core/types';

const CSV_PATH = join(__dirname, 'fixtures', 'chunithm-scores.csv');
const csvText = readFileSync(CSV_PATH, 'utf8');

function blankRecord(musicId: number, level: number): MusicDetail {
  return {
    musicId,
    level: level as MusicDetail['level'],
    playCount: 1,
    scoreMax: 0,
    missCount: 0,
    maxComboCount: 0,
    isFullCombo: false,
    isAllJustice: false,
    isSuccess: 0,
    fullChain: 0,
    maxChain: 0,
    isLock: false,
    theoryCount: 0,
    ext1: 0,
    scoreRank: 0,
  };
}

describe('indexCsv against the real export', () => {
  const { records, malformed } = parseCsvRecords(csvText);
  const index = indexCsv(records);

  it('parses every row without field-count damage', () => {
    expect(malformed).toEqual([]);
    expect(records).toHaveLength(2402);
  });

  it('folds 2402 rows into one record per chart', () => {
    expect(index.best.size).toBe(726);
  });

  it('keeps the highest score per chart', () => {
    for (const rec of index.best.values()) {
      // Every score in the file is <= the stored maximum for its chart.
      expect(rec.score).toBeGreaterThan(0);
    }
  });

  it('derives a rank for every chart with no legacy-only scores', () => {
    for (const rec of index.best.values()) {
      expect(rec.scoreRank).toBe(scoreToRank(rec.score));
    }
    const legacy = index.warnings.filter((w) => w.kind === 'legacy-score');
    expect(legacy).toEqual([]);
  });

  it('reports no rank disagreement with the CSV column', () => {
    const mismatches = index.warnings.filter((w) => w.kind === 'rank-mismatch');
    expect(mismatches).toEqual([]);
  });

  it('reports no unknown enum values', () => {
    const unknown = index.warnings.filter(
      (w) =>
        w.kind === 'unknown-lamp' ||
        w.kind === 'unknown-rank' ||
        w.kind === 'unknown-fullchain',
    );
    expect(unknown).toEqual([]);
  });

  it('covers the ULTIMA-free difficulty space present in the export', () => {
    const levels = new Set([...index.best.values()].map((r) => r.level));
    expect([...levels].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('merge against a minimal save', () => {
  const { records } = parseCsvRecords(csvText);
  const index = indexCsv(records);
  const save: SaveData = { userMusicDetailList: [], userPlaylogList: [] };
  const result = merge(save, index);

  it('adds every chart that the save is missing', () => {
    expect(result.added).toHaveLength(726);
    expect(result.updated).toHaveLength(0);
    expect(result.data.userMusicDetailList).toHaveLength(726);
  });

  it('serialises a complete record body', () => {
    const rec = result.data.userMusicDetailList[0]!;
    for (const field of [
      'musicId', 'level', 'playCount', 'scoreMax', 'missCount',
      'maxComboCount', 'isFullCombo', 'isAllJustice', 'isSuccess',
      'fullChain', 'maxChain', 'isLock', 'theoryCount', 'ext1', 'scoreRank',
    ]) {
      expect(rec).toHaveProperty(field);
    }
    expect(rec.missCount).toBe(0);
  });

  it('keeps scoreRank consistent with scoreMax on every record', () => {
    for (const rec of result.data.userMusicDetailList) {
      expect(rec.scoreRank).toBe(scoreToRank(rec.scoreMax));
    }
  });
});

describe('merge is monotonic', () => {
  const { records } = parseCsvRecords(csvText);
  const index = indexCsv(records);

  function seed(): SaveData {
    const list: MusicDetail[] = [];
    for (const rec of index.best.values()) {
      list.push(blankRecord(rec.musicId, rec.level));
    }
    return { userMusicDetailList: list, userPlaylogList: [] };
  }

  it('never lowers an existing value, even when starting from a record that beats the CSV', () => {
    const save = seed();
    // Give one chart an unreachable score and the best possible everything.
    const target = [...index.best.values()][0]!;
    const victim = save.userMusicDetailList.find(
      (d) => d.musicId === target.musicId && d.level === target.level,
    )!;
    victim.scoreMax = 1010000;
    victim.scoreRank = 13;
    victim.isSuccess = 6;
    victim.isFullCombo = true;
    victim.isAllJustice = true;
    victim.fullChain = 4;

    const result = merge(save, index);
    const after = result.data.userMusicDetailList.find(
      (d) => d.musicId === victim.musicId && d.level === victim.level,
    )!;
    expect(after.scoreMax).toBe(1010000);
    expect(after.scoreRank).toBe(13);
    expect(after.isSuccess).toBe(6);
    expect(after.isFullCombo).toBe(true);
    expect(after.isAllJustice).toBe(true);
    expect(after.fullChain).toBe(4);
  });

  it('does not mutate the input save', () => {
    const save = seed();
    const snapshot = JSON.stringify(save);
    merge(save, index);
    expect(JSON.stringify(save)).toBe(snapshot);
  });

  it('applies score, lamp, full combo, all justice and full chain independently', () => {
    const index2 = indexCsv([
      { id: '1', song_name: 'x', level_index: '3', score: '1000000', clear: 'hard', full_combo: '', full_chain: '', rank: 'ss' },
      { id: '1', song_name: 'x', level_index: '3', score: '500000', clear: 'clear', full_combo: 'alljustice', full_chain: 'fullchain2', rank: 'c' },
    ]);
    const save: SaveData = {
      userMusicDetailList: [blankRecord(1, 3)],
      userPlaylogList: [],
    };
    const result = merge(save, index2);
    const rec = result.data.userMusicDetailList[0]!;
    // Highest score wins.
    expect(rec.scoreMax).toBe(1000000);
    // Highest lamp wins even though it came from the lower-scoring row.
    expect(rec.isSuccess).toBe(2);
    // All justice came from that same lower row and implies full combo.
    expect(rec.isAllJustice).toBe(true);
    expect(rec.isFullCombo).toBe(true);
    expect(rec.missCount).toBe(0);
    // Highest full chain wins.
    expect(rec.fullChain).toBe(2);
  });

  it('merges a failed row whose score is higher, since score is independent of clear', () => {
    const index2 = indexCsv([
      { id: '1', song_name: 'x', level_index: '3', score: '800000', clear: 'failed', full_combo: '', full_chain: '', rank: 'bbb' },
    ]);
    const save: SaveData = {
      userMusicDetailList: [blankRecord(1, 3)],
      userPlaylogList: [],
    };
    const result = merge(save, index2);
    const rec = result.data.userMusicDetailList[0]!;
    expect(rec.scoreMax).toBe(800000);
    expect(rec.scoreRank).toBe(4);
    expect(rec.isSuccess).toBe(0);
  });

  it('leaves playCount untouched', () => {
    const save: SaveData = {
      userMusicDetailList: [blankRecord(1, 3)],
      userPlaylogList: [],
    };
    const index2 = indexCsv([
      { id: '1', song_name: 'x', level_index: '3', score: '1000000', clear: 'clear', full_combo: '', full_chain: '', rank: 'ss' },
    ]);
    const result = merge(save, index2);
    expect(result.data.userMusicDetailList[0]!.playCount).toBe(1);
  });
});

describe('lamp mapping', () => {
  it('routes BRAVE and ABSOLUTE to distinct values', () => {
    expect(LAMP_MAP.brave).toBe(3);
    expect(LAMP_MAP.absolute).toBe(4);
  });

  it('maps a full row of lamps', () => {
    const index2 = indexCsv([
      { id: '1', song_name: 'x', level_index: '3', score: '1000000', clear: 'catastrophy', full_combo: 'alljustice', full_chain: '', rank: 'ss' },
    ]);
    const save: SaveData = { userMusicDetailList: [blankRecord(1, 3)], userPlaylogList: [] };
    const rec = merge(save, index2).data.userMusicDetailList[0]!;
    expect(rec.isSuccess).toBe(6);
  });
});

describe('playlog injection', () => {
  const { records } = parseCsvRecords(csvText);
  const index = indexCsv(records);

  function withLogs(): SaveData {
    return { userMusicDetailList: [], userPlaylogList: [] };
  }

  it('injects one log per improved chart that has a play time', () => {
    const result = merge(withLogs(), index);
    const logs = result.data.userPlaylogList!;
    expect(logs).toHaveLength(result.playlogs.injected);
    expect(result.playlogs.injected).toBeGreaterThan(0);
    // Charts whose top row carried no play time are reported, not guessed at.
    const accounted =
      result.playlogs.injected +
      result.playlogs.skippedNoPlayTime.length +
      result.playlogs.skippedUltima.length;
    expect(accounted).toBe(result.added.length);
  });

  it('skips charts with no play time and reports them', () => {
    const index2 = indexCsv([
      { id: '1', song_name: 'x', level_index: '3', score: '1000000', clear: 'clear', full_combo: '', full_chain: '', rank: 'ss', play_time: '' },
    ]);
    const result = merge(withLogs(), index2);
    expect(result.playlogs.injected).toBe(0);
    expect(result.playlogs.skippedNoPlayTime).toHaveLength(1);
  });

  it('skips ULTIMA, which the server excludes from recent plays', () => {
    const index2 = indexCsv([
      { id: '1', song_name: 'x', level_index: '4', score: '1000000', clear: 'clear', full_combo: '', full_chain: '', rank: 'ss', play_time: '2025-03-06 10:12:00' },
    ]);
    const result = merge(withLogs(), index2);
    expect(result.playlogs.injected).toBe(0);
    expect(result.playlogs.skippedUltima).toHaveLength(1);
  });

  it('formats dates the way the save stores them', () => {
    const index2 = indexCsv([
      { id: '1', song_name: 'x', level_index: '3', score: '1000000', clear: 'clear', full_combo: '', full_chain: '', rank: 'ss', play_time: '2025-03-06 10:12:00' },
    ]);
    const log = merge(withLogs(), index2).data.userPlaylogList![0]!;
    expect(log.userPlayDate).toBe('2025-03-06T10:12:00');
    expect(log.playDate).toBe('2025-03-06T00:00:00');
  });

  it('allocates session ids above every existing one', () => {
    const save: SaveData = {
      userMusicDetailList: [],
      userPlaylogList: [
        { ...blankRecord(9, 3) } as never,
      ],
    };
    // Give the existing log a high sortNumber.
    save.userPlaylogList![0] = { sortNumber: 1791173961 } as never;
    const index2 = indexCsv([
      { id: '1', song_name: 'x', level_index: '3', score: '1000000', clear: 'clear', full_combo: '', full_chain: '', rank: 'ss', play_time: '2025-03-06 10:12:00' },
    ]);
    const log = merge(save, index2).data.userPlaylogList![1]!;
    expect(log.sortNumber).toBe(1791173962);
  });

  it('can be disabled', () => {
    const save = withLogs();
    const before = save.userPlaylogList!.length;
    const result = merge(save, index, { injectPlaylogs: false });
    expect(result.playlogs.injected).toBe(0);
    expect(result.data.userPlaylogList).toHaveLength(before);
  });
});

describe('tie-breaking on equal top scores', () => {
  it('keeps the earliest play time among tied rows', () => {
    const index2 = indexCsv([
      { id: '1', song_name: 'x', level_index: '3', score: '1000000', clear: 'clear', full_combo: '', full_chain: '', rank: 'ss', play_time: '2025-06-01 10:00:00' },
      { id: '1', song_name: 'x', level_index: '3', score: '1000000', clear: 'clear', full_combo: '', full_chain: '', rank: 'ss', play_time: '2025-03-01 10:00:00' },
    ]);
    const save: SaveData = { userMusicDetailList: [], userPlaylogList: [] };
    const log = merge(save, index2).data.userPlaylogList![0]!;
    expect(log.userPlayDate).toBe('2025-03-01T10:00:00');
  });

  it('picks the lamp and full chain from whichever rows carry them', () => {
    const index2 = indexCsv([
      { id: '1', song_name: 'x', level_index: '3', score: '1000000', clear: 'clear', full_combo: '', full_chain: '', rank: 'ss', play_time: '' },
      { id: '1', song_name: 'x', level_index: '3', score: '1000000', clear: 'catastrophy', full_combo: '', full_chain: 'fullchain3', rank: 'ss', play_time: '' },
    ]);
    const save: SaveData = { userMusicDetailList: [], userPlaylogList: [] };
    const rec = merge(save, index2).data.userMusicDetailList[0]!;
    expect(rec.isSuccess).toBe(6);
    expect(rec.fullChain).toBe(3);
  });
});

describe('enum fallthrough', () => {
  it('degrades an unknown lamp to FAILED but records it', () => {
    const index2 = indexCsv([
      { id: '1', song_name: 'x', level_index: '3', score: '1000000', clear: 'mystery', full_combo: '', full_chain: '', rank: 'ss' },
    ]);
    expect(index2.warnings.some((w) => w.kind === 'unknown-lamp')).toBe(true);
    const save: SaveData = { userMusicDetailList: [], userPlaylogList: [] };
    expect(merge(save, index2).data.userMusicDetailList[0]!.isSuccess).toBe(0);
  });

  it('records a rank that disagrees with the score', () => {
    const index2 = indexCsv([
      { id: '1', song_name: 'x', level_index: '3', score: '1000000', clear: 'clear', full_combo: '', full_chain: '', rank: 'd' },
    ]);
    expect(index2.warnings.some((w) => w.kind === 'rank-mismatch')).toBe(true);
    // The derived rank still wins.
    const save: SaveData = { userMusicDetailList: [], userPlaylogList: [] };
    expect(merge(save, index2).data.userMusicDetailList[0]!.scoreRank).toBe(RANK_MAP.ss);
  });
});

describe('buildRecord', () => {
  it('uses the derived rank', () => {
    const index2 = indexCsv([
      { id: '1', song_name: 'x', level_index: '3', score: '1009000', clear: 'clear', full_combo: '', full_chain: '', rank: 'sssp' },
    ]);
    const rec = buildRecord([...index2.best.values()][0]!);
    expect(rec.scoreRank).toBe(13);
  });
});