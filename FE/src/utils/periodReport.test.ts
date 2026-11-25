import { describe, expect, it } from 'vitest';
import { buildPeriodReportHtml, type PeriodReportData } from './periodReport.ts';

const labels = Object.fromEntries(
  ['costTitle', 'serviceTitle', 'ordersTitle', 'item', 'c3', 'b0', 'diff', 'cls', 'nSku', 'target', 'theta', 'status', 'below', 'ok', 'notMeasured', 'orders', 'availability', 'fillRate', 'basis', 'footer'].map((k) => [k, k]),
) as PeriodReportData['labels'];

const data = (): PeriodReportData => ({
  title: 'Báo cáo kỳ',
  store: 'CA_1',
  period: 'P',
  generatedAt: 'G',
  labels,
  costs: [{ label: 'Tổng', c3: 59234.07, b0: 82225.54 }],
  classes: [
    { cls: 'AX', nSku: 547, c3: 96.6, b0: 90.1, theta: 0, target: 95 },
    { cls: 'CX', nSku: 3, c3: 92.6, b0: 66.7, theta: 0.307, target: 95 },
    { cls: 'CZ', nSku: null, c3: null, b0: null, theta: 0, target: 95 },
  ],
  availability: { c3: 96.6, b0: 88 },
  fillRate: { c3: 98.5, b0: null },
  orders: { c3: 10198, b0: 25117 },
  basis: 'A3 <h>',
  money: (v) => v.toFixed(2),
  pct: (v) => `${v}%`,
  int: (v) => String(v),
});

describe('period report (demo.md 6.2)', () => {
  it('holds the three parts: cost by component, service per class, orders', () => {
    const html = buildPeriodReportHtml(data());
    expect(html).toContain('<td>Tổng</td><td class="r">59234.07</td><td class="r">82225.54</td><td class="r">-22991.47</td>');
    expect(html).toContain('<td>CX</td><td class="r">3</td><td class="r">92.6%</td>');
    expect(html).toContain('below'); // CX 92.6 < 95
    expect(html).toContain('notMeasured'); // CZ without a measurement
    expect(html).toContain('10198');
    expect(html).toContain('25117');
  });

  it('escapes text', () => {
    expect(buildPeriodReportHtml(data())).toContain('A3 &lt;h&gt;');
  });
});
