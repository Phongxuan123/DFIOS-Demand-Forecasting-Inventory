import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../../services/apiClient.ts';
import './Login.css';

export const ActivateAccount: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    if (password !== confirmPassword) {
      setError('Password confirmation does not match.');
      return;
    }
    setIsSubmitting(true);
    try {
      await apiClient.post('/auth/activate', { token, password });
      setMessage('Account activated. You can now sign in.');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Could not activate this account.');
    } finally {
      setIsSubmitting(false);
    }
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
            <h1 className="login-hero-title">Activate Your Inventory Workspace</h1>
            <p className="login-hero-subtitle">Set your first password to access the DFIOS forecasting and inventory cockpit.</p>
          </div>
        </div>
      </div>

      <div className="login-right">
        <div className="login-form-container">
          <h2 className="login-title">Activate Account</h2>
          <p className="login-subtitle">Create a password for the account assigned by your administrator.</p>

          {!token && <div className="login-error">Activation token is missing from the link.</div>}
          {error && <div className="login-error">{error}</div>}
          {message && <div className="login-success" style={{ backgroundColor: '#ccfbf1', color: '#0f766e', padding: '1rem', borderRadius: '0.375rem', marginBottom: '1.5rem', fontSize: '0.875rem' }}>{message}</div>}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required />
            </div>
            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label className="form-label">Confirm Password</label>
              <input className="form-input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={6} required />
            </div>
            <button className="btn-primary login-btn" type="submit" disabled={!token || isSubmitting}>
              {isSubmitting ? 'Activating...' : 'Activate Account'}
            </button>
          </form>

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
