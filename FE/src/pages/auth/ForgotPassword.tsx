import React, { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useT } from '../../i18n/index.tsx';
import { apiClient, apiErrorMessage } from '../../services/apiClient.ts';
import { Alert } from '../../components/ui/states.tsx';
import { Button } from '../../components/ui/primitives.tsx';
import { Input } from '../../components/ui/forms.tsx';
import { AuthShell } from './AuthShell.tsx';
import { PasswordField } from './PasswordField.tsx';

/** One page, two modes: request a reset email, or set a new password with the emailed token. */
export const ForgotPassword: React.FC = () => {
  const t = useT();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const urlToken = searchParams.get('token') ?? '';
  const [mode, setMode] = useState<'request' | 'reset'>(() => (location.pathname.includes('reset-password') || urlToken ? 'reset' : 'request'));
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(urlToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'reset') {
      if (!token.trim()) return setError(t('auth.token_required'));
      if (password.length < 6) return setError(t('auth.password_too_short'));
      if (password !== confirm) return setError(t('auth.password_mismatch'));
    }
    setSubmitting(true);
    try {
      if (mode === 'reset') {
        await apiClient.post('/auth/reset-password', { token: token.trim(), new_password: password });
        setDone(true);
      } else {
        await apiClient.post('/auth/forgot-password', { email: email.trim().toLowerCase() });
        setSent(true);
      }
    } catch (err) {
      setError(apiErrorMessage(err, t) || t('auth.request_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const backLink = (
    <p className="auth-links">
      <Link to="/login">
        <ArrowLeft size={14} /> {t('auth.back_to_login')}
      </Link>
    </p>
  );

  if (done) {
    return (
      <AuthShell title={t('auth.reset.success_title')}>
        <div className="auth-stack">
          <Alert tone="success">{t('auth.reset.success_body')}</Alert>
          <Link to="/login" className="ui-btn ui-btn--primary ui-btn--lg ui-btn--full">
            {t('auth.go_to_login')}
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (sent) {
    return (
      <AuthShell title={t('auth.forgot.sent_title')}>
        <div className="auth-stack">
          <Alert tone="success">{t('auth.forgot.sent_body', { email: email.trim() })}</Alert>
          <Button
            variant="secondary"
            onClick={() => {
              setMode('reset');
              setSent(false);
            }}
          >
            {t('auth.forgot.have_token')}
          </Button>
        </div>
        {backLink}
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t(mode === 'reset' ? 'auth.reset.title' : 'auth.forgot.title')} subtitle={t(mode === 'reset' ? 'auth.reset.subtitle' : 'auth.forgot.subtitle')}>
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        {mode === 'request' ? (
          <Input
            label={t('auth.email_label')}
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder={t('auth.email_placeholder')}
            value={email}
            required
            autoFocus
            onChange={(e) => setEmail(e.target.value)}
          />
        ) : (
          <>
            <Input
              label={t('auth.token_label')}
              placeholder={t('auth.token_placeholder')}
              value={token}
              hint={urlToken ? t('auth.token_from_link') : undefined}
              autoComplete="off"
              onChange={(e) => setToken(e.target.value)}
            />
            <PasswordField label={t('auth.new_password_label')} autoComplete="new-password" hint={t('auth.password_hint')} value={password} onChange={(e) => setPassword(e.target.value)} />
            <PasswordField label={t('auth.confirm_password_label')} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </>
        )}
        <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting} disabled={mode === 'request' && !email.trim()}>
          {submitting ? t(mode === 'reset' ? 'auth.reset.submitting' : 'auth.forgot.submitting') : t(mode === 'reset' ? 'auth.reset.submit' : 'auth.forgot.submit')}
        </Button>
        {mode === 'reset' && !urlToken && (
          <Button variant="ghost" size="sm" onClick={() => setMode('request')}>
            {t('auth.reset.need_token')}
          </Button>
        )}
      </form>
      {backLink}
    </AuthShell>
  );
};
