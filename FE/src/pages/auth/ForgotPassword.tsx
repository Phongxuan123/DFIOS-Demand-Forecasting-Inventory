import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../../services/apiClient.ts';
import './Login.css'; // Reusing the identical layout styles

export const ForgotPassword: React.FC = () => {
  const [searchParams] = useSearchParams();
  const resetToken = searchParams.get('token') || '';
  const [email, setEmail] = useState('');
  const [isSent, setIsSent] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setIsSubmitting(true);
    try {
      if (resetToken) {
        if (newPassword !== confirmPassword) {
          setError('New password and confirmation do not match.');
          return;
        }
        await apiClient.post('/auth/reset-password', { token: resetToken, new_password: newPassword });
        setMessage('Your password has been reset. You can sign in with the new password.');
      } else {
        await apiClient.post('/auth/forgot-password', { email });
        setIsSent(true);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Password recovery request failed.');
    } finally {
      setIsSubmitting(false);
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
          <h2 className="login-title">{resetToken ? 'Create New Password' : 'Reset Your Password'}</h2>
          <p className="login-subtitle">
            {resetToken ? 'Enter a new password for your DFIOS account.' : 'Enter the email address associated with your DFIOS account and we will send you a secure recovery link.'}
          </p>

          {error && <div className="login-error">{error}</div>}
          {message ? (
            <div>
              <div className="login-success" style={{ backgroundColor: '#ccfbf1', color: '#0f766e', padding: '1.25rem', borderRadius: '0.375rem', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                {message}
              </div>
              <Link to="/login" className="btn-primary login-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                Sign In With New Password
              </Link>
            </div>
          ) : isSent ? (
            <div className="login-success" style={{ backgroundColor: '#ccfbf1', color: '#0f766e', padding: '1rem', borderRadius: '0.375rem', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
              We have sent a password recovery link to your email address. Please check your inbox.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="login-form">
              {resetToken ? (
                <>
                  <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label className="form-label">New Password</label>
                    <input
                      type="password"
                      className="form-input"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      minLength={6}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                    <label className="form-label">Confirm New Password</label>
                    <input
                      type="password"
                      className="form-input"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      minLength={6}
                      required
                    />
                  </div>
                </>
              ) : (
                <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                  <label className="form-label">Email Address</label>
                  <input
                    type="email"
                    className="form-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="manager@dfios.com"
                    required
                  />
                </div>
              )}

              <button
                type="submit"
                className="btn-primary login-btn"
                style={{ marginBottom: '1rem' }}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Submitting...' : resetToken ? 'Reset Password' : 'Send Reset Link'}
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
