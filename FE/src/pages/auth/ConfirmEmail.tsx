import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { apiClient } from '../../services/apiClient.ts';
import { useLanguage } from '../../context/LanguageContext.tsx';
import { LanguageToggle } from '../../components/common/LanguageToggle.tsx';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import './Login.css';

export const ConfirmEmail: React.FC = () => {
  const { language } = useLanguage();
  const isVi = language === 'vi';
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get('token') || '';
  const [token, setToken] = useState(() => urlToken);
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>(() => urlToken ? 'verifying' : 'idle');
  const [message, setMessage] = useState('');

  const executeConfirm = async (tokenToVerify: string) => {
    if (!tokenToVerify.trim()) {
      setStatus('error');
      setMessage(isVi ? 'Vui lòng nhập mã xác thực (Token) để xác nhận đổi email.' : 'Please enter the verification token to confirm your email change.');
      return;
    }

    setStatus('verifying');
    try {
      const res = await apiClient.post('/auth/me/email/confirm', { token: tokenToVerify.trim() });
      setStatus('success');
      setMessage(res.data?.message || (isVi ? 'Địa chỉ email của bạn đã được xác nhận và cập nhật thành công!' : 'Your email address has been verified and updated successfully!'));
    } catch (err: any) {
      setStatus('error');
      setMessage(err.response?.data?.detail || (isVi ? 'Liên kết hoặc mã xác nhận không hợp lệ hoặc đã hết hạn.' : 'Invalid or expired confirmation link or token.'));
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
    <div className="login-container">
      {/* Left Side - Dark Theme */}
      <div className="login-left">
        <div className="login-left-content">
          <div className="login-logo">
            <div className="login-logo-icon">D</div>
            <span className="login-logo-text">DFIOS</span>
          </div>

          <div className="login-hero">
            <h1 className="login-hero-title">
              Intelligent Inventory Decisions, Powered by Machine Learning
            </h1>
            <p className="login-hero-subtitle">
              Forecast demand spikes, reduce stockouts, and optimize safety stocks with enterprise-grade ML models.
            </p>
          </div>

          <div className="login-footer">
            <p className="login-footer-title">Enterprise Supply Chain & Demand Intelligence</p>
            <div className="login-footer-brands">
              <span>WALMART M5 BENCHMARK</span>
              <span>CONFORMAL ML ENGINE</span>
              <span>MULTI-ECHELON SCM</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side */}
      <div className="login-right">
        <div style={{ position: "absolute", top: 20, right: 20, zIndex: 10 }}>
          <LanguageToggle />
        </div>
        <div className="login-form-container">
          <h2 className="login-title">{isVi ? "Xác nhận cập nhật email" : "Confirm Email Update"}</h2>
          <p className="login-subtitle">{isVi ? "Xác minh quyền sở hữu hòm thư liên hệ mới của tài khoản DFIOS." : "Verify ownership of the updated corporate email address for your DFIOS account."}</p>

          {status === 'verifying' && (
            <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: '#64748b' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                <div className="auth-splash-spinner" style={{ borderColor: 'rgba(13, 148, 136, 0.2)', borderTopColor: '#0d9488' }}></div>
                <span style={{ fontSize: '0.875rem', color: '#475569' }}>{isVi ? "Đang xác thực liên kết email, vui lòng đợi trong giây lát..." : "Verifying email confirmation link, please wait..."}</span>
              </div>
            </div>
          )}

          {status === 'success' && (
            <div>
              <div
                style={{
                  backgroundColor: '#ccfbf1',
                  color: '#0f766e',
                  padding: '1.25rem',
                  borderRadius: '0.5rem',
                  marginBottom: '1.5rem',
                  fontSize: '0.875rem',
                  lineHeight: '1.5',
                  border: '1px solid #99f6e4',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                }}
              >
                <CheckCircle2 size={18} className="text-teal-600 flex-shrink-0 mt-0.5" />
                <span>{message}</span>
              </div>
              <Link to="/login" className="btn-primary login-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                {isVi ? "Đăng nhập vào hệ thống" : "Sign In to Dashboard"}
              </Link>
            </div>
          )}

          {status !== 'success' && status !== 'verifying' && (
            <div>
              {status === 'error' && (
                <div className="login-error-card" style={{ marginBottom: '1.5rem' }}>
                  <AlertCircle size={16} className="login-error-icon" />
                  <span>{message}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="login-form">
                <div className="form-group">
                  <label className="form-label">{isVi ? "Mã xác nhận (Token từ email mới)" : "Confirmation Token (from new email)"}</label>
                  <input
                    type="text"
                    className="form-input"
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value.trim());
                      if (status === 'error') setStatus('idle');
                    }}
                    placeholder={isVi ? "Dán mã token xác nhận từ email mới..." : "Paste confirmation token from email..."}
                    required
                  />
                </div>

                <button type="submit" className="btn-primary login-btn">
                  {isVi ? "Xác nhận thay đổi email" : "Confirm Email Change"}
                </button>
              </form>

              <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
                <Link to="/login" style={{ color: '#0d9488', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
                  {isVi ? "Quay lại trang Đăng nhập" : "Back to Sign In"}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
