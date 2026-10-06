import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvRecords, stripBom } from '../src/core/csv';
import {
  isLegacyScore,
  LAMP_MAP,
  RANK_MAP,
  scoreToRank,
} from '../src/core/constants';

describe('scoreToRank', () => {
  it('maps each lower bound to its rank', () => {
    expect(scoreToRank(0)).toBe(0);
    expect(scoreToRank(499999)).toBe(0);
    expect(scoreToRank(500000)).toBe(1);
    expect(scoreToRank(975000)).toBe(8);
    expect(scoreToRank(989999)).toBe(8);
    expect(scoreToRank(990000)).toBe(9);
    expect(scoreToRank(1000000)).toBe(10);
    expect(scoreToRank(1005000)).toBe(11);
    expect(scoreToRank(1007500)).toBe(12);
    expect(scoreToRank(1009000)).toBe(13);
    expect(scoreToRank(1010000)).toBe(13);
  });

  it('rejects values outside the known range', () => {
    expect(scoreToRank(-1)).toBeNull();
    expect(scoreToRank(1010001)).toBeNull();
    expect(scoreToRank(Number.NaN)).toBeNull();
  });

  it('never decreases as score increases', () => {
    let prev = -1;
    for (let s = 0; s <= 1010000; s += 97) {
      const r = scoreToRank(s);
      expect(r).not.toBeNull();
      expect(r as number).toBeGreaterThanOrEqual(prev);
      prev = r as number;
    }
  });
});

describe('isLegacyScore', () => {
  it('flags scores that only fit the pre-VERSE table', () => {
    // 995,000 was SP on the old 11-grade table but exceeds S on the new one.
    expect(isLegacyScore(995000)).toBe(true);
    expect(isLegacyScore(1006000)).toBe(true);
  });

  it('does not flag ordinary modern scores', () => {
    expect(isLegacyScore(1000000)).toBe(false);
    expect(isLegacyScore(975000)).toBe(false);
  });
});

describe('LAMP_MAP', () => {
  it('covers every lamp grade including the withdrawn ABSOLUTE+', () => {
    expect(LAMP_MAP.failed).toBe(0);
    expect(LAMP_MAP.clear).toBe(1);
    expect(LAMP_MAP.hard).toBe(2);
    expect(LAMP_MAP.brave).toBe(3);
    expect(LAMP_MAP.absolute).toBe(4);
    expect(LAMP_MAP.absolutep).toBe(5);
    expect(LAMP_MAP['catastrophe']).toBe(6);
  });
});

describe('RANK_MAP', () => {
  it('maps both sp-style and plus-style spellings', () => {
    expect(RANK_MAP.sp).toBe(9);
    expect(RANK_MAP['s+']).toBe(9);
    expect(RANK_MAP.ssp).toBe(11);
    expect(RANK_MAP['ss+']).toBe(11);
    expect(RANK_MAP.sssp).toBe(13);
    expect(RANK_MAP['sss+']).toBe(13);
  });

  it('agrees with scoreToRank across every grade boundary', () => {
    const bounds: Record<number, string> = {
      0: 'd', 1: 'c', 2: 'b', 3: 'bb', 4: 'bbb', 5: 'a', 6: 'aa',
      7: 'aaa', 8: 's', 9: 'sp', 10: 'ss', 11: 'ssp', 12: 'sss', 13: 'sssp',
    };
    // "sp" and "s+" denote the same grade, likewise ss/ss+ and sss/sss+.
    const canonical = (t: string) => (t === 's+' ? 'sp' : t === 'ss+' ? 'ssp' : t === 'sss+' ? 'sssp' : t);
    for (const [text, code] of Object.entries(RANK_MAP)) {
      expect(bounds[code as number]).toBe(canonical(text));
    }
  });
});

describe('parseCsv', () => {
  it('returns an empty parse for empty input', () => {
    expect(parseCsv('').rows).toEqual([]);
  });

  it('handles quoted fields containing commas and doubled quotes', () => {
    const input =
      'id,song_name,score\n' +
      '2031,"Little ""Sister"" Bitch",643590\n' +
      '2461,"《創造》 ～ Cries, beyond The End",1004946\n';
    const { header, rows } = parseCsv(input);
    expect(header).toEqual(['id', 'song_name', 'score']);
    expect(rows[0]).toEqual(['2031', 'Little "Sister" Bitch', '643590']);
    expect(rows[1]).toEqual(['2461', '《創造》 ～ Cries, beyond The End', '1004946']);
  });

  it('handles CRLF, LF and a missing trailing newline', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n3,4').rows;
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles quoted fields spanning newlines', () => {
    const { rows } = parseCsv('a,b\n"line1\nline2",2\n');
    expect(rows[0]?.[0]).toBe('line1\nline2');
  });

  it('preserves empty trailing fields', () => {
    const { rows } = parseCsv('a,b,c\n1,2,\n');
    expect(rows[0]).toEqual(['1', '2', '']);
  });

  it('strips a BOM', () => {
    expect(stripBom('\uFEFFid')).toBe('id');
    expect(parseCsv('\uFEFFid,song\n1,x').header).toEqual(['id', 'song']);
  });

  it('flags rows whose field count differs from the header', () => {
    const { malformed } = parseCsv('a,b,c\n1,2,3\n4,5\n');
    expect(malformed).toEqual([3]);
  });

  it('trims values when building records', () => {
    const { records } = parseCsvRecords('a,b\n  x  ,  y \n');
    expect(records[0]).toEqual({ a: 'x', b: 'y' });
  });
});