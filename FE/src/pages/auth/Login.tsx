import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.tsx';
import { Eye, Box } from 'lucide-react';
import './Login.css';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('php2422005@gmail.com');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      // Hardcode bypassing for demo purposes
      await login('admin@dfios.com', 'admin');
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    }
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
              Trusted by sizable retail networks nationwide
            </p>
            <div className="login-footer-brands">
              <span>APEX SUPPLY</span>
              <span>NEXUS RETAIL</span>
              <span>VORTEX LABS</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="login-right">
        <div className="login-form-container">
          <h2 className="login-title">Welcome back</h2>
          <p className="login-subtitle">Enter your credentials to access your DFIOS cockpit.</p>

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="manager@fintrexlabel.com"
                required
              />
            </div>

            <div className="form-group">
              <div className="form-label-row">
                <label className="form-label">Password</label>
                <Link to="/forgot-password" className="forgot-password">Forgot Password?</Link>
              </div>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-input password-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <Eye size={18} />
                </button>
              </div>
            </div>

            <div className="remember-me-group">
              <input type="checkbox" id="remember" className="remember-checkbox" defaultChecked />
              <label htmlFor="remember" className="remember-label">Remember me on this machine</label>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary login-btn"
            >
              {isLoading ? 'Signing In...' : 'Sign In to Dashboard'}
            </button>
          </form>

          <div className="sso-divider">
            <div className="sso-line"></div>
            <span className="sso-text">OR SECURE SSO</span>
          </div>

          <button type="button" className="btn-secondary sso-btn">
            <Box size={18} className="sso-icon" />
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  );
};
