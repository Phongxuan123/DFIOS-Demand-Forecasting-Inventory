import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.tsx';
import { useLanguage } from '../../context/LanguageContext.tsx';
import { AuthBrandShell } from './AuthBrandShell.tsx';
import { Eye, EyeOff, AlertCircle, Loader2, Info, ArrowRight, ShieldCheck } from 'lucide-react';
import './Login.css';

export const Login: React.FC = () => {
  const { t } = useLanguage();
  const [email, setEmail] = useState(() => localStorage.getItem('dfios_remembered_email') || '');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('dfios_remember_me') !== 'false');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const { login, isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';

  // If already authenticated, redirect immediately
  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  // Check if redirected due to session expiry
  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('dfios_session_expired')) {
      setSessionExpiredNotice(true);
      sessionStorage.removeItem('dfios_session_expired');
    }
  }, []);

  // Intelligent autofocus
  useEffect(() => {
    if (!isAuthenticated) {
      if (email) {
        passwordRef.current?.focus();
      } else {
        emailRef.current?.focus();
      }
    }
  }, [isAuthenticated]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSessionExpiredNotice(false);
    try {
      await login(email.trim(), password);
      if (rememberMe) {
        localStorage.setItem('dfios_remember_me', 'true');
        localStorage.setItem('dfios_remembered_email', email.trim());
      } else {
        localStorage.setItem('dfios_remember_me', 'false');
        localStorage.removeItem('dfios_remembered_email');
      }
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setError(message || t('auth.login_failed'));
    }
  };

  const handleEmailChange = (val: string) => {
    setEmail(val);
    if (error) setError('');
    if (sessionExpiredNotice) setSessionExpiredNotice(false);
  };

  const handlePasswordChange = (val: string) => {
    setPassword(val);
    if (error) setError('');
    if (sessionExpiredNotice) setSessionExpiredNotice(false);
  };

  const handlePasswordKeyEvent = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockActive(e.getModifierState('CapsLock'));
  };

  return (
    <AuthBrandShell>
      <div className="login-form-header">
        <h2 className="login-title">{t('auth.welcome_back')}</h2>
        <p className="login-subtitle">{t('auth.login_subtitle')}</p>
      </div>

      {sessionExpiredNotice && (
        <div className="session-expired-card" role="status">
          <Info size={16} className="session-expired-icon" />
          <span>{t('auth.session_expired')}</span>
        </div>
      )}

      {error && (
        <div className="login-error-card" role="alert">
          <AlertCircle size={16} className="login-error-icon" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="login-form">
        <div className="form-group">
          <label htmlFor="login-email" className="form-label">
            {t('auth.email_label')}
          </label>
          <input
            id="login-email"
            ref={emailRef}
            type="email"
            name="email"
            autoComplete="username"
            className="form-input"
            value={email}
            disabled={isLoading}
            onChange={(e) => handleEmailChange(e.target.value)}
            placeholder="admin@dfios.com"
            required
          />
        </div>

        <div className="form-group">
          <div className="form-label-row">
            <div className="form-label-inline">
              <label htmlFor="login-password" className="form-label" style={{ marginBottom: 0 }}>
                {t('auth.password_label')}
              </label>
              {capsLockActive && (
                <span className="caps-lock-badge">{t('auth.caps_lock')}</span>
              )}
            </div>
            <Link to="/forgot-password" className="forgot-password">
              {t('auth.forgot_password')}
            </Link>
          </div>
          <div className="password-input-wrapper">
            <input
              id="login-password"
              ref={passwordRef}
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              className="form-input password-input"
              value={password}
              disabled={isLoading}
              onChange={(e) => handlePasswordChange(e.target.value)}
              onKeyDown={handlePasswordKeyEvent}
              onKeyUp={handlePasswordKeyEvent}
              placeholder="••••••••••••"
              required
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? t('auth.hide_password') : t('auth.show_password')}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </div>

        <div className="remember-me-group">
          <input
            type="checkbox"
            id="remember"
            className="remember-checkbox"
            checked={rememberMe}
            disabled={isLoading}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          <label htmlFor="remember" className="remember-label">
            {t('auth.remember_me')}
          </label>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="btn-primary login-btn"
        >
          {isLoading ? (
            <span className="login-btn-inner">
              <Loader2 size={16} className="login-spinner" />
              <span>{t('auth.signing_in')}</span>
            </span>
          ) : (
            <span className="login-btn-inner">
              <span>{t('auth.sign_in')}</span>
              <ArrowRight size={15} className="login-btn-arrow" />
            </span>
          )}
        </button>
      </form>

      {/* Structured Enterprise Account Provisioning Notice */}
      <div className="login-onboarding-hint">
        <ShieldCheck size={16} className="login-onboarding-icon" />
        <div className="login-onboarding-content">
          <span className="login-onboarding-title">{t('auth.need_account_title')}</span>
          <p>
            {t('auth.provisioned_desc')}
            <Link to="/activate" className="login-activate-link">
              {t('auth.activate_link')}
            </Link>
            .
          </p>
        </div>
      </div>
    </AuthBrandShell>
  );
};
