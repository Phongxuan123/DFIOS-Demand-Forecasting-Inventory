import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useT } from '../../i18n/index.tsx';
import { apiClient, apiErrorMessage } from '../../services/apiClient.ts';
import { Alert } from '../../components/ui/states.tsx';
import { Button } from '../../components/ui/primitives.tsx';
import { Input } from '../../components/ui/forms.tsx';
import { AuthShell } from './AuthShell.tsx';
import { PasswordField } from './PasswordField.tsx';

export const ActivateAccount: React.FC = () => {
  const t = useT();
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get('token') ?? '';
  const [token, setToken] = useState(urlToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!token.trim()) return setError(t('auth.token_required'));
    if (password.length < 6) return setError(t('auth.password_too_short'));
    if (password !== confirm) return setError(t('auth.password_mismatch'));
    setSubmitting(true);
    try {
      await apiClient.post('/auth/activate', { token: token.trim(), password });
      setDone(true);
    } catch (err) {
      setError(apiErrorMessage(err, t) || t('auth.activate.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <AuthShell title={t('auth.activate.success_title')}>
        <div className="auth-stack">
          <Alert tone="success">{t('auth.activate.success_body')}</Alert>
          <Link to="/login" className="ui-btn ui-btn--primary ui-btn--lg ui-btn--full">
            {t('auth.go_to_login')}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.activate.title')} subtitle={t('auth.activate.subtitle')}>
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
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
        <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting}>
          {submitting ? t('auth.activate.submitting') : t('auth.activate.submit')}
        </Button>
      </form>
      <p className="auth-links">
        <Link to="/login">
          <ArrowLeft size={14} /> {t('auth.back_to_login')}
        </Link>
      </p>
    </AuthShell>
  );
};
