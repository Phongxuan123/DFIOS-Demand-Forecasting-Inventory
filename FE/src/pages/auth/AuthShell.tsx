import React from 'react';
import { Link } from 'react-router-dom';
import { DfiosBrandMark } from '../../components/common/DfiosBrandMark.tsx';
import { LanguageToggle, ThemeToggle } from '../../components/common/PreferenceToggles.tsx';
import { useT } from '../../i18n/index.tsx';
import '../../components/layout/shell.css';
import './auth.css';

/** Shared frame of all pre-login pages: brand, language + theme toggles, centered card, footer. */
export const AuthShell: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => {
  const t = useT();
  return (
    <div className="auth-page">
      <div className="auth-page__bar">
        <Link to="/login" className="auth-page__brand" style={{ textDecoration: 'none' }}>
          <span className="auth-page__logo">
            <DfiosBrandMark size={17} />
          </span>
          DFIOS
        </Link>
        <div className="auth-page__tools">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>
      <main className="auth-page__main">
        <div className="auth-card">
          <h1 className="auth-card__title">{title}</h1>
          {subtitle && <p className="auth-card__subtitle">{subtitle}</p>}
          {!subtitle && <div style={{ height: 'var(--space-6)' }} />}
          {children}
        </div>
      </main>
      <footer className="auth-footer">{t('auth.footer')}</footer>
    </div>
  );
};

/** Full-screen splash while the stored session is being validated. */
export const AuthSplash: React.FC = () => {
  const t = useT();
  return (
    <div className="auth-splash" role="status">
      <div className="auth-splash__inner">
        <span className="auth-page__logo">
          <DfiosBrandMark size={17} />
        </span>
        <span>{t('shell.splash')}</span>
      </div>
    </div>
  );
};
