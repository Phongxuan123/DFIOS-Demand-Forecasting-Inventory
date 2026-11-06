import React, { useState } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import { apiClient } from '../../services/apiClient.ts';
import { useLanguage } from '../../context/LanguageContext.tsx';
import { AuthBrandShell } from './AuthBrandShell.tsx';
import { Eye, EyeOff, AlertCircle, CheckCircle2, Loader2, ArrowLeft, ArrowRight } from 'lucide-react';
import './Login.css';

export const ForgotPassword: React.FC = () => {
  const { language, t } = useLanguage();
  const isVi = language === 'vi';
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const urlToken = searchParams.get('token') || '';
  const isResetPath = location.pathname.includes('/reset-password') || !!urlToken;

  const [mode, setMode] = useState<'request' | 'reset'>(() => (isResetPath ? 'reset' : 'request'));
  const [resetToken, setResetToken] = useState(() => urlToken);
  const [email, setEmail] = useState('');
  const [isSent, setIsSent] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (mode === 'reset') {
      if (!resetToken.trim()) {
        setError(
          isVi
            ? 'Vui lòng nhập mã token đặt lại mật khẩu nhận được từ email.'
            : 'Please enter the reset token received in your email.'
        );
        return;
      }
      if (newPassword.length < 6) {
        setError(
          isVi
            ? 'Mật khẩu mới phải có độ dài tối thiểu từ 6 ký tự.'
            : 'New password must be at least 6 characters.'
        );
        return;
      }
      if (newPassword !== confirmPassword) {
        setError(
          isVi
            ? 'Mật khẩu xác nhận không khớp với mật khẩu mới.'
            : 'Confirm password does not match new password.'
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (mode === 'reset') {
        await apiClient.post('/auth/reset-password', {
          token: resetToken.trim(),
          new_password: newPassword,
        });
        setMessage(
          isVi
            ? 'Mật khẩu đã được thiết lập lại thành công. Bạn có thể đăng nhập ngay với mật khẩu mới.'
            : 'Password reset successfully. You can now sign in with your new password.'
        );
      } else {
        await apiClient.post('/auth/forgot-password', { email: email.trim().toLowerCase() });
        setIsSent(true);
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(
        detail ||
          (isVi
            ? 'Yêu cầu không thành công. Vui lòng kiểm tra lại thông tin.'
            : 'Request failed. Please verify your information.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (setter: React.Dispatch<React.SetStateAction<string>>, val: string) => {
    setter(val);
    if (error) setError('');
  };

  const handlePasswordKeyEvent = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockActive(e.getModifierState('CapsLock'));
  };

  return (
    <AuthBrandShell eyebrow={t('auth.recovery_eyebrow')}>
      <div className="login-form-header">
        <h2 className="login-title">
          {mode === 'reset' ? t('auth.reset_title') : t('auth.forgot_title')}
        </h2>
        <p className="login-subtitle">
          {mode === 'reset' ? t('auth.reset_subtitle') : t('auth.forgot_subtitle')}
        </p>
      </div>

      {error && (
        <div className="login-error-card" role="alert">
          <AlertCircle size={16} className="login-error-icon" />
          <span>{error}</span>
        </div>
      )}

      {message ? (
        <div>
          <div className="auth-success-card" role="status">
            <CheckCircle2 size={18} className="auth-success-icon" />
            <span>{message}</span>
          </div>
          <Link to="/login" className="btn-primary login-btn">
            <span>{t('auth.signin_new_password')}</span>
            <ArrowRight size={15} className="login-btn-arrow" />
          </Link>
        </div>
      ) : isSent ? (
        <div>
          <div className="auth-success-card" role="status">
            <CheckCircle2 size={18} className="auth-success-icon" />
            <span>
              {isVi ? (
                <>
                  Hướng dẫn đặt lại mật khẩu đã được gửi đến email <strong>{email}</strong> nếu tài khoản tồn tại. Vui lòng kiểm tra hộp thư của bạn.
                </>
              ) : (
                <>
                  Password reset instructions have been sent to <strong>{email}</strong> if the account exists. Please check your inbox.
                </>
              )}
            </span>
          </div>
          <div className="auth-actions-stack">
            <button
              type="button"
              className="btn-primary login-btn"
              onClick={() => {
                setIsSent(false);
                setMode('reset');
              }}
            >
              <span>{t('auth.have_token_cta')}</span>
              <ArrowRight size={15} className="login-btn-arrow" />
            </button>
            <Link to="/login" className="btn-secondary">
              <ArrowLeft size={15} />
              <span>{t('auth.back_to_signin')}</span>
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="login-form">
          {mode === 'reset' ? (
            <>
              {!urlToken ? (
                <div className="form-group">
                  <label htmlFor="reset-token" className="form-label">
                    {t('auth.reset_token_label')}
                  </label>
                  <input
                    id="reset-token"
                    type="text"
                    className="form-input mono-token"
                    value={resetToken}
                    disabled={isSubmitting}
                    onChange={(e) => handleInputChange(setResetToken, e.target.value.trim())}
                    placeholder={t('auth.reset_token_placeholder')}
                    required
                  />
                </div>
              ) : (
                <div className="auth-verified-pill">
                  <CheckCircle2 size={15} className="auth-verified-icon" />
                  <span>{t('auth.reset_token_verified')}</span>
                </div>
              )}

              <div className="form-group">
                <div className="form-label-row">
                  <div className="form-label-inline">
                    <label htmlFor="reset-new-password" className="form-label" style={{ marginBottom: 0 }}>
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
                    id="reset-new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className="form-input password-input"
                    value={newPassword}
                    disabled={isSubmitting}
                    onChange={(e) => handleInputChange(setNewPassword, e.target.value)}
                    onKeyDown={handlePasswordKeyEvent}
                    onKeyUp={handlePasswordKeyEvent}
                    placeholder="••••••••••••"
                    minLength={6}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    aria-label={showNewPassword ? t('auth.hide_password') : t('auth.show_password')}
                    tabIndex={-1}
                  >
                    {showNewPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <div className="form-label-row">
                  <label htmlFor="reset-confirm-password" className="form-label" style={{ marginBottom: 0 }}>
                    {t('auth.confirm_new_password_label')}
                  </label>
                  {confirmPassword && newPassword !== confirmPassword && (
                    <span className="auth-match-badge mismatch">{t('auth.mismatch')}</span>
                  )}
                  {confirmPassword && newPassword === confirmPassword && (
                    <span className="auth-match-badge matched">{t('auth.matched')}</span>
                  )}
                </div>
                <div className="password-input-wrapper">
                  <input
                    id="reset-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className="form-input password-input"
                    value={confirmPassword}
                    disabled={isSubmitting}
                    onChange={(e) => handleInputChange(setConfirmPassword, e.target.value)}
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
            </>
          ) : (
            <div className="form-group">
              <label htmlFor="recovery-email" className="form-label">
                {t('auth.corporate_email_label')}
              </label>
              <input
                id="recovery-email"
                type="email"
                autoComplete="email"
                className="form-input"
                value={email}
                disabled={isSubmitting}
                onChange={(e) => handleInputChange(setEmail, e.target.value)}
                placeholder="manager@dfios.com"
                required
              />
            </div>
          )}

          <button type="submit" className="btn-primary login-btn" disabled={isSubmitting}>
            {isSubmitting ? (
              <span className="login-btn-inner">
                <Loader2 size={16} className="login-spinner" />
                <span>{t('auth.processing')}</span>
              </span>
            ) : (
              <span className="login-btn-inner">
                <span>
                  {mode === 'reset' ? t('auth.confirm_reset_btn') : t('auth.send_recovery_btn')}
                </span>
                <ArrowRight size={15} className="login-btn-arrow" />
              </span>
            )}
          </button>
        </form>
      )}

      {!message && !isSent && (
        <div className="auth-footer-nav">
          {mode === 'reset' ? (
            <button
              type="button"
              className="auth-mode-switch-btn"
              onClick={() => {
                setMode('request');
                setError('');
                setMessage('');
              }}
            >
              {t('auth.switch_to_email_mode')}
            </button>
          ) : (
            <button
              type="button"
              className="auth-mode-switch-btn"
              onClick={() => {
                setMode('reset');
                setError('');
                setMessage('');
              }}
            >
              {t('auth.switch_to_token_mode')}
            </button>
          )}

          <Link to="/login" className="auth-back-link">
            <ArrowLeft size={14} className="auth-back-arrow" />
            <span>{t('auth.back_to_signin')}</span>
          </Link>
        </div>
      )}
    </AuthBrandShell>
  );
};
