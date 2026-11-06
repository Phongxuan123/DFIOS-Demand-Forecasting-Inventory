import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { apiClient } from '../../services/apiClient.ts';
import { useLanguage } from '../../context/LanguageContext.tsx';
import { AuthBrandShell } from './AuthBrandShell.tsx';
import { CheckCircle2, AlertCircle, ArrowLeft, ArrowRight } from 'lucide-react';
import './Login.css';

export const ConfirmEmail: React.FC = () => {
  const { language, t } = useLanguage();
  const isVi = language === 'vi';
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get('token') || '';
  const [token, setToken] = useState(() => urlToken);
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>(() =>
    urlToken ? 'verifying' : 'idle'
  );
  const [message, setMessage] = useState('');

  const executeConfirm = async (tokenToVerify: string) => {
    if (!tokenToVerify.trim()) {
      setStatus('error');
      setMessage(
        isVi
          ? 'Vui lòng nhập mã xác thực (Token) để xác nhận đổi email.'
          : 'Please enter the verification token to confirm your email change.'
      );
      return;
    }

    setStatus('verifying');
    try {
      const res = await apiClient.post('/auth/me/email/confirm', { token: tokenToVerify.trim() });
      setStatus('success');
      setMessage(
        res.data?.message ||
          (isVi
            ? 'Địa chỉ email của bạn đã được xác nhận và cập nhật thành công!'
            : 'Your email address has been verified and updated successfully!')
      );
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setStatus('error');
      setMessage(
        detail ||
          (isVi
            ? 'Liên kết hoặc mã xác nhận không hợp lệ hoặc đã hết hạn.'
            : 'Invalid or expired confirmation link or token.')
      );
    }
  };

  useEffect(() => {
    if (urlToken) {
      executeConfirm(urlToken);
    }
  }, [urlToken]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeConfirm(token);
  };

  return (
    <AuthBrandShell eyebrow={t('auth.confirm_email_eyebrow')}>
      <div className="login-form-header">
        <h2 className="login-title">{t('auth.confirm_email_title')}</h2>
        <p className="login-subtitle">{t('auth.confirm_email_subtitle')}</p>
      </div>

      {status === 'verifying' && (
        <div className="auth-verifying-card" role="status">
          <div className="auth-verifying-spinner" />
          <span>{t('auth.confirm_email_verifying')}</span>
        </div>
      )}

      {status === 'success' && (
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
      )}

      {status !== 'success' && status !== 'verifying' && (
        <div>
          {status === 'error' && (
            <div className="login-error-card" role="alert">
              <AlertCircle size={16} className="login-error-icon" />
              <span>{message}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="confirm-email-token" className="form-label">
                {t('auth.confirm_email_token_label')}
              </label>
              <input
                id="confirm-email-token"
                type="text"
                className="form-input mono-token"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value.trim());
                  if (status === 'error') setStatus('idle');
                }}
                placeholder={t('auth.confirm_email_token_placeholder')}
                required
              />
            </div>

            <button type="submit" className="btn-primary login-btn">
              <span className="login-btn-inner">
                <span>{t('auth.confirm_email_btn')}</span>
                <ArrowRight size={15} className="login-btn-arrow" />
              </span>
            </button>
          </form>

          <div className="auth-footer-nav">
            <Link to="/login" className="auth-back-link">
              <ArrowLeft size={14} className="auth-back-arrow" />
              <span>{t('auth.back_to_signin')}</span>
            </Link>
          </div>
        </div>
      )}
    </AuthBrandShell>
  );
};
