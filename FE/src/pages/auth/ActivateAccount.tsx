import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../../services/apiClient.ts';
import { useLanguage } from '../../context/LanguageContext.tsx';
import { LanguageToggle } from '../../components/common/LanguageToggle.tsx';
import { Eye, EyeOff, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import './Login.css';

export const ActivateAccount: React.FC = () => {
  const { language } = useLanguage();
  const isVi = language === 'vi';
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get('token') || '';
  const [token, setToken] = useState(() => urlToken);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');

    if (!token.trim()) {
      setError(isVi ? 'Vui lòng nhập mã token kích hoạt nhận được từ email thư mời.' : 'Please enter the activation token received from your invitation email.');
      return;
    }

    if (password.length < 6) {
      setError(isVi ? 'Mật khẩu phải có độ dài tối thiểu từ 6 ký tự.' : 'Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError(isVi ? 'Mật khẩu xác nhận không khớp với mật khẩu đã nhập.' : 'Confirm password does not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post('/auth/activate', { token: token.trim(), password });
      setMessage(isVi ? 'Tài khoản đã được kích hoạt thành công! Bạn có thể đăng nhập vào hệ thống ngay bây giờ.' : 'Account activated successfully! You can now sign in to your DFIOS cockpit.');
    } catch (err: any) {
      setError(err.response?.data?.detail || (isVi ? 'Không thể kích hoạt tài khoản. Liên kết có thể đã hết hạn hoặc mã token không hợp lệ.' : 'Failed to activate account. The link may have expired or token is invalid.'));
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

  return (
    <div className="login-container">
      <div className="login-left">
        <div className="login-left-content">
          <div className="login-logo">
            <div className="login-logo-icon">D</div>
            <span className="login-logo-text">DFIOS</span>
          </div>
          <div className="login-hero">
            <h1 className="login-hero-title">{isVi ? "Kích hoạt không gian làm việc DFIOS" : "Activate Your DFIOS Workspace"}</h1>
            <p className="login-hero-subtitle">
              {isVi ? "Thiết lập mật khẩu lần đầu để truy cập hệ thống dự báo nhu cầu và tối ưu tồn kho doanh nghiệp." : "Set your initial credentials to access enterprise demand forecasting and inventory optimization."}
            </p>
          </div>
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

      <div className="login-right">
        <div style={{ position: "absolute", top: 20, right: 20, zIndex: 10 }}>
          <LanguageToggle />
        </div>
        <div className="login-form-container">
          <h2 className="login-title">{isVi ? "Kích hoạt tài khoản" : "Activate Account"}</h2>
          <p className="login-subtitle">{isVi ? "Thiết lập mật khẩu bảo mật cho tài khoản được phân quyền bởi Quản trị viên." : "Configure secure credentials for your administrator-provisioned account."}</p>

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
                {isVi ? "Đăng nhập vào bảng điều khiển" : "Sign In to Dashboard"}
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="login-error-card">
                  <AlertCircle size={16} className="login-error-icon" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="login-form">
                {!urlToken ? (
                  <div className="form-group">
                    <label className="form-label">{isVi ? "Mã kích hoạt (Token từ email thư mời)" : "Activation Token (from invitation email)"}</label>
                    <input
                      type="text"
                      className="form-input"
                      value={token}
                      disabled={isSubmitting}
                      onChange={(e) => {
                        setToken(e.target.value);
                        if (error) setError('');
                      }}
                      placeholder={isVi ? "Dán mã kích hoạt hoặc token từ email..." : "Paste activation token from email..."}
                      required
                    />
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.625rem 0.875rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.375rem', marginBottom: '0.5rem', fontSize: '0.75rem', color: '#166534' }}>
                    <CheckCircle2 size={15} className="text-emerald-600 flex-shrink-0" />
                    <span>{isVi ? "Mã xác thực đã được nhận diện hợp lệ từ liên kết email" : "Activation token verified from email invitation link"}</span>
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">{isVi ? "Mật khẩu mới (Tối thiểu 6 ký tự)" : "New Password (Min 6 characters)"}</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="form-input password-input"
                      value={password}
                      disabled={isSubmitting}
                      onChange={(e) => handlePasswordChange(e.target.value)}
                      placeholder="••••••••••••"
                      minLength={6}
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <div className="form-label-row">
                    <label className="form-label" style={{ marginBottom: 0 }}>{isVi ? "Xác nhận mật khẩu" : "Confirm Password"}</label>
                    {confirmPassword && password !== confirmPassword && (
                      <span style={{ fontSize: '0.6875rem', color: '#dc2626', fontWeight: 600 }}>{isVi ? "Chưa khớp" : "Mismatch"}</span>
                    )}
                    {confirmPassword && password === confirmPassword && (
                      <span style={{ fontSize: '0.6875rem', color: '#16a34a', fontWeight: 600 }}>{isVi ? "Khớp chính xác" : "Matched"}</span>
                    )}
                  </div>
                  <div className="password-input-wrapper">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      className="form-input password-input"
                      value={confirmPassword}
                      disabled={isSubmitting}
                      onChange={(e) => handleConfirmPasswordChange(e.target.value)}
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

                <button className="btn-primary login-btn" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                      <Loader2 size={16} className="animate-spin" />
                      <span>{isVi ? "Đang kích hoạt..." : "Activating..."}</span>
                    </span>
                  ) : (
                    (isVi ? 'Kích hoạt tài khoản' : 'Activate Account')
                  )}
                </button>
              </form>
            </>
          )}

          <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
            <Link to="/login" style={{ color: '#0d9488', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
              {isVi ? "Quay lại Đăng nhập" : "Back to Sign In"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
