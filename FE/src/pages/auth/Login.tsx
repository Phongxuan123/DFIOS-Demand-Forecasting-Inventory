import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.tsx';
import { Eye, EyeOff, AlertCircle, Loader2, Info } from 'lucide-react';
import './Login.css';

export const Login: React.FC = () => {
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
  const from = (location.state as any)?.from?.pathname || '/';

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
    } catch (err: any) {
      setError(err.message || 'Đăng nhập không thành công');
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
        <div className="login-form-container">
          <h2 className="login-title">Welcome back</h2>
          <p className="login-subtitle">Enter your credentials to access your DFIOS cockpit.</p>

          {sessionExpiredNotice && (
            <div className="session-expired-card">
              <Info size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <span>Phiên làm việc đã hết hạn vì lý do bảo mật. Vui lòng đăng nhập lại để tiếp tục.</span>
            </div>
          )}

          {error && (
            <div className="login-error-card">
              <AlertCircle size={16} className="login-error-icon" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
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
                <div className="flex items-center gap-2">
                  <label className="form-label" style={{ marginBottom: 0 }}>Password</label>
                  {capsLockActive && (
                    <span className="caps-lock-badge">Caps Lock đang bật</span>
                  )}
                </div>
                <Link to="/forgot-password" className="forgot-password">Forgot Password?</Link>
              </div>
              <div className="password-input-wrapper">
                <input
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
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
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
              <label htmlFor="remember" className="remember-label">Remember me on this machine</label>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary login-btn"
            >
              {isLoading ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Signing In...</span>
                </span>
              ) : (
                'Sign In to Dashboard'
              )}
            </button>
          </form>

          {/* Onboarding / Account Activation Guidance */}
          <div className="login-onboarding-hint">
            <span>Chưa có tài khoản đăng nhập?</span>
            <p>
              DFIOS là nền tảng quản trị chuỗi cung ứng doanh nghiệp nội bộ. Tài khoản mới được phân quyền bởi Quản trị viên (Admin).
              Nếu bạn đã nhận email thư mời, hãy nhấp vào{' '}
              <Link to="/activate" className="login-activate-link">
                Kích hoạt tài khoản
              </Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
