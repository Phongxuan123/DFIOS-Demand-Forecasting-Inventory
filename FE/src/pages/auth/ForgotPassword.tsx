import React, { useState } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import { apiClient } from '../../services/apiClient.ts';
import { useLanguage } from '../../context/LanguageContext.tsx';
import { LanguageToggle } from '../../components/common/LanguageToggle.tsx';
import { Eye, EyeOff, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import './Login.css';

export const ForgotPassword: React.FC = () => {
  const { language } = useLanguage();
  const isVi = language === 'vi';
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const urlToken = searchParams.get('token') || '';
  const isResetPath = location.pathname.includes('/reset-password') || !!urlToken;
  
  const [mode, setMode] = useState<'request' | 'reset'>(() => isResetPath ? 'reset' : 'request');
  const [resetToken, setResetToken] = useState(() => urlToken);
  const [email, setEmail] = useState('');
  const [isSent, setIsSent] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    
    if (mode === 'reset') {
      if (!resetToken.trim()) {
        setError(isVi ? 'Vui lòng nhập mã token đặt lại mật khẩu nhận được từ email.' : 'Please enter the reset token received in your email.');
        return;
      }
      if (newPassword.length < 6) {
        setError(isVi ? 'Mật khẩu mới phải có độ dài tối thiểu từ 6 ký tự.' : 'New password must be at least 6 characters.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError(isVi ? 'Mật khẩu xác nhận không khớp với mật khẩu mới.' : 'Confirm password does not match new password.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (mode === 'reset') {
        await apiClient.post('/auth/reset-password', { token: resetToken.trim(), new_password: newPassword });
        setMessage(isVi ? 'Mật khẩu đã được thiết lập lại thành công. Bạn có thể đăng nhập ngay với mật khẩu mới.' : 'Password reset successfully. You can now sign in with your new password.');
      } else {
        await apiClient.post('/auth/forgot-password', { email: email.trim().toLowerCase() });
        setIsSent(true);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || (isVi ? 'Yêu cầu không thành công. Vui lòng kiểm tra lại thông tin.' : 'Request failed. Please verify your information.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (setter: React.Dispatch<React.SetStateAction<string>>, val: string) => {
    setter(val);
    if (error) setError('');
  };

  return (
    <div className="login-container">
      {/* Left Side - Dark Theme */}
      <div className="login-left">
        <div className="login-left-content">
          {/* Logo */}
          <div className="login-logo">
            <div className="login-logo-icon">D</div>
            <span className="login-logo-text">DFIOS</span>
          </div>

          {/* Main Text */}
          <div className="login-hero">
            <h1 className="login-hero-title">
              Intelligent Inventory Decisions, Powered by Machine Learning
            </h1>
            <p className="login-hero-subtitle">
              Forecast demand spikes, reduce stockouts, and optimize safety stocks with enterprise-grade ML models scaled for growing retailers.
            </p>
          </div>

          {/* Footer Logos */}
          <div className="login-footer">
            <p className="login-footer-title">
              Enterprise Supply Chain & Demand Intelligence
            </p>
            <div className="login-footer-brands">
              <span>WALMART M5 BENCHMARK</span>
              <span>CONFORMAL ML ENGINE</span>
              <span>MULTI-ECHELON SCM</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="login-right">
        <div style={{ position: "absolute", top: 20, right: 20, zIndex: 10 }}>
          <LanguageToggle />
        </div>
        <div className="login-form-container">
          <h2 className="login-title">{mode === 'reset' ? (isVi ? 'Thiết lập mật khẩu mới' : 'Reset Your Password') : (isVi ? 'Khôi phục mật khẩu' : 'Forgot Password')}</h2>
          <p className="login-subtitle">
            {mode === 'reset'
              ? (isVi ? 'Nhập mã token từ email và thiết lập mật khẩu mới cho tài khoản DFIOS của bạn.' : 'Enter your reset token from email and configure a new password.')
              : (isVi ? 'Nhập địa chỉ email doanh nghiệp đã đăng ký. Hệ thống sẽ gửi liên kết khôi phục an toàn đến hộp thư của bạn.' : 'Enter your corporate email address to receive password reset instructions.')}
          </p>

          {error && (
            <div className="login-error-card">
              <AlertCircle size={16} className="login-error-icon" />
              <span>{error}</span>
            </div>
          )}

          {message ? (
            <div>
              <div
                style={{
                  backgroundColor: '#ccfbf1',
                  color: '#0f766e',
                  padding: '1.25rem',
                  borderRadius: '0.5rem',
                  marginBottom: '1.5rem',
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  lineHeight: '1.5',
                  border: '1px solid #99f6e4',
                }}
              >
                <CheckCircle2 size={18} className="text-teal-600 flex-shrink-0 mt-0.5" />
                <span>{message}</span>
              </div>
              <Link to="/login" className="btn-primary login-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                {isVi ? 'Đăng nhập với mật khẩu mới' : 'Sign in with new password'}
              </Link>
            </div>
          ) : isSent ? (
            <div>
              <div
                style={{
                  backgroundColor: '#ccfbf1',
                  color: '#0f766e',
                  padding: '1.25rem',
                  borderRadius: '0.5rem',
                  marginBottom: '1.5rem',
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  lineHeight: '1.5',
                  border: '1px solid #99f6e4',
                }}
              >
                <CheckCircle2 size={18} className="text-teal-600 flex-shrink-0 mt-0.5" />
                <span>{isVi ? <>Hướng dẫn đặt lại mật khẩu đã được gửi đến email <strong>{email}</strong> nếu tài khoản tồn tại. Vui lòng kiểm tra hộp thư của bạn.</> : <>Password reset instructions sent to <strong>{email}</strong> if the account exists. Please check your inbox.</>}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn-primary login-btn"
                  onClick={() => {
                    setIsSent(false);
                    setMode('reset');
                  }}
                >
                  {isVi ? 'Tôi đã nhận mã token, đặt mật khẩu ngay' : 'I have a reset token, set password now'}
                </button>
                <Link to="/login" className="btn-secondary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                  {isVi ? 'Quay lại trang Đăng nhập' : 'Back to Sign In'}
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="login-form">
              {mode === 'reset' ? (
                <>
                  {!urlToken ? (
                    <div className="form-group">
                      <label className="form-label">{isVi ? "Mã xác nhận (Token từ email)" : "Reset Token (from email)"}</label>
                      <input
                        type="text"
                        className="form-input"
                        value={resetToken}
                        disabled={isSubmitting}
                        onChange={(e) => handleInputChange(setResetToken, e.target.value.trim())}
                        placeholder={isVi ? "Dán mã token được gửi trong email..." : "Paste verification token from email..."}
                        required
                      />
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.625rem 0.875rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.375rem', marginBottom: '0.5rem', fontSize: '0.75rem', color: '#166534' }}>
                      <CheckCircle2 size={15} className="text-emerald-600 flex-shrink-0" />
                      <span>{isVi ? "Mã xác thực đặt lại mật khẩu đã được nhận diện hợp lệ" : "Reset token verified from email link"}</span>
                    </div>
                  )}

                  <div className="form-group">
                    <label className="form-label">{isVi ? "Mật khẩu mới (Tối thiểu 6 ký tự)" : "New Password (Min 6 characters)"}</label>
                    <div className="password-input-wrapper">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        className="form-input password-input"
                        value={newPassword}
                        disabled={isSubmitting}
                        onChange={(e) => handleInputChange(setNewPassword, e.target.value)}
                        placeholder="••••••••••••"
                        minLength={6}
                        required
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                        tabIndex={-1}
                      >
                        {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="form-label-row">
                      <label className="form-label" style={{ marginBottom: 0 }}>{isVi ? "Xác nhận mật khẩu mới" : "Confirm New Password"}</label>
                      {confirmPassword && newPassword !== confirmPassword && (
                        <span style={{ fontSize: '0.6875rem', color: '#dc2626', fontWeight: 600 }}>{isVi ? "Chưa khớp" : "Mismatch"}</span>
                      )}
                      {confirmPassword && newPassword === confirmPassword && (
                        <span style={{ fontSize: '0.6875rem', color: '#16a34a', fontWeight: 600 }}>{isVi ? "Khớp chính xác" : "Matched"}</span>
                      )}
                    </div>
                    <div className="password-input-wrapper">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        className="form-input password-input"
                        value={confirmPassword}
                        disabled={isSubmitting}
                        onChange={(e) => handleInputChange(setConfirmPassword, e.target.value)}
                        placeholder="••••••••••••"
                        minLength={6}
                        required
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                        tabIndex={-1}
                      >
                        {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="form-group">
                  <label className="form-label">{isVi ? "Email tài khoản" : "Corporate Email Address"}</label>
                  <input
                    type="email"
                    className="form-input"
                    value={email}
                    disabled={isSubmitting}
                    onChange={(e) => handleInputChange(setEmail, e.target.value)}
                    placeholder="manager@dfios.com"
                    required
                  />
                </div>
              )}

              <button
                type="submit"
                className="btn-primary login-btn"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <Loader2 size={16} className="animate-spin" />
                    <span>{isVi ? "Đang xử lý..." : "Processing..."}</span>
                  </span>
                ) : (
                  mode === 'reset' ? (isVi ? 'Xác nhận đổi mật khẩu' : 'Confirm Password Reset') : (isVi ? 'Gửi liên kết khôi phục' : 'Send Recovery Instructions')
                )}
              </button>
            </form>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center', marginTop: '1.25rem' }}>
            {mode === 'reset' ? (
              <button
                type="button"
                onClick={() => {
                  setMode('request');
                  setError('');
                  setMessage('');
                }}
                style={{ background: 'none', border: 'none', color: '#0d9488', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
              >
                {isVi ? "Chưa có mã xác nhận? Gửi liên kết qua email" : "Need a code? Send reset link via email"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMode('reset');
                  setError('');
                  setMessage('');
                }}
                style={{ background: 'none', border: 'none', color: '#0d9488', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
              >
                {isVi ? "Đã có mã token? Đặt lại mật khẩu ngay" : "Already have a token? Set password now"}
              </button>
            )}

            <Link to="/login" style={{ color: '#64748b', fontSize: '0.8125rem', fontWeight: 500, textDecoration: 'none' }}>
              {isVi ? "Quay lại Đăng nhập" : "Back to Sign In"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
