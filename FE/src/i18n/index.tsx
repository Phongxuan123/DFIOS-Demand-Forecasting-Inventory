/**
 * DFIOS i18n (no dependency).
 *
 *   const { t, locale, fmt } = useI18n();   // everything
 *   const t = useT();                        // just the translator
 *   const fmt = useFormat();                 // just the formatters
 *
 *   t('common.actions.save')
 *   t('common.table.selected', { count: 3 })   // "{count}" placeholders
 *
 * Keys are typed (TKey): a typo fails tsc. For keys built at runtime use
 * `t(key as TKey)` only when the set of keys is known to exist.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { vi, type Dictionary } from './vi.ts';
import { en } from './en.ts';
import { createFormatters, type Formatters, type Locale } from './format.ts';

export type { Locale, Formatters } from './format.ts';
export { NOT_AVAILABLE, createFormatters, parseDate } from './format.ts';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Union of every valid translation key, e.g. 'common.actions.save'. */
export type TKey = Leaves<Dictionary>;
export type TVars = Record<string, string | number>;
export type TFunction = (key: TKey, vars?: TVars) => string;

export const LOCALES: readonly Locale[] = ['vi', 'en'];
export const DEFAULT_LOCALE: Locale = 'vi';
/** Kept in localStorage; it is a preference, so it survives login/logout. */
export const LOCALE_STORAGE_KEY = 'dfios_language';

const DICTIONARIES: Record<Locale, Dictionary> = { vi, en };

function lookup(dict: Dictionary, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/** Pure translator, usable outside React (tests, services). */
export function translate(locale: Locale, key: string, vars?: TVars): string {
  const value = lookup(DICTIONARIES[locale], key) ?? lookup(DICTIONARIES[DEFAULT_LOCALE], key);
  return value === undefined ? key : interpolate(value, vars);
}

function readStoredLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'vi' || saved === 'en') return saved;
  } catch {
    /* storage blocked: fall through */
  }
  return DEFAULT_LOCALE;
}

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: TFunction;
  fmt: Formatters;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode; initialLocale?: Locale }> = ({
  children,
  initialLocale,
}) => {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? readStoredLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* storage blocked: the choice lasts for this tab only */
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((prev) => {
      const next: Locale = prev === 'vi' ? 'en' : 'vi';
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      toggleLocale,
      t: (key, vars) => translate(locale, key, vars),
      fmt: createFormatters(locale),
    }),
    [locale, setLocale, toggleLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

export function useT(): TFunction {
  return useI18n().t;
}

export function useFormat(): Formatters {
  return useI18n().fmt;
}

export function useLocale(): Locale {
  return useI18n().locale;
}
