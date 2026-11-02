import React from 'react';
import { Globe } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext.tsx';
import './LanguageToggle.css';

export const LanguageToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div
      className={`lang-toggle-container ${className}`}
      role="group"
      aria-label={t('topbar.switch_language')}
      title={language === 'en' ? 'Switch to Tiếng Việt (Chuyển sang Tiếng Việt)' : 'Switch to English (Chuyển sang Tiếng Anh)'}
    >
      <div className="lang-toggle-icon-wrap" aria-hidden="true">
        <Globe size={14} className="lang-globe-icon" />
      </div>

      <div className="lang-toggle-pills">
        <button
          type="button"
          className={`lang-pill ${language === 'en' ? 'active' : ''}`}
          onClick={() => setLanguage('en')}
          aria-pressed={language === 'en'}
          aria-label="Switch to English"
        >
          <span className="lang-pill-flag">🇬🇧</span>
          <span className="lang-pill-text">EN</span>
        </button>

        <span className="lang-divider" aria-hidden="true" />

        <button
          type="button"
          className={`lang-pill ${language === 'vi' ? 'active' : ''}`}
          onClick={() => setLanguage('vi')}
          aria-pressed={language === 'vi'}
          aria-label="Chuyển sang Tiếng Việt"
        >
          <span className="lang-pill-flag">🇻🇳</span>
          <span className="lang-pill-text">VI</span>
        </button>
      </div>
    </div>
  );
};
