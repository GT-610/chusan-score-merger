/**
 * Regression check against the reference implementation.
 *
 * The original Python merger was run over the same two files during
 * analysis and reported: 25 records added, 37 records updated. Those
 * numbers are reproduced here, which is the strongest available evidence
 * that the rewrite preserves the reference behaviour on real data.
 *
 * The save fixture is trimmed from the real export because the original
 * contains player identifying data.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvRecords } from '../src/core/csv';
import { indexCsv, merge } from '../src/core/merge';
import { scoreToRank } from '../src/core/constants';
import type { SaveData } from '../src/core/types';

const HERE = __dirname;
const csvText = readFileSync(join(HERE, 'fixtures', 'chunithm-scores.csv'), 'utf8');
const saveText = readFileSync(join(HERE, 'fixtures', 'save-sample.json'), 'utf8');

const { records } = parseCsvRecords(csvText);
const save = JSON.parse(saveText) as SaveData;

describe('reference parity', () => {
  const index = indexCsv(records);
  const result = merge(save, index);

  it('adds exactly the records the reference merger added', () => {
    expect(result.added).toHaveLength(25);
  });

  it('updates exactly the records the reference merger updated', () => {
    expect(result.updated).toHaveLength(37);
  });

  it('grows the record list by exactly the added count', () => {
    const before = save.userMusicDetailList.length;
    expect(result.data.userMusicDetailList).toHaveLength(before + 25);
  });

  it('produces no warnings on clean real-world data', () => {
    expect(result.warnings).toEqual([]);
  });

  it('never leaves scoreRank disagreeing with scoreMax', () => {
    for (const rec of result.data.userMusicDetailList) {
      const derived = scoreToRank(rec.scoreMax);
      if (derived === null) continue;
      expect(rec.scoreRank).toBe(derived);
    }
  });

  it('keeps every lamp, combo flag and full chain at or above its original value', () => {
    const before = new Map(
      save.userMusicDetailList.map((d) => [`${d.musicId}/${d.level}`, d]),
    );
    for (const rec of result.data.userMusicDetailList) {
      const key = `${rec.musicId}/${rec.level}`;
      const orig = before.get(key);
      if (!orig) continue;
      expect(rec.isSuccess).toBeGreaterThanOrEqual(orig.isSuccess);
      if (orig.isFullCombo) expect(rec.isFullCombo).toBe(true);
      if (orig.isAllJustice) expect(rec.isAllJustice).toBe(true);
      expect(rec.fullChain).toBeGreaterThanOrEqual(orig.fullChain);
      expect(rec.scoreMax).toBeGreaterThanOrEqual(orig.scoreMax);
      expect(rec.playCount).toBe(orig.playCount);
    }
  });

  it('leaves untouched records byte-identical', () => {
    const changed = new Set(
      [...result.added, ...result.updated].map((r) => `${r.musicId}/${r.level}`),
    );
    const before = new Map(
      save.userMusicDetailList.map((d) => [`${d.musicId}/${d.level}`, JSON.stringify(d)]),
    );
    for (const rec of result.data.userMusicDetailList) {
      const key = `${rec.musicId}/${rec.level}`;
      if (changed.has(key) || !before.has(key)) continue;
      expect(JSON.stringify(rec)).toBe(before.get(key));
    }
  });
});