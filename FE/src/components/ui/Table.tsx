import React, { useCallback, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useFormat, useT } from '../../i18n/index.tsx';
import { Button, Skeleton, cx } from './primitives.tsx';
import { Checkbox } from './forms.tsx';
import { EmptyState, ErrorState } from './states.tsx';
import { Pagination } from './Pagination.tsx';
import './ui.css';

export type RowKey = string | number;

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /** Custom cell. Default: `value(row)` formatted as text, "—" when null. */
  cell?: (row: T, index: number) => React.ReactNode;
  /** Raw value: used for client-side sorting and as the default cell content. */
  value?: (row: T) => string | number | null | undefined;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  /** Plain text for aria-label of the sort button (defaults to `header` when it is a string). */
  title?: string;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface TablePagination {
  /** 1-based. */
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  /**
   * Server pagination: pass the TOTAL row count, `rows` is then already the current page.
   * Omit for client pagination: the table slices `rows` itself.
   */
  total?: number;
}

export interface TableSelection {
  selected: ReadonlySet<RowKey>;
  onChange: (next: Set<RowKey>) => void;
  /** Rows that cannot be selected. */
  isDisabled?: (key: RowKey) => boolean;
  /** Bulk actions shown in the selection bar. */
  actions?: React.ReactNode;
}

export interface TableProps<T> {
  columns: ReadonlyArray<Column<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => RowKey;
  loading?: boolean;
  /** Anything thrown by the API (403 shows "no permission"), or null. */
  error?: unknown;
  onRetry?: () => void;
  /** Set when the data cannot be provided at all: shown instead of rows, with the reason. */
  unavailableReason?: string;
  /** Empty because a filter is active (changes the wording). */
  filtered?: boolean;
  emptyTitle?: React.ReactNode;
  emptyDescription?: React.ReactNode;
  emptyAction?: React.ReactNode;
  /** Controlled sort = server sorting (you refetch). Omit both for client sorting. */
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  pagination?: TablePagination;
  selection?: TableSelection;
  onRowClick?: (row: T) => void;
  dense?: boolean;
  /** Allow cell text to wrap (default: single line). */
  wrap?: boolean;
  /** CSS max-height of the scroll area (enables the sticky header), e.g. 520. */
  maxHeight?: number | string;
  caption?: string;
  className?: string;
}

/* -------------------------------- helpers --------------------------------- */

/** Selection state that survives pagination, sorting and filtering (F-22). */
export function useRowSelection<K extends RowKey = RowKey>() {
  const [selected, setSelected] = useState<ReadonlySet<K>>(() => new Set<K>());
  const set = useCallback((next: Set<K>) => setSelected(next), []);
  const clear = useCallback(() => setSelected(new Set<K>()), []);
  const toggle = useCallback(
    (key: K) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );
  return { selected, set, clear, toggle, size: selected.size };
}

export function usePagination(initialPageSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const setPageSize = useCallback((n: number) => {
    setPageSizeState(n);
    setPage(1);
  }, []);
  return { page, pageSize, setPage, setPageSize, offset: (page - 1) * pageSize };
}

function compare(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an || bn) return an === bn ? 0 : an ? 1 : -1; // nulls always last
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/* --------------------------------- Table ---------------------------------- */

export function Table<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  onRetry,
  unavailableReason,
  filtered,
  emptyTitle,
  emptyDescription,
  emptyAction,
  sort,
  onSortChange,
  pagination,
  selection,
  onRowClick,
  dense,
  wrap,
  maxHeight,
  caption,
  className,
}: TableProps<T>) {
  const t = useT();
  const fmt = useFormat();

  // Sorting: controlled (server) when onSortChange is given, otherwise local state.
  const [localSort, setLocalSort] = useState<SortState | null>(null);
  const controlled = onSortChange !== undefined;
  const activeSort = controlled ? (sort ?? null) : localSort;

  const toggleSort = (key: string) => {
    const next: SortState | null =
      !activeSort || activeSort.key !== key ? { key, dir: 'asc' } : activeSort.dir === 'asc' ? { key, dir: 'desc' } : null;
    if (controlled) onSortChange?.(next);
    else setLocalSort(next);
  };

  const sortedRows = useMemo(() => {
    if (controlled || !activeSort) return rows;
    const col = columns.find((c) => c.key === activeSort.key);
    if (!col?.value) return rows;
    const get = col.value;
    const sign = activeSort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      const nullA = av === null || av === undefined;
      const nullB = bv === null || bv === undefined;
      if (nullA || nullB) return compare(av, bv); // nulls last regardless of direction
      return sign * compare(av, bv);
    });
  }, [rows, columns, activeSort, controlled]);

  const serverPaged = pagination?.total !== undefined;
  const total = pagination ? (serverPaged ? (pagination.total as number) : sortedRows.length) : sortedRows.length;
  const visibleRows = useMemo(() => {
    if (!pagination || serverPaged) return sortedRows;
    const start = (pagination.page - 1) * pagination.pageSize;
    return sortedRows.slice(start, start + pagination.pageSize);
  }, [sortedRows, pagination, serverPaged]);

  // Selection
  const selectableKeys = useMemo(
    () => visibleRows.map(rowKey).filter((k) => !selection?.isDisabled?.(k)),
    [visibleRows, rowKey, selection],
  );
  const selectedOnPage = selection ? selectableKeys.filter((k) => selection.selected.has(k)).length : 0;
  const allOnPage = selectableKeys.length > 0 && selectedOnPage === selectableKeys.length;

  const togglePage = (checked: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    selectableKeys.forEach((k) => (checked ? next.add(k) : next.delete(k)));
    selection.onChange(next);
  };
  const toggleRow = (key: RowKey, checked: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (checked) next.add(key);
    else next.delete(key);
    selection.onChange(next);
  };

  const colCount = columns.length + (selection ? 1 : 0);
  const showSkeleton = loading && visibleRows.length === 0 && !error;
  const showError = !!error && visibleRows.length === 0;
  const showUnavailable = !!unavailableReason && !loading;
  const showEmpty = !loading && !error && !unavailableReason && visibleRows.length === 0;
  const hasBody = !showError && !showUnavailable && !showEmpty;
  const skeletonRows = Math.min(pagination?.pageSize ?? 6, 8);

  return (
    <div className={cx('ui-table-root', className)} aria-busy={loading || undefined}>
      {selection && selection.selected.size > 0 && (
        <div className="ui-table-selection-bar" role="status">
          <strong>{t('common.table.selected', { count: fmt.integer(selection.selected.size) })}</strong>
          <span className="ui-table-selection-bar__hint">{t('common.table.selected_hint')}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {selection.actions}
            <Button size="sm" variant="ghost" onClick={() => selection.onChange(new Set())}>
              {t('common.table.clear_selection')}
            </Button>
          </span>
        </div>
      )}

      <div className="ui-table-wrap" style={maxHeight !== undefined ? { maxHeight } : undefined}>
        {loading && visibleRows.length > 0 && <div className="ui-table__overlay" aria-hidden="true" />}
        {showError && <ErrorState error={error} onRetry={onRetry} />}
        {showUnavailable && (
          <EmptyState title={t('common.state.unavailable')} description={t('common.state.unavailable_reason', { reason: unavailableReason as string })} />
        )}
        {showEmpty && <EmptyState filtered={filtered} title={emptyTitle} description={emptyDescription} action={emptyAction} />}

        {hasBody && (
          <table className={cx('ui-table', dense && 'ui-table--dense', wrap && 'ui-table--wrap')}>
            {caption && <caption className="ui-sr-only">{caption}</caption>}
            <thead>
              <tr>
                {selection && (
                  <th className="ui-table__select" scope="col">
                    <Checkbox
                      aria-label={t('common.table.select_page')}
                      checked={allOnPage}
                      indeterminate={selectedOnPage > 0 && !allOnPage}
                      disabled={selectableKeys.length === 0}
                      onChange={togglePage}
                    />
                  </th>
                )}
                {columns.map((col) => {
                  const active = activeSort?.key === col.key;
                  const title = col.title ?? (typeof col.header === 'string' ? col.header : col.key);
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      className={cx(col.align === 'right' && 'is-right', col.align === 'center' && 'is-center')}
                      style={col.width !== undefined ? { width: col.width } : undefined}
                      aria-sort={active ? (activeSort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      {col.sortable ? (
                        <button
                          type="button"
                          className="ui-table__sort"
                          data-active={active}
                          onClick={() => toggleSort(col.key)}
                          aria-label={t('common.table.sort_by', { column: title })}
                        >
                          {col.header}
                          {active ? (
                            activeSort.dir === 'asc' ? <ArrowUp size={12} className="ui-table__sort-icon" /> : <ArrowDown size={12} className="ui-table__sort-icon" />
                          ) : (
                            <ArrowUpDown size={12} className="ui-table__sort-icon" />
                          )}
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {showSkeleton
                ? Array.from({ length: skeletonRows }, (_, i) => (
                    <tr key={`sk-${i}`}>
                      {Array.from({ length: colCount }, (_, j) => (
                        <td key={j}>
                          <Skeleton width={j === 0 && selection ? 16 : `${50 + ((i * 7 + j * 13) % 40)}%`} />
                        </td>
                      ))}
                    </tr>
                  ))
                : visibleRows.map((row, index) => {
                    const key = rowKey(row);
                    const isSelected = selection?.selected.has(key) ?? false;
                    return (
                      <tr
                        key={key}
                        aria-selected={selection ? isSelected : undefined}
                        data-clickable={onRowClick ? true : undefined}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                      >
                        {selection && (
                          <td className="ui-table__select" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              aria-label={t('common.table.select_row')}
                              checked={isSelected}
                              disabled={selection.isDisabled?.(key)}
                              onChange={(c) => toggleRow(key, c)}
                            />
                          </td>
                        )}
                        {columns.map((col) => {
                          const content = col.cell ? col.cell(row, index) : (col.value?.(row) ?? '—');
                          return (
                            <td key={col.key} className={cx(col.align === 'right' && 'is-right', col.align === 'center' && 'is-center')}>
                              {content}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        )}
      </div>

      {pagination && hasBody && total > 0 && (
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={total}
          onPageChange={pagination.onPageChange}
          onPageSizeChange={pagination.onPageSizeChange}
          pageSizeOptions={pagination.pageSizeOptions}
        />
      )}
    </div>
  );
}
