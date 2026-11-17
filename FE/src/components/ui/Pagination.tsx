import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useFormat, useT } from '../../i18n/index.tsx';
import { IconButton } from './primitives.tsx';
import { Select } from './forms.tsx';
import './ui.css';

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  className,
}) => {
  const t = useT();
  const fmt = useFormat();
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const current = Math.min(Math.max(1, page), pages);

  useEffect(() => {
    if (current !== page) onPageChange(current);
  }, [current, page, onPageChange]);

  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);

  return (
    <nav className={`ui-pagination ${className ?? ''}`} aria-label={t('common.pagination.label')}>
      <span className="ui-pagination__range">
        {t('common.pagination.range', { from: fmt.integer(from), to: fmt.integer(to), total: fmt.integer(total) })}
      </span>
      <div className="ui-pagination__controls">
        {onPageSizeChange && (
          <div className="ui-pagination__size">
            <Select
              size="sm"
              direction="up"
              aria-label={t('common.pagination.rows_per_page')}
              value={pageSize}
              onChange={(v) => onPageSizeChange(Number(v))}
              options={pageSizeOptions.map((n) => ({ value: n, label: String(n) }))}
            />
          </div>
        )}
        <span className="ui-tabular">{t('common.pagination.page_of', { page: fmt.integer(current), pages: fmt.integer(pages) })}</span>
        <IconButton size="sm" label={t('common.pagination.first')} icon={<ChevronsLeft size={15} />} disabled={current <= 1} onClick={() => onPageChange(1)} />
        <IconButton size="sm" label={t('common.pagination.previous')} icon={<ChevronLeft size={15} />} disabled={current <= 1} onClick={() => onPageChange(current - 1)} />
        <IconButton size="sm" label={t('common.pagination.next')} icon={<ChevronRight size={15} />} disabled={current >= pages} onClick={() => onPageChange(current + 1)} />
        <IconButton size="sm" label={t('common.pagination.last')} icon={<ChevronsRight size={15} />} disabled={current >= pages} onClick={() => onPageChange(pages)} />
      </div>
    </nav>
  );
};
