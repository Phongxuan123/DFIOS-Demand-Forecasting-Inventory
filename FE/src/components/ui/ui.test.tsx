import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithI18n } from '../../test/render.tsx';
import { KpiTile } from './primitives.tsx';
import { Table, useRowSelection, usePagination, type Column } from './Table.tsx';

describe('KpiTile', () => {
  it('shows the dash and the reason when the value is unavailable (never 0)', () => {
    renderWithI18n(<KpiTile label="Availability" value={null} unavailableReason="No closed review cycle yet" />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText(/No closed review cycle yet/)).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows the dash for undefined and empty values too', () => {
    renderWithI18n(<KpiTile label="A" value={undefined} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('shows the value and the hint when available', () => {
    renderWithI18n(<KpiTile label="Cost" value="$1.2K" hint="B0 $2K" />);
    expect(screen.getByText('$1.2K')).toBeTruthy();
    expect(screen.getByText('B0 $2K')).toBeTruthy();
  });

  it('does not render a real 0 as unavailable', () => {
    renderWithI18n(<KpiTile label="Orders" value="0" />);
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByText('—')).toBeNull();
  });
});

interface Row {
  id: string;
  name: string;
}
const ALL: Row[] = Array.from({ length: 6 }, (_, i) => ({ id: `r${i + 1}`, name: `Row ${i + 1}` }));
const columns: Column<Row>[] = [{ key: 'name', header: 'Name', value: (r) => r.name }];

function Harness() {
  const pg = usePagination(3);
  const sel = useRowSelection();
  const rows = ALL.slice(pg.offset, pg.offset + pg.pageSize);
  return (
    <div>
      <span data-testid="count">{sel.size}</span>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        pagination={{ page: pg.page, pageSize: pg.pageSize, onPageChange: pg.setPage, total: ALL.length, pageSizeOptions: [3] }}
        selection={{ selected: sel.selected, onChange: sel.set }}
      />
    </div>
  );
}

const rowBoxes = () => screen.getAllByRole('checkbox', { name: /select row|chọn dòng/i }) as HTMLInputElement[];

describe('Table row selection across pages (F-22)', () => {
  it('keeps the selection when the page changes', () => {
    renderWithI18n(<Harness />);
    expect(rowBoxes()).toHaveLength(3);
    fireEvent.click(rowBoxes()[0]);
    fireEvent.click(rowBoxes()[1]);
    expect(screen.getByTestId('count').textContent).toBe('2');

    fireEvent.click(screen.getByRole('button', { name: /next|sau|tiếp/i }));
    expect(screen.getByText('Row 4')).toBeTruthy();
    expect(screen.getByTestId('count').textContent).toBe('2');

    fireEvent.click(rowBoxes()[2]);
    expect(screen.getByTestId('count').textContent).toBe('3');

    fireEvent.click(screen.getByRole('button', { name: /prev|trước/i }));
    const back = rowBoxes();
    expect(back[0].checked).toBe(true);
    expect(back[1].checked).toBe(true);
    expect(back[2].checked).toBe(false);
  });

  it('select-page adds only that page and keeps earlier pages', () => {
    renderWithI18n(<Harness />);
    const pageBox = () => screen.getByRole('checkbox', { name: /all rows on this page|tất cả/i });
    fireEvent.click(pageBox());
    expect(screen.getByTestId('count').textContent).toBe('3');
    fireEvent.click(screen.getByRole('button', { name: /next|sau|tiếp/i }));
    fireEvent.click(pageBox());
    expect(screen.getByTestId('count').textContent).toBe('6');
    expect(within(screen.getByRole('table')).getByText('Row 6')).toBeTruthy();
  });
});
