import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useI18n } from '../../i18n/index.tsx';
import { useTheme } from '../../theme/ThemeContext.tsx';
import { IconButton, cx } from '../ui/primitives.tsx';

/** VI | EN segmented toggle. Styles live in layout/shell.css (.shell-lang). */
export const LanguageToggle: React.FC<{ className?: string }> = ({ className }) => {
  const { t, locale, toggleLocale } = useI18n();
  const label = t(locale === 'vi' ? 'common.language.switch_to_en' : 'common.language.switch_to_vi');
  return (
    <button type="button" className={cx('ui-btn ui-btn--ghost ui-btn--sm shell-lang', className)} onClick={toggleLocale} aria-label={label} title={label}>
      <span className={cx('shell-lang__opt', locale === 'vi' && 'is-on')}>VI</span>
      <span className={cx('shell-lang__opt', locale === 'en' && 'is-on')}>EN</span>
    </button>
  );
};

export const ThemeToggle: React.FC = () => {
  const { t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  return (
    <IconButton
      label={t(theme === 'dark' ? 'common.theme.switch_to_light' : 'common.theme.switch_to_dark')}
      icon={theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
      onClick={toggleTheme}
    />
  );
};
