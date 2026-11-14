/**
 * LEGACY bridge. Only for pages that have not been rewritten yet.
 * New code must use `useT()` / `useI18n()` from src/i18n.
 *
 * The language itself now lives in <I18nProvider>; this hook only maps the
 * old API (`language`, `t(path, fallback)`) onto it and reads the old
 * dictionary in i18n/legacyTranslations.ts. Delete this file together with
 * legacyTranslations.ts when the last legacy page is gone.
 */
import React, { useMemo, type ReactNode } from 'react';
import { translations, type Language } from '../i18n/legacyTranslations.ts';
import { useI18n } from '../i18n/index.tsx';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (path: string, fallback?: string) => string;
}

function lookup(root: unknown, path: string): string | undefined {
  let current: unknown = root;
  for (const k of path.split('.')) {
    if (current && typeof current === 'object' && k in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
}

/** @deprecated The provider is now <I18nProvider>. Kept as a pass-through. */
export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => <>{children}</>;

/** @deprecated Use `useT()` / `useI18n()` from src/i18n. */
export const useLanguage = (): LanguageContextType => {
  const { locale, setLocale, toggleLocale } = useI18n();
  return useMemo(
    () => ({
      language: locale,
      setLanguage: setLocale,
      toggleLanguage: toggleLocale,
      t: (path: string, fallback?: string) =>
        lookup(translations[locale], path) ?? lookup(translations.en, path) ?? fallback ?? path,
    }),
    [locale, setLocale, toggleLocale],
  );
};
