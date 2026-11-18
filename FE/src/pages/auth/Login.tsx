import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, AlertCircle } from 'lucide-react';
import { useAuth, SESSION_EXPIRED_FLAG } from '../../context/AuthContext.tsx';
import { useT } from '../../i18n/index.tsx';
import { apiErrorMessage, toApiError } from '../../services/apiClient.ts';
import { Alert } from '../../components/ui/states.tsx';
import { Button } from '../../components/ui/primitives.tsx';
import { Checkbox, Input } from '../../components/ui/forms.tsx';
import { AuthShell } from './AuthShell.tsx';
import { PasswordField } from './PasswordField.tsx';

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

export const Login: React.FC = () => {
  const t = useT();
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from;
  const target = from?.pathname ? `${from.pathname}${from.search ?? ''}` : '/';

  const [email, setEmail] = useState(() => readPref('dfios_remembered_email') ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => readPref('dfios_remember_me') !== 'false');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [expired, setExpired] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_EXPIRED_FLAG) === '1';
    } catch {
      return false;
    }
  });
  const [initialEmail] = useState(email);

  useEffect(() => {
    if (isAuthenticated) navigate(target, { replace: true });
  }, [isAuthenticated, navigate, target]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      writePref('dfios_remember_me', remember ? 'true' : 'false');
      writePref('dfios_remembered_email', remember ? email.trim() : null);
      navigate(target, { replace: true });
    } catch (err) {
      const kind = toApiError(err).kind;
      setError(kind === 'unauthorized' ? t('auth.login.bad_credentials') : apiErrorMessage(err, t));
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title={t('auth.login.title')} subtitle={t('auth.login.subtitle')}>
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {expired && !error && <Alert tone="info">{t('auth.login.session_expired')}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        <Input
          id="login-email"
          label={t('auth.email_label')}
          type="email"
          autoComplete="username"
          inputMode="email"
          placeholder={t('auth.email_placeholder')}
          value={email}
          required
          autoFocus={!initialEmail}
          onChange={(e) => {
            setEmail(e.target.value);
            setError('');
            setExpired(false);
          }}
        />
        <div
          onKeyDown={(e) => setCapsLock(Boolean(e.getModifierState && e.getModifierState('CapsLock')))}
          onKeyUp={(e) => setCapsLock(Boolean(e.getModifierState && e.getModifierState('CapsLock')))}
        >
          <PasswordField
            id="login-password"
            label={t('auth.password_label')}
            autoComplete="current-password"
            value={password}
            required
            autoFocus={!!initialEmail}
            onChange={(e) => {
              setPassword(e.target.value);
              setError('');
            }}
          />
          {capsLock && (
            <span className="auth-caps-warning">
              <AlertCircle size={13} />
              <span>Caps Lock is ON</span>
            </span>
          )}
        </div>
        <div className="auth-row">
          <Checkbox label={t('auth.login.remember')} checked={remember} onChange={setRemember} />
          <Link to="/forgot-password">{t('auth.login.forgot')}</Link>
        </div>
        <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting} disabled={!email.trim() || !password}>
          {submitting ? (
            t('auth.login.submitting')
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              {t('auth.login.submit')}
              <ArrowRight size={16} />
            </span>
          )}
        </Button>
      </form>
      <p className="auth-links">
        {t('auth.login.no_account')} <Link to="/activate">{t('auth.login.activate_link')}</Link>.
      </p>
    </AuthShell>
  );
};
