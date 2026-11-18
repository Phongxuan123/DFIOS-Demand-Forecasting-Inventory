import React from 'react';
import { Link } from 'react-router-dom';
import { DfiosBrandMark } from '../../components/common/DfiosBrandMark.tsx';
import { LanguageToggle, ThemeToggle } from '../../components/common/PreferenceToggles.tsx';
import { useT, useLocale } from '../../i18n/index.tsx';
import '../../components/layout/shell.css';
import './auth.css';

export const AuthShell: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => {
  const t = useT();
  const locale = useLocale();
  const isVi = locale === 'vi';

  return (
    <div className="auth-page">
      <div className="auth-backdrop-overlay" aria-hidden="true" />
      <div className="auth-ambient-glow" aria-hidden="true" />
      
      <header className="auth-topbar">
        <Link to="/login" className="auth-topbar-brand">
          <span className="auth-topbar-logo">
            <DfiosBrandMark size={22} />
          </span>
          <span className="auth-topbar-name">DFIOS</span>
        </Link>
        <div className="auth-tools">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-card-brand">
            <div className="auth-card-logo">
              <DfiosBrandMark size={28} />
            </div>
            <div className="auth-card-brand-text">
              <span className="auth-card-brand-title">DFIOS</span>
              <span className="auth-card-brand-desc">
                {isVi ? 'Dự báo Nhu cầu & Tối ưu Tồn kho' : 'Demand Forecasting & Inventory Optimization'}
              </span>
            </div>
          </div>

          <div className="auth-card-header">
            <h1 className="auth-card__title">{title}</h1>
            {subtitle && <p className="auth-card__subtitle">{subtitle}</p>}
          </div>

          {children}
        </div>
      </main>

      <footer className="auth-bottom-footer">
        {t('auth.footer')}
      </footer>
    </div>
  );
};

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
