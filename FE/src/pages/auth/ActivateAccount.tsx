import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../../services/apiClient.ts';
import { useLanguage } from '../../context/LanguageContext.tsx';
import { AuthBrandShell } from './AuthBrandShell.tsx';
import { Eye, EyeOff, AlertCircle, CheckCircle2, Loader2, ArrowLeft, ArrowRight } from 'lucide-react';
import './Login.css';

export const ActivateAccount: React.FC = () => {
  const { language, t } = useLanguage();
  const isVi = language === 'vi';
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get('token') || '';
  const [token, setToken] = useState(() => urlToken);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');

    if (!token.trim()) {
      setError(
        isVi
          ? 'Vui lòng nhập mã token kích hoạt nhận được từ email thư mời.'
          : 'Please enter the activation token received from your invitation email.'
      );
      return;
    }

    if (password.length < 6) {
      setError(
        isVi
          ? 'Mật khẩu phải có độ dài tối thiểu từ 6 ký tự.'
          : 'Password must be at least 6 characters.'
      );
      return;
    }

    if (password !== confirmPassword) {
      setError(
        isVi
          ? 'Mật khẩu xác nhận không khớp với mật khẩu đã nhập.'
          : 'Confirm password does not match.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post('/auth/activate', { token: token.trim(), password });
      setMessage(
        isVi
          ? 'Tài khoản đã được kích hoạt thành công! Bạn có thể đăng nhập vào hệ thống ngay bây giờ.'
          : 'Account activated successfully! You can now sign in to your DFIOS cockpit.'
      );
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(
        detail ||
          (isVi
            ? 'Không thể kích hoạt tài khoản. Liên kết có thể đã hết hạn hoặc mã token không hợp lệ.'
            : 'Failed to activate account. The link may have expired or token is invalid.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordChange = (val: string) => {
    setPassword(val);
    if (error) setError('');
  };

  const handleConfirmPasswordChange = (val: string) => {
    setConfirmPassword(val);
    if (error) setError('');
  };

  const handlePasswordKeyEvent = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockActive(e.getModifierState('CapsLock'));
  };

  return (
    <AuthBrandShell
      eyebrow={t('auth.activate_eyebrow')}
      heroTitle={t('auth.activate_hero_title')}
      heroSubtitle={t('auth.activate_hero_subtitle')}
    >
      <div className="login-form-header">
        <h2 className="login-title">{t('auth.activate_title')}</h2>
        <p className="login-subtitle">{t('auth.activate_subtitle')}</p>
      </div>

      {message ? (
        <div>
          <div className="auth-success-card" role="status">
            <CheckCircle2 size={18} className="auth-success-icon" />
            <span>{message}</span>
          </div>
          <Link to="/login" className="btn-primary login-btn">
            <span>{t('auth.sign_in')}</span>
            <ArrowRight size={15} className="login-btn-arrow" />
          </Link>
        </div>
      ) : (
        <>
          {error && (
            <div className="login-error-card" role="alert">
              <AlertCircle size={16} className="login-error-icon" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            {!urlToken ? (
              <div className="form-group">
                <label htmlFor="activate-token" className="form-label">
                  {t('auth.activation_token_label')}
                </label>
                <input
                  id="activate-token"
                  type="text"
                  className="form-input mono-token"
                  value={token}
                  disabled={isSubmitting}
                  onChange={(e) => {
                    setToken(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder={t('auth.activation_token_placeholder')}
                  required
                />
              </div>
            ) : (
              <div className="auth-verified-pill">
                <CheckCircle2 size={15} className="auth-verified-icon" />
                <span>{t('auth.activation_token_verified')}</span>
              </div>
            )}

            <div className="form-group">
              <div className="form-label-row">
                <div className="form-label-inline">
                  <label htmlFor="activate-password" className="form-label" style={{ marginBottom: 0 }}>
                    {t('auth.new_password_label')}
                  </label>
                  {capsLockActive && (
                    <span className="caps-lock-badge">{t('auth.caps_lock')}</span>
                  )}
                </div>
                <span className="form-label-hint">{t('auth.min_password_hint')}</span>
              </div>
              <div className="password-input-wrapper">
                <input
                  id="activate-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  className="form-input password-input"
                  value={password}
                  disabled={isSubmitting}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  onKeyDown={handlePasswordKeyEvent}
                  onKeyUp={handlePasswordKeyEvent}
                  placeholder="••••••••••••"
                  minLength={6}
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

            <div className="form-group">
              <div className="form-label-row">
                <label htmlFor="activate-confirm-password" className="form-label" style={{ marginBottom: 0 }}>
                  {t('auth.confirm_password_label')}
                </label>
                {confirmPassword && password !== confirmPassword && (
                  <span className="auth-match-badge mismatch">{t('auth.mismatch')}</span>
                )}
                {confirmPassword && password === confirmPassword && (
                  <span className="auth-match-badge matched">{t('auth.matched')}</span>
                )}
              </div>
              <div className="password-input-wrapper">
                <input
                  id="activate-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  className="form-input password-input"
                  value={confirmPassword}
                  disabled={isSubmitting}
                  onChange={(e) => handleConfirmPasswordChange(e.target.value)}
                  onKeyDown={handlePasswordKeyEvent}
                  onKeyUp={handlePasswordKeyEvent}
                  placeholder="••••••••••••"
                  minLength={6}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? t('auth.hide_password') : t('auth.show_password')}
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button className="btn-primary login-btn" type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="login-btn-inner">
                  <Loader2 size={16} className="login-spinner" />
                  <span>{t('auth.activating_btn')}</span>
                </span>
              ) : (
                <span className="login-btn-inner">
                  <span>{t('auth.activate_btn')}</span>
                  <ArrowRight size={15} className="login-btn-arrow" />
                </span>
              )}
            </button>
          </form>

          <div className="auth-footer-nav">
            <Link to="/login" className="auth-back-link">
              <ArrowLeft size={14} className="auth-back-arrow" />
              <span>{t('auth.back_to_signin')}</span>
            </Link>
          </div>
        </>
      )}
    </AuthBrandShell>
  );
};
