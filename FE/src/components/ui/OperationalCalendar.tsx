import React, { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { buildCalendarMonthGrid, toIsoDateKey } from '../../utils/dfiosAnalytics.ts';
import './OperationalCalendar.css';

export interface CalendarEventBadge {
  event_name: string;
  event_type?: string;
}

interface OperationalCalendarProps {
  language: 'en' | 'vi' | string;
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  onSelectToday: () => void;
  onClearDate: () => void;
  eventsByDate?: Record<string, CalendarEventBadge[]>;
  viewDate?: Date;
  onViewMonthChange?: (nextMonthDate: Date) => void;
  labels?: {
    clear?: string;
    today?: string;
    prevMonth?: string;
    nextMonth?: string;
    pickMonthYear?: string;
  };
}

const VI_MONTH_NAMES = [
  'Tháng Một',
  'Tháng Hai',
  'Tháng Ba',
  'Tháng Tư',
  'Tháng Năm',
  'Tháng Sáu',
  'Tháng Bảy',
  'Tháng Tám',
  'Tháng Chín',
  'Tháng Mười',
  'Tháng Mười Một',
  'Tháng Mười Hai',
];

const EN_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const VI_WEEKDAYS = [
  { short: 'H', full: 'Thứ Hai' },
  { short: 'B', full: 'Thứ Ba' },
  { short: 'T', full: 'Thứ Tư' },
  { short: 'N', full: 'Thứ Năm' },
  { short: 'S', full: 'Thứ Sáu' },
  { short: 'B', full: 'Thứ Bảy' },
  { short: 'C', full: 'Chủ Nhật' },
];

const EN_WEEKDAYS = [
  { short: 'Mo', full: 'Monday' },
  { short: 'Tu', full: 'Tuesday' },
  { short: 'We', full: 'Wednesday' },
  { short: 'Th', full: 'Thursday' },
  { short: 'Fr', full: 'Friday' },
  { short: 'Sa', full: 'Saturday' },
  { short: 'Su', full: 'Sunday' },
];

const VI_SHORT_MONTHS = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'];
const EN_SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const OperationalCalendar: React.FC<OperationalCalendarProps> = ({
  language,
  selectedDate,
  onSelectDate,
  onSelectToday,
  onClearDate,
  eventsByDate = {},
  viewDate: controlledViewDate,
  onViewMonthChange,
  labels,
}) => {
  const isVi = language === 'vi';
  const [internalViewDate, setInternalViewDate] = useState<Date>(() => {
    const base = selectedDate || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const activeViewDate = controlledViewDate || internalViewDate;
  const viewYear = activeViewDate.getFullYear();
  const viewMonth = activeViewDate.getMonth();

  const updateViewMonth = (nextDate: Date) => {
    const normalized = new Date(nextDate.getFullYear(), nextDate.getMonth(), 1);
    if (!controlledViewDate) {
      setInternalViewDate(normalized);
    }
    onViewMonthChange?.(normalized);
  };

  const cells = useMemo(() => buildCalendarMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const todayKey = toIsoDateKey(new Date());
  const selectedKey = selectedDate ? toIsoDateKey(selectedDate) : null;

  const weekdays = isVi ? VI_WEEKDAYS : EN_WEEKDAYS;
  const monthNames = isVi ? VI_MONTH_NAMES : EN_MONTH_NAMES;
  const shortMonths = isVi ? VI_SHORT_MONTHS : EN_SHORT_MONTHS;

  const captionTitle = `${monthNames[viewMonth]} ${viewYear}`;
  const selectedEvents = selectedKey ? eventsByDate[selectedKey] || [] : [];

  const handleStepMonth = (delta: number) => {
    if (isMonthPickerOpen) {
      updateViewMonth(new Date(viewYear + delta, viewMonth, 1));
      return;
    }
    updateViewMonth(new Date(viewYear, viewMonth + delta, 1));
  };

  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    let targetOffset = 0;
    if (e.key === 'ArrowLeft') targetOffset = -1;
    else if (e.key === 'ArrowRight') targetOffset = 1;
    else if (e.key === 'ArrowUp') targetOffset = -7;
    else if (e.key === 'ArrowDown') targetOffset = 7;
    else return;

    e.preventDefault();
    const nextIdx = idx + targetOffset;
    if (nextIdx >= 0 && nextIdx < cells.length) {
      const buttons = gridRef.current?.querySelectorAll<HTMLButtonElement>('button.op-cal-day');
      buttons?.[nextIdx]?.focus();
    } else {
      const shifted = new Date(
        cells[idx].date.getFullYear(),
        cells[idx].date.getMonth(),
        cells[idx].date.getDate() + targetOffset
      );
      updateViewMonth(new Date(shifted.getFullYear(), shifted.getMonth(), 1));
    }
  };

  return (
    <div
      className="op-cal-popover"
      role="dialog"
      aria-label={isVi ? 'Lịch ngày vận hành' : 'Operational Calendar'}
    >
      {/* Header Row: Month-Year Switcher + Up/Down Navigation */}
      <div className="op-cal-header">
        <button
          type="button"
          className="op-cal-caption-btn"
          onClick={() => setIsMonthPickerOpen((prev) => !prev)}
          aria-expanded={isMonthPickerOpen}
          aria-label={labels?.pickMonthYear || (isVi ? 'Chọn tháng và năm' : 'Select month and year')}
        >
          <span>{captionTitle}</span>
          <ChevronDown
            size={13}
            className={`op-cal-caption-caret ${isMonthPickerOpen ? 'is-open' : ''}`}
            aria-hidden="true"
          />
        </button>

        <div className="op-cal-nav-group">
          <button
            type="button"
            className="op-cal-nav-btn"
            onClick={() => handleStepMonth(-1)}
            aria-label={labels?.prevMonth || (isVi ? 'Tháng trước' : 'Previous month')}
            title={labels?.prevMonth || (isVi ? 'Tháng trước' : 'Previous month')}
          >
            <ArrowUp size={15} />
          </button>
          <button
            type="button"
            className="op-cal-nav-btn"
            onClick={() => handleStepMonth(1)}
            aria-label={labels?.nextMonth || (isVi ? 'Tháng sau' : 'Next month')}
            title={labels?.nextMonth || (isVi ? 'Tháng sau' : 'Next month')}
          >
            <ArrowDown size={15} />
          </button>
        </div>
      </div>

      {isMonthPickerOpen ? (
        <div className="op-cal-picker-panel" aria-label={isVi ? 'Chọn tháng và năm' : 'Month and year selector'}>
          <div className="op-cal-year-bar">
            <button
              type="button"
              className="op-cal-nav-btn"
              onClick={() => updateViewMonth(new Date(viewYear - 1, viewMonth, 1))}
              aria-label={isVi ? 'Năm trước' : 'Previous year'}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="op-cal-year-label">{viewYear}</span>
            <button
              type="button"
              className="op-cal-nav-btn"
              onClick={() => updateViewMonth(new Date(viewYear + 1, viewMonth, 1))}
              aria-label={isVi ? 'Năm sau' : 'Next year'}
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="op-cal-months-grid">
            {shortMonths.map((label, mIdx) => (
              <button
                key={label}
                type="button"
                className={`op-cal-picker-cell ${mIdx === viewMonth ? 'is-current-month' : ''}`}
                onClick={() => {
                  updateViewMonth(new Date(viewYear, mIdx, 1));
                  setIsMonthPickerOpen(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Weekday Row (Monday-First) */}
          <div className="op-cal-weekdays" aria-hidden="true">
            {weekdays.map((wd, i) => (
              <span key={`${wd.short}-${i}`} className="op-cal-weekday" title={wd.full}>
                {wd.short}
              </span>
            ))}
          </div>

          {/* 42-Day Interactive Grid */}
          <div
            ref={gridRef}
            className="op-cal-grid"
            role="grid"
            aria-label={captionTitle}
          >
            {cells.map((cell, idx) => {
              const isToday = cell.isoKey === todayKey;
              const isSelected = selectedKey === cell.isoKey;
              const hasEvent = Boolean(eventsByDate[cell.isoKey]?.length);
              const dayAria = cell.date.toLocaleDateString(isVi ? 'vi-VN' : 'en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              });

              return (
                <button
                  key={cell.isoKey}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={dayAria}
                  className={`op-cal-day ${!cell.inCurrentMonth ? 'is-outside' : ''} ${
                    isToday ? 'is-today' : ''
                  } ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => {
                    onSelectDate(cell.date);
                    if (!cell.inCurrentMonth) {
                      updateViewMonth(new Date(cell.date.getFullYear(), cell.date.getMonth(), 1));
                    }
                  }}
                  onKeyDown={(e) => handleGridKeyDown(e, idx)}
                >
                  <span>{cell.day}</span>
                  {hasEvent && <span className="op-cal-event-dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </>
      )}

      {selectedEvents.length > 0 && (
        <div
          className="op-cal-event-strip"
          title={selectedEvents.map((ev) => ev.event_name).join(', ')}
        >
          <CalendarDays size={12} style={{ flexShrink: 0 }} />
          <span>
            {selectedEvents[0].event_name}
            {selectedEvents.length > 1 ? ` (+${selectedEvents.length - 1})` : ''}
          </span>
        </div>
      )}

      {/* Footer Actions: Clear (Xoá) & Today (Hôm nay) */}
      <div className="op-cal-footer">
        <button
          type="button"
          className="op-cal-footer-btn"
          onClick={() => {
            onClearDate();
            setIsMonthPickerOpen(false);
          }}
        >
          {labels?.clear || (isVi ? 'Xoá' : 'Clear')}
        </button>
        <button
          type="button"
          className="op-cal-footer-btn"
          onClick={() => {
            const now = new Date();
            updateViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
            setIsMonthPickerOpen(false);
            onSelectToday();
          }}
        >
          {labels?.today || (isVi ? 'Hôm nay' : 'Today')}
        </button>
      </div>
    </div>
  );
};

