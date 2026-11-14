import React from 'react';
import { render } from '@testing-library/react';
import { I18nProvider, type Locale } from '../i18n/index.tsx';

/** Render inside the i18n provider (English by default so assertions read naturally). */
export function renderWithI18n(ui: React.ReactElement, locale: Locale = 'en') {
  return render(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>);
}
