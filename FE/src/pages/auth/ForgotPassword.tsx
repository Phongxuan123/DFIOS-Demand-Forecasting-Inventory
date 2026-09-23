import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import './Login.css'; // Reusing the identical layout styles

export const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isSent, setIsSent] = useState(false);
  

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate API call to send reset link
    setIsSent(true);
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
          <h2 className="login-title">Reset Your Password</h2>
          <p className="login-subtitle">
            Enter the email address associated with your DFIOS account and we will send you a secure recovery link.
          </p>

          {isSent ? (
            <div className="login-success" style={{ backgroundColor: '#ccfbf1', color: '#0f766e', padding: '1rem', borderRadius: '0.375rem', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
              We have sent a password recovery link to your email address. Please check your inbox.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
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

              <button
                type="submit"
                className="btn-primary login-btn"
                style={{ marginBottom: '1rem' }}
              >
                Send Reset Link
              </button>
            </form>
          )}

          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <Link to="/login" style={{ color: '#0d9488', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
              Back to Login
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
};
