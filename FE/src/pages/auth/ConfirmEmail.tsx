import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { apiClient } from '../../services/apiClient.ts';
import './Login.css';

export const ConfirmEmail: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Invalid or missing confirmation token.');
      return;
    }

    const confirm = async () => {
      try {
        const res = await apiClient.post('/auth/me/email/confirm', { token });
        setStatus('success');
        setMessage(res.data?.message || 'Your email address has been confirmed and updated successfully!');
      } catch (err: any) {
        setStatus('error');
        setMessage(err.response?.data?.detail || 'Email confirmation link is invalid or has expired.');
      }
    };

    confirm();
  }, [token]);

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
            <p className="login-footer-title">Enterprise Inventory Optimization</p>
            <div className="login-footer-brands">
              <span>APEX SUPPLY</span>
              <span>NEXUS RETAIL</span>
              <span>VORTEX LABS</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side */}
      <div className="login-right">
        <div className="login-form-container">
          <h2 className="login-title">Email Confirmation</h2>
          <p className="login-subtitle">Verifying your updated contact email address.</p>

          {status === 'verifying' && (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
              <div className="flex justify-center mb-4">Verifying token, please wait...</div>
            </div>
          )}

          {status === 'success' && (
            <div>
              <div
                style={{
                  backgroundColor: '#ccfbf1',
                  color: '#0f766e',
                  padding: '1.25rem',
                  borderRadius: '0.375rem',
                  marginBottom: '1.5rem',
                  fontSize: '0.875rem',
                  lineHeight: '1.5',
                }}
              >
                {message}
              </div>
              <Link to="/login" className="btn-primary login-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                Back to Sign In
              </Link>
            </div>
          )}

          {status === 'error' && (
            <div>
              <div className="login-error" style={{ marginBottom: '1.5rem' }}>
                {message}
              </div>
              <Link to="/login" className="btn-secondary sso-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                Return to Login
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
