/**
 * Locale-aware formatters. Every formatter returns the em dash "—" for
 * null / undefined / NaN / unparsable input, so a missing value can never be
 * rendered as 0 or as "NaN".
 */
export type Locale = 'vi' | 'en';

export const NOT_AVAILABLE = '—';

let activeLocale: Locale = 'vi';
/** Set by I18nProvider so non-React code (error mapping) can translate backend text. */
export const setActiveLocale = (l: Locale): void => {
  activeLocale = l;
};
export const getActiveLocale = (): Locale => activeLocale;

const INTL_LOCALE: Record<Locale, string> = { vi: 'vi-VN', en: 'en-US' };

type Num = number | null | undefined;
type DateInput = string | number | Date | null | undefined;

const isNum = (v: Num): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parses 'YYYY-MM-DD' as a local calendar date (no timezone shift), anything else via Date. */
export function parseDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) {
      return new Date(`${value.replace(' ', 'T')}Z`);
    }
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface NumberOptions {
  /** Fixed number of fraction digits. */
  digits?: number;
  minDigits?: number;
  maxDigits?: number;
  /** Always show a sign (+/−) for non-zero values. */
  signed?: boolean;
}

export interface Formatters {
  locale: Locale;
  /** 1.234,5 (vi) / 1,234.5 (en). Default: up to 2 fraction digits. */
  number: (value: Num, options?: NumberOptions) => string;
  /** Whole number with grouping. */
  integer: (value: Num) => string;
  /** 12,9 N / 12.9K, 4,2 Tr / 4.2M. */
  compact: (value: Num, digits?: number) => string;
  /**
   * Percent. `value` is a ratio by default (0.949 -> 94,9 %).
   * Pass `{ scale: 'percent' }` when the value is already 0–100.
   */
  percent: (value: Num, options?: { digits?: number; scale?: 'ratio' | 'percent'; signed?: boolean }) => string;
  /** Currency, USD by default (M5 prices are in USD). */
  currency: (value: Num, options?: { currency?: string; digits?: number; compact?: boolean }) => string;
  /** 30/05/2016 (vi) / May 30, 2016 (en). */
  date: (value: DateInput, style?: 'axis' | 'short' | 'medium' | 'long') => string;
  dateTime: (value: DateInput) => string;
  time: (value: DateInput) => string;
  /** ISO calendar date YYYY-MM-DD, locale independent. Use for API params and for sim dates in tables. */
  isoDate: (value: DateInput) => string;
  /** "3 ngày trước" / "3 days ago". */
  relative: (value: DateInput, now?: Date) => string;
}

export function createFormatters(locale: Locale): Formatters {
  const tag = INTL_LOCALE[locale];

  const number: Formatters['number'] = (value, options = {}) => {
    if (!isNum(value)) return NOT_AVAILABLE;
    const min = options.digits ?? options.minDigits ?? 0;
    const max = options.digits ?? options.maxDigits ?? Math.max(min, 2);
    return new Intl.NumberFormat(tag, {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      signDisplay: options.signed ? 'exceptZero' : 'auto',
    }).format(value);
  };

  const integer: Formatters['integer'] = (value) => number(value, { digits: 0 });

  const compact: Formatters['compact'] = (value, digits = 1) => {
    if (!isNum(value)) return NOT_AVAILABLE;
    return new Intl.NumberFormat(tag, { notation: 'compact', maximumFractionDigits: digits }).format(value);
  };

  const percent: Formatters['percent'] = (value, options = {}) => {
    if (!isNum(value)) return NOT_AVAILABLE;
    const ratio = options.scale === 'percent' ? value / 100 : value;
    const digits = options.digits ?? 1;
    return new Intl.NumberFormat(tag, {
      style: 'percent',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: options.signed ? 'exceptZero' : 'auto',
    }).format(ratio);
  };

  const currency: Formatters['currency'] = (value, options = {}) => {
    if (!isNum(value)) return NOT_AVAILABLE;
    const digits = options.digits ?? (options.compact ? 1 : 2);
    return new Intl.NumberFormat(tag, {
      style: 'currency',
      currency: options.currency ?? 'USD',
      notation: options.compact ? 'compact' : 'standard',
      minimumFractionDigits: options.compact ? 0 : digits,
      maximumFractionDigits: digits,
    }).format(value);
  };

  const date: Formatters['date'] = (value, style = 'medium') => {
    const d = parseDate(value);
    if (!d) return NOT_AVAILABLE;
    const opts: Intl.DateTimeFormatOptions =
      style === 'axis'
        ? { day: 'numeric', month: 'short' }
        : style === 'short'
        ? { day: '2-digit', month: '2-digit', year: 'numeric' }
        : style === 'long'
          ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
          : locale === 'vi'
            ? { day: '2-digit', month: '2-digit', year: 'numeric' }
            : { day: 'numeric', month: 'short', year: 'numeric' };
    return new Intl.DateTimeFormat(tag, opts).format(d);
  };

  const dateTime: Formatters['dateTime'] = (value) => {
    const d = parseDate(value);
    if (!d) return NOT_AVAILABLE;
    return new Intl.DateTimeFormat(tag, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  };

  const time: Formatters['time'] = (value) => {
    const d = parseDate(value);
    if (!d) return NOT_AVAILABLE;
    return new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  };

  const isoDate: Formatters['isoDate'] = (value) => {
    const d = parseDate(value);
    if (!d) return NOT_AVAILABLE;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  };

  const relative: Formatters['relative'] = (value, now = new Date()) => {
    const d = parseDate(value);
    if (!d) return NOT_AVAILABLE;
    const seconds = Math.round((d.getTime() - now.getTime()) / 1000);
    const abs = Math.abs(seconds);
    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
    if (abs < 60) return rtf.format(seconds, 'second');
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
    if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), 'day');
    if (abs < 86400 * 365) return rtf.format(Math.round(seconds / (86400 * 30)), 'month');
    return rtf.format(Math.round(seconds / (86400 * 365)), 'year');
  };

  return { locale, number, integer, compact, percent, currency, date, dateTime, time, isoDate, relative };
}
