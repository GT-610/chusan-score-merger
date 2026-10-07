/**
 * End-to-end check on the exact artifact a user downloads.
 *
 * Mirrors what the worker produces: parse the trimmed save, parse the
 * real CSV, merge, then serialise exactly as the worker does. Asserting on
 * the serialised bytes catches anything the in-memory tests would miss,
 * such as an undefined field collapsing to null or NaN becoming null.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvRecords } from '../src/core/csv';
import { indexCsv, merge } from '../src/core/merge';
import { scoreToRank } from '../src/core/constants';
import { byteLength } from '../src/worker/protocol';
import type { SaveData } from '../src/core/types';

const HERE = __dirname;
const csvText = readFileSync(join(HERE, 'fixtures', 'chunithm-scores.csv'), 'utf8');
const saveText = readFileSync(join(HERE, 'fixtures', 'save-sample.json'), 'utf8');

const { records } = parseCsvRecords(csvText);
const index = indexCsv(records);
const save = JSON.parse(saveText) as SaveData;
const result = merge(save, index);
const outputText = JSON.stringify(result.data);

describe('byte accounting', () => {
  it('measures the input in bytes, not UTF-16 code units', () => {
    // The fixture is ASCII, so the two must agree here. This guards the
    // common case against a regression to String.length.
    expect(byteLength(saveText)).toBe(Buffer.byteLength(saveText, 'utf8'));
  });

  it('counts multi-byte characters as their encoded length', () => {
    // One CJK character is one JS character but three UTF-8 bytes.
    const cjk = '少女 PastQ《創造》世界';
    expect(cjk.length).toBeLessThan(byteLength(cjk));
    expect(byteLength(cjk)).toBe(Buffer.byteLength(cjk, 'utf8'));
  });

  it('reports the real size of the merged file', () => {
    expect(byteLength(outputText)).toBe(Buffer.byteLength(outputText, 'utf8'));
  });
});

describe('serialised output', () => {
  const round = JSON.parse(outputText);

  it('is compact, with no indentation to bloat the file', () => {
    expect(outputText).not.toContain('\n');
    expect(outputText).not.toContain('\t');
    // Compact must be no larger than the indented equivalent.
    expect(outputText.length).toBeLessThan(JSON.stringify(result.data, null, 2).length);
  });

  it('round-trips without losing or nulling any field', () => {
    expect(round.userMusicDetailList).toHaveLength(result.data.userMusicDetailList.length);
    for (const rec of round.userMusicDetailList) {
      for (const [k, v] of Object.entries(rec)) {
        expect(v, `field ${k} became ${v}`).not.toBeNull();
        expect(v, `field ${k} is undefined`).not.toBeUndefined();
      }
    }
  });

  it('introduces no NaN, which JSON would silently write as null', () => {
    expect(outputText).not.toContain('null');
  });

  it('emits no unicode escapes, so any present text stays readable', () => {
    // The save itself stores only numeric ids, but a user's export may
    // carry text elsewhere. JSON.stringify escapes only lone surrogates,
    // so the meaningful assertion is that nothing was \u-escaped.
    expect(outputText).not.toContain('\\u');

    // Prove the behaviour directly on the same serialiser.
    const withText = { ...result.data, userName: 'テストプレイヤー' };
    const serialised = JSON.stringify(withText);
    expect(serialised).toContain('テストプレイヤー');
    expect(serialised).not.toContain('\\u');
  });

  it('preserves every other top-level array untouched', () => {
    for (const key of ['userActivityList', 'userCharacterList', 'userItemList',
      'userMapList', 'userCourseList', 'userDuelList', 'userCMissionList',
      'userMateList', 'userLinkedVerseList'] as const) {
      if (save[key] !== undefined) {
        expect(JSON.stringify(round[key]), `array ${key} changed`).toBe(
          JSON.stringify(save[key]),
        );
      }
    }
  });

  it('keeps userData intact', () => {
    expect(JSON.stringify(round.userData)).toBe(JSON.stringify(save.userData));
  });

  it('leaves every record with a rank matching its score', () => {
    for (const rec of round.userMusicDetailList) {
      const derived = scoreToRank(rec.scoreMax);
      if (derived !== null) expect(rec.scoreRank).toBe(derived);
    }
  });

  it('has no duplicate (musicId, level) keys, which the server forbids', () => {
    const seen = new Set<string>();
    for (const rec of round.userMusicDetailList) {
      const k = `${rec.musicId}/${rec.level}`;
      expect(seen.has(k), `duplicate key ${k}`).toBe(false);
      seen.add(k);
    }
  });

  it('writes a complete field set on new records', () => {
    const original = new Set(
      save.userMusicDetailList.map((d: { musicId: number; level: number }) =>
        `${d.musicId}/${d.level}`),
    );
    const expected = [
      'musicId', 'level', 'playCount', 'scoreMax', 'missCount', 'maxComboCount',
      'isFullCombo', 'isAllJustice', 'isSuccess', 'fullChain', 'maxChain',
      'isLock', 'theoryCount', 'ext1', 'scoreRank',
    ];
    const added = round.userMusicDetailList.filter(
      (d: { musicId: number; level: number }) => !original.has(`${d.musicId}/${d.level}`),
    );
    expect(added.length).toBe(25);
    for (const rec of added) {
      expect(Object.keys(rec).sort()).toEqual([...expected].sort());
    }
  });
});