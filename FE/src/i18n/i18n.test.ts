import { describe, expect, it } from 'vitest';
import { vi as viDict } from './vi.ts';
import { en as enDict } from './en.ts';
import { translate } from './index.tsx';
import { createFormatters, NOT_AVAILABLE } from './format.ts';
import { auditActionLabel, localizeBe } from './beText.ts';

function flatten(node: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof node === 'string') {
    out[prefix] = node;
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

describe('i18n key parity vi/en', () => {
  const vi = flatten(viDict);
  const en = flatten(enDict);

  it('has the same key set in both languages', () => {
    const missingInEn = Object.keys(vi).filter((k) => !(k in en));
    const missingInVi = Object.keys(en).filter((k) => !(k in vi));
    expect(missingInEn, `keys missing in en: ${missingInEn.join(', ')}`).toEqual([]);
    expect(missingInVi, `keys missing in vi: ${missingInVi.join(', ')}`).toEqual([]);
  });

  it('has no empty translations (except intentionally empty suffixes)', () => {
    const empty = Object.entries(en)
      .filter(([, v]) => v.trim() === '')
      .map(([k]) => k);
    const emptyVi = Object.entries(vi)
      .filter(([, v]) => v.trim() === '')
      .map(([k]) => k);
    expect(empty.sort()).toEqual(emptyVi.sort());
  });

  it('uses the same {placeholders} in both languages', () => {
    const bad = Object.keys(vi).filter((k) => k in en && placeholders(vi[k]) !== placeholders(en[k]));
    expect(bad, `placeholder mismatch: ${bad.join(', ')}`).toEqual([]);
  });

  it('interpolates variables and falls back to the key when unknown', () => {
    expect(translate('en', 'common.table.selected', { count: 3 })).toContain('3');
    expect(translate('en', 'does.not.exist')).toBe('does.not.exist');
  });
});

describe('formatters', () => {
  for (const locale of ['vi', 'en'] as const) {
    const f = createFormatters(locale);
    it(`${locale}: null, undefined and NaN render as the dash`, () => {
      for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(f.number(bad)).toBe(NOT_AVAILABLE);
        expect(f.integer(bad)).toBe(NOT_AVAILABLE);
        expect(f.percent(bad)).toBe(NOT_AVAILABLE);
        expect(f.currency(bad)).toBe(NOT_AVAILABLE);
        expect(f.compact(bad)).toBe(NOT_AVAILABLE);
      }
      expect(f.date(null)).toBe(NOT_AVAILABLE);
      expect(f.date('not a date')).toBe(NOT_AVAILABLE);
    });
  }

  it('does not turn a real zero into the dash', () => {
    expect(createFormatters('en').number(0)).toBe('0');
    expect(createFormatters('en').percent(0)).toBe('0.0%');
  });

  it('formats ratio vs percent scale', () => {
    const f = createFormatters('en');
    expect(f.percent(0.949)).toBe('94.9%');
    expect(f.percent(94.9, { scale: 'percent' })).toBe('94.9%');
  });

  it('parses YYYY-MM-DD as a local calendar date (no timezone shift)', () => {
    const f = createFormatters('en');
    expect(f.date('2016-05-22', 'short')).toBe('05/22/2016');
    expect(f.date('2016-05-22', 'axis')).toBe('May 22');
  });
});

describe('backend text localisation (U-06)', () => {
  it('keeps Vietnamese text in the Vietnamese UI', () => {
    const raw = 'Tồn kho trong ngưỡng an toàn.';
    expect(localizeBe('vi', raw)).toBe(raw);
  });

  it('translates a fixed backend sentence in English', () => {
    expect(localizeBe('en', 'Tồn kho trong ngưỡng an toàn.')).toBe('Stock is within the safe range.');
  });

  it('translates a templated sentence and keeps the captured numbers', () => {
    const out = localizeBe('en', 'Vị trí tồn kho IP (12) <= ROP (30). Đề xuất đặt hàng bổ sung.');
    expect(out).toBe('Inventory position IP (12) <= ROP (30). Replenishment order suggested.');
  });

  it('translates a nested reason inside a sentence', () => {
    const out = localizeBe('en', 'Availability quan sát (các chu kỳ đã đóng): C³-OUT 80.1% (mục tiêu 96.0%); B0: Không có sim_clock cho phạm vi yêu cầu.');
    expect(out).toContain('C³-OUT 80.1%');
    expect(out).toContain('No simulation clock for the requested scope.');
  });

  it('falls back to the raw text for unknown sentences and tolerates null', () => {
    expect(localizeBe('en', 'Một câu chưa biết')).toBe('Một câu chưa biết');
    expect(localizeBe('en', null)).toBe('');
  });

  it('labels audit actions and falls back to the raw action', () => {
    expect(auditActionLabel('en', 'replenishment.approve')).toBe('Approve replenishment');
    expect(auditActionLabel('en', 'something.new')).toBe('something.new');
  });
});
