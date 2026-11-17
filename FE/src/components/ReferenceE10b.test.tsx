import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithI18n } from '../test/render.tsx';
import { ReferenceE10bView } from './ReferenceE10b.tsx';

describe('ReferenceE10bView', () => {
  it('shows the run instruction when unavailable', () => {
    renderWithI18n(<ReferenceE10bView data={{ available: false, message: 'x' }} />);
    expect(screen.getByText(/replay_e10b\.py --policy REFIT-RSS-EOQ-G/)).toBeTruthy();
  });

  it('shows the comparison table when available', () => {
    renderWithI18n(
      <ReferenceE10bView
        data={{
          available: true,
          matches: true,
          replay: { cost: 719971.2, orders: 92281, fill: 0.98506 },
          teacher: { cost: 719971.2, orders: 92281, fill: 0.98506 },
          delta: { cost: 0, orders: 0, fill: 0 },
          checks: { cost: true, orders: true, fill: true, min_class_csl: false },
        }}
      />,
    );
    expect(screen.getByText('Matches Table 17')).toBeTruthy();
    expect(screen.getAllByText('719,971.2').length).toBe(2);
    expect(screen.getAllByText('✓').length).toBe(3);
    expect(screen.getAllByText('✗').length).toBe(1);
  });
});
