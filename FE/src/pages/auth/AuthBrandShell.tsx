import React from 'react';
import { useLanguage } from '../../context/LanguageContext.tsx';
import { LanguageToggle } from '../../components/common/LanguageToggle.tsx';
import './Login.css';

export const DfiosBrandMark: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M3.5 14.5L8.2 9.8L11.8 12.2L16.5 5.5"
      stroke="#2dd4bf"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.2 5.5H16.5V8.8"
      stroke="#2dd4bf"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="3.5" cy="14.5" r="1.6" fill="#e2e8f0" />
    <circle cx="8.2" cy="9.8" r="1.6" fill="#5eead4" />
    <circle cx="11.8" cy="12.2" r="1.6" fill="#2dd4bf" />
  </svg>
);

interface AuthBrandShellProps {
  eyebrow?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  children: React.ReactNode;
}

export const AuthBrandShell: React.FC<AuthBrandShellProps> = ({
  eyebrow,
  heroTitle,
  heroSubtitle,
  children,
}) => {
  const { t } = useLanguage();

  return (
    <div className="login-container">
      {/* Left Panel — Architectural Dark Slate & Conformal Demand Schematic */}
      <div className="login-left">
        <div className="login-left-content">
          {/* Brand Identity */}
          <div className="login-logo">
            <div className="login-logo-icon">
              <DfiosBrandMark />
            </div>
            <span className="login-logo-text">DFIOS</span>
            <span className="login-logo-badge">SCM · ML</span>
          </div>

          {/* Hero Copy & Quantitative Demand Schematic */}
          <div className="login-main-showcase">
            <div className="login-hero">
              <div className="login-eyebrow">
                <span className="login-eyebrow-dot" aria-hidden="true" />
                <span>{eyebrow || t('auth.eyebrow')}</span>
              </div>
              <h1 className="login-hero-title">{heroTitle || t('auth.hero_title')}</h1>
              <p className="login-hero-subtitle">{heroSubtitle || t('auth.hero_subtitle')}</p>
            </div>

            {/* Academically Rigorous Conformal Demand Forecast Schematic (All series in Units/Day) */}
            <div className="login-schematic-card" aria-hidden="true">
              <div className="login-schematic-header">
                <span className="login-schematic-tag">{t('auth.schematic_tag')}</span>
                <div className="login-schematic-legend">
                  <span className="schematic-legend-item">
                    <span className="schematic-swatch actual" />
                    {t('auth.schematic_actual')}
                  </span>
                  <span className="schematic-legend-item">
                    <span className="schematic-swatch forecast" />
                    {t('auth.schematic_forecast')}
                  </span>
                  <span className="schematic-legend-item">
                    <span className="schematic-swatch band" />
                    {t('auth.schematic_band')}
                  </span>
                </div>
              </div>

              <div className="login-schematic-canvas">
                <svg
                  viewBox="0 0 480 128"
                  className="login-schematic-svg"
                  preserveAspectRatio="xMidYMid meet"
                >
                  <defs>
                    <linearGradient id="dfiosActualArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.12" />
                      <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.0" />
                    </linearGradient>
                    <linearGradient id="dfiosConformalBand" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.21" />
                      <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.07" />
                    </linearGradient>
                  </defs>

                  {/* Cartesian Gridlines */}
                  <line x1="16" y1="24" x2="432" y2="24" stroke="rgba(148, 163, 184, 0.07)" strokeWidth="1" />
                  <line x1="16" y1="54" x2="432" y2="54" stroke="rgba(148, 163, 184, 0.07)" strokeWidth="1" />
                  <line x1="16" y1="84" x2="432" y2="84" stroke="rgba(148, 163, 184, 0.07)" strokeWidth="1" />
                  <line x1="16" y1="114" x2="432" y2="114" stroke="rgba(148, 163, 184, 0.13)" strokeWidth="1" />

                  {/* Q90 Peak Demand Quantile Bound (Drives Safety Stock Calibration) */}
                  <line
                    x1="244"
                    y1="26"
                    x2="432"
                    y2="26"
                    stroke="rgba(245, 158, 11, 0.45)"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                  />
                  <text x="438" y="29" className="schematic-svg-label q90">
                    Q90
                  </text>

                  {/* Historical Baseline Mean Demand (μ) */}
                  <line
                    x1="16"
                    y1="74"
                    x2="432"
                    y2="74"
                    stroke="rgba(148, 163, 184, 0.32)"
                    strokeWidth="1"
                    strokeDasharray="2 3"
                  />
                  <text x="439" y="77" className="schematic-svg-label mean">
                    μ
                  </text>

                  {/* Horizon Origin Split (t0) */}
                  <line
                    x1="244"
                    y1="16"
                    x2="244"
                    y2="114"
                    stroke="rgba(148, 163, 184, 0.3)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <text x="16" y="13" className="schematic-svg-axis">
                    t-28d
                  </text>
                  <text x="239" y="12.5" className="schematic-svg-axis highlight">
                    t<tspan dy="2" fontSize="6.5">0</tspan>
                  </text>
                  <text x="398" y="13" className="schematic-svg-axis">
                    h+28d
                  </text>

                  {/* Calibrated Conformal Prediction Interval (P10 - P90) */}
                  <polygon
                    points="244,62 276,45 308,36 340,41 372,28 404,24 432,21 432,70 404,69 372,72 340,83 308,77 276,79 244,62"
                    fill="url(#dfiosConformalBand)"
                  />
                  <polyline
                    points="244,62 276,45 308,36 340,41 372,28 404,24 432,21"
                    fill="none"
                    stroke="rgba(45, 212, 191, 0.34)"
                    strokeWidth="0.9"
                  />
                  <polyline
                    points="244,62 276,79 308,77 340,83 372,72 404,69 432,70"
                    fill="none"
                    stroke="rgba(45, 212, 191, 0.28)"
                    strokeWidth="0.9"
                  />

                  {/* Historical Realized Demand Fill + Polyline */}
                  <polygon
                    points="16,114 16,86 48,78 80,84 112,67 144,75 176,55 208,67 244,62 244,114"
                    fill="url(#dfiosActualArea)"
                  />
                  <polyline
                    points="16,86 48,78 80,84 112,67 144,75 176,55 208,67 244,62"
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Predictive P50 Median Demand Trajectory */}
                  <polyline
                    points="244,62 276,62 308,56 340,62 372,50 404,46 432,45"
                    fill="none"
                    stroke="#2dd4bf"
                    strokeWidth="2"
                    strokeDasharray="5 3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Forecast Origin Node & Horizon Terminal */}
                  <circle cx="244" cy="62" r="5.5" fill="rgba(45, 212, 191, 0.18)" />
                  <circle cx="244" cy="62" r="3" fill="#0b1120" stroke="#2dd4bf" strokeWidth="1.75" />
                  <circle cx="432" cy="45" r="2.5" fill="#2dd4bf" />
                </svg>
              </div>

              <div className="login-schematic-specs">
                <div className="schematic-spec-cell">
                  <span className="schematic-spec-label">{t('auth.spec_engine_label')}</span>
                  <span className="schematic-spec-val">{t('auth.spec_engine_val')}</span>
                </div>
                <div className="schematic-spec-cell">
                  <span className="schematic-spec-label">{t('auth.spec_uncertainty_label')}</span>
                  <span className="schematic-spec-val">{t('auth.spec_uncertainty_val')}</span>
                </div>
                <div className="schematic-spec-cell">
                  <span className="schematic-spec-label">{t('auth.spec_policy_label')}</span>
                  <span className="schematic-spec-val">{t('auth.spec_policy_val')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Enterprise Benchmark Footer */}
          <div className="login-footer">
            <p className="login-footer-title">{t('auth.footer_caption')}</p>
            <div className="login-footer-brands">
              <span>{t('auth.enterprise_tag1')}</span>
              <span className="login-footer-sep" aria-hidden="true">·</span>
              <span>{t('auth.enterprise_tag2')}</span>
              <span className="login-footer-sep" aria-hidden="true">·</span>
              <span>{t('auth.enterprise_tag3')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel — Enterprise Authentication Content */}
      <div className="login-right">
        <div className="login-topbar">
          <div className="login-mobile-brand">
            <div className="login-logo-icon mobile">
              <DfiosBrandMark />
            </div>
            <span className="login-mobile-brand-text">DFIOS</span>
            <span className="login-mobile-brand-badge">SCM · ML</span>
          </div>
          <div className="login-lang-slot">
            <LanguageToggle />
          </div>
        </div>

        <div className="login-form-container">{children}</div>
      </div>
    </div>
  );
};

