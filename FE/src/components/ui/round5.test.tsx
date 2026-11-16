import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { renderWithI18n } from '../../test/render.tsx';
import { BeText } from '../../i18n/BeText.tsx';
import { HoldHeight } from './HoldHeight.tsx';
import { ChartLegend } from './chartTheme.tsx';

describe('BeText (U-06)', () => {
  it('translates a known backend sentence in English', () => {
    renderWithI18n(<BeText text="Tồn kho trong ngưỡng an toàn." />);
    expect(screen.getByText('Stock is within the safe range.')).toBeTruthy();
  });

  it('marks still-Vietnamese text with lang="vi" in the English UI', () => {
    renderWithI18n(<BeText text="Một câu chưa biết" />);
    expect(screen.getByText('Một câu chưa biết').getAttribute('lang')).toBe('vi');
  });

  it('does not mark text in the Vietnamese UI', () => {
    renderWithI18n(<BeText text="Một câu chưa biết" />, 'vi');
    expect(screen.getByText('Một câu chưa biết').getAttribute('lang')).toBeNull();
  });

  it('uses the code when present', () => {
    renderWithI18n(<BeText text="raw" code="whatif_no_items" />);
    expect(screen.getByText('The store has no SKU in this class.')).toBeTruthy();
  });
});

describe('HoldHeight (U-15)', () => {
  it('holds a min-height after a tab change and releases it', async () => {
    const { container, rerender } = render(
      <HoldHeight activeKey="a" holdMs={20}>
        <p>A</p>
      </HoldHeight>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.minHeight).toBe('');
    rerender(
      <HoldHeight activeKey="b" holdMs={20}>
        <p>B</p>
      </HoldHeight>,
    );
    expect(el.style.minHeight).toMatch(/px$/);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(el.style.minHeight).toBe('');
  });
});

describe('ChartLegend', () => {
  it('draws a dashed sample for dashed series (shape, not only colour)', () => {
    const { container } = render(<ChartLegend items={[{ label: 'AY', color: 'red', dash: '6 3' }, { label: 'AX', color: 'blue' }]} />);
    expect(container.querySelector('line')?.getAttribute('stroke-dasharray')).toBe('6 3');
    expect(container.textContent).toContain('AX');
  });
});
