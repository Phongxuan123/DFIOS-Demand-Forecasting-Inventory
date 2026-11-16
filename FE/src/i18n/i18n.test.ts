import { describe, expect, it } from 'vitest';
import { vi as viDict } from './vi.ts';
import { en as enDict } from './en.ts';
import { translate } from './index.tsx';
import { createFormatters, NOT_AVAILABLE } from './format.ts';
import { auditActionLabel, compileTemplate, localizeBe, localizeCoded, looksVietnamese, matchTemplate, prefixCode } from './beText.ts';

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

  it('translates free-text audit details, auth, import and data-quality messages (U-06 round 5)', () => {
    expect(localizeBe('en', "Phê duyệt đề xuất nhập hàng r-1 cho SKU FOODS_1_001: số lượng duyệt=12, on_order (0 -> 12)")).toBe(
      'Approved replenishment r-1 for SKU FOODS_1_001: approved quantity=12, on_order (0 -> 12)',
    );
    expect(localizeBe('en', "Cập nhật cấu hình 'currency': cũ=USD -> mới=EUR")).toBe("Updated setting 'currency': old=USD -> new=EUR");
    expect(localizeBe('en', 'Token không hợp lệ hoặc đã hết hạn')).toBe('The token is invalid or has expired');
    expect(localizeBe('en', "Email 'a@b.c' đã tồn tại trong hệ thống.")).toBe("Email 'a@b.c' already exists.");
    expect(localizeBe('en', 'item_id không tồn tại trong danh mục sản phẩm')).toBe('item_id is not in the product catalogue');
    expect(localizeBe('en', 'Tỷ lệ thiếu ngày bán hàng (7.5%) vượt ngưỡng tối đa (5.0%).')).toBe('Missing sales-day rate (7.5%) exceeds the maximum (5.0%).');
    // nested reason: the wrapped date-format error is translated too
    expect(
      localizeBe('en', 'Dữ liệu CSV không hợp lệ: Cột ngày trộn nhiều định dạng (3 dòng ISO YYYY-MM-DD và 2 dòng dạng DD/MM/YYYY). Hãy dùng một định dạng duy nhất cho cả file (khuyến nghị YYYY-MM-DD).'),
    ).toBe('Invalid CSV data: The date column mixes formats (3 rows ISO YYYY-MM-DD and 2 rows DD/MM/YYYY). Use one format for the whole file (YYYY-MM-DD recommended).');
  });

  it('prefers the more specific template (promote with demotion)', () => {
    const out = localizeBe('en', "Thăng hạng mô hình 'ens' v2 (ID m2) làm Production cho scope 'global'. Đã tự động hạ cấp phiên bản cũ ID m1.");
    expect(out).toContain('The previous version ID m1 was demoted automatically.');
  });

  it('prefers a stable backend code over the text, and falls back to the text', () => {
    expect(localizeCoded('en', 'insufficient_data', null, 'anything')).toContain('No class of the store has replayable data');
    expect(localizeCoded('en', 'unsupported_review_period', { supported_review_period_days: 7 }, 'x')).toContain('7 days apart');
    expect(localizeCoded('en', 'unknown_code_xyz', null, 'Tồn kho trong ngưỡng an toàn.')).toBe('Stock is within the safe range.');
    expect(localizeCoded('en', null, null, null)).toBe('');
  });

  it('uses BE round-5 codes with params, and never shows an unfilled placeholder', () => {
    expect(localizeCoded('en', prefixCode('alert', 'ip_below_rop'), { inventory_position: 12, reorder_point: 30 }, 'x')).toBe(
      'Inventory position IP (12) <= ROP (30). Replenishment order suggested.',
    );
    // params missing -> fall back to the (translated) sentence instead of "{inventory_position}"
    expect(localizeCoded('en', prefixCode('alert', 'ip_below_rop'), null, 'Tồn kho trong ngưỡng an toàn.')).toBe('Stock is within the safe range.');
    expect(localizeCoded('en', prefixCode('kpi', 'no_closed_cycle'), null, 'raw')).toContain('No review cycle has closed yet');
    expect(prefixCode('kpi', null)).toBeNull();
  });

  it('matches templates linearly (no catastrophic backtracking on long unknown text)', () => {
    const long = 'Cập nhật ' + 'x: y -> z, '.repeat(400) + 'Lý do: ' + 'ab ('.repeat(200);
    const t0 = performance.now();
    for (let i = 0; i < 20; i += 1) localizeBe('en', long);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(localizeBe('en', long)).toBe(long);
  });

  it('template matcher: first separator wins, suffix anchored, at least one char per value', () => {
    const r = compileTemplate('k', 'A {x} B {y}.');
    expect(matchTemplate(r, 'A 1 B 2.')).toEqual({ x: '1', y: '2' });
    expect(matchTemplate(r, 'A 1 B 2 B 3.')).toEqual({ x: '1', y: '2 B 3' });
    expect(matchTemplate(r, 'A  B 2.')).toBeNull();
    expect(matchTemplate(r, 'A 1 B 2')).toBeNull();
    expect(matchTemplate(compileTemplate('k', 'fixed'), 'fixed')).toEqual({});
    expect(matchTemplate(compileTemplate('k', '{n}/{total} rest'), '3/9 rest')).toEqual({ n: '3', total: '9' });
  });

  it('detects untranslated Vietnamese text', () => {
    expect(looksVietnamese('Một câu chưa biết')).toBe(true);
    expect(looksVietnamese('Plain English')).toBe(false);
    expect(looksVietnamese(null)).toBe(false);
  });

  it('labels audit actions and falls back to the raw action', () => {
    expect(auditActionLabel('en', 'replenishment.approve')).toBe('Approve replenishment');
    expect(auditActionLabel('en', 'something.new')).toBe('something.new');
  });
});
