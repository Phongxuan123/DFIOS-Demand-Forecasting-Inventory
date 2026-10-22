import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../../services/apiClient.ts';
import { Eye, EyeOff, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import './Login.css';

export const ActivateAccount: React.FC = () => {
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
      setError('Vui lòng nhập mã token kích hoạt nhận được từ email thư mời.');
      return;
    }

    if (password.length < 6) {
      setError('Mật khẩu phải có độ dài tối thiểu từ 6 ký tự.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp với mật khẩu đã nhập.');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post('/auth/activate', { token: token.trim(), password });
      setMessage('Tài khoản đã được kích hoạt thành công! Bạn có thể đăng nhập vào hệ thống ngay bây giờ.');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Không thể kích hoạt tài khoản. Liên kết có thể đã hết hạn hoặc mã token không hợp lệ.');
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
            <h1 className="login-hero-title">Kích hoạt không gian làm việc DFIOS</h1>
            <p className="login-hero-subtitle">
              Thiết lập mật khẩu lần đầu để truy cập hệ thống dự báo nhu cầu và tối ưu tồn kho doanh nghiệp.
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
        <div className="login-form-container">
          <h2 className="login-title">Kích hoạt tài khoản</h2>
          <p className="login-subtitle">Thiết lập mật khẩu bảo mật cho tài khoản được phân quyền bởi Quản trị viên.</p>

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
                Đăng nhập vào bảng điều khiển
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
                    <label className="form-label">Mã kích hoạt (Token từ email thư mời)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={token}
                      disabled={isSubmitting}
                      onChange={(e) => {
                        setToken(e.target.value);
                        if (error) setError('');
                      }}
                      placeholder="Dán mã kích hoạt hoặc token từ email..."
                      required
                    />
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.625rem 0.875rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.375rem', marginBottom: '0.5rem', fontSize: '0.75rem', color: '#166534' }}>
                    <CheckCircle2 size={15} className="text-emerald-600 flex-shrink-0" />
                    <span>Mã xác thực đã được nhận diện hợp lệ từ liên kết email</span>
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Mật khẩu mới (Tối thiểu 6 ký tự)</label>
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
                    <label className="form-label" style={{ marginBottom: 0 }}>Xác nhận mật khẩu</label>
                    {confirmPassword && password !== confirmPassword && (
                      <span style={{ fontSize: '0.6875rem', color: '#dc2626', fontWeight: 600 }}>Chưa khớp</span>
                    )}
                    {confirmPassword && password === confirmPassword && (
                      <span style={{ fontSize: '0.6875rem', color: '#16a34a', fontWeight: 600 }}>Khớp chính xác</span>
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
                      <span>Đang kích hoạt...</span>
                    </span>
                  ) : (
                    'Kích hoạt tài khoản'
                  )}
                </button>
              </form>
            </>
          )}

          <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
            <Link to="/login" style={{ color: '#0d9488', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
              Quay lại Đăng nhập
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
