import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useT } from '../../i18n/index.tsx';
import { apiClient, apiErrorMessage } from '../../services/apiClient.ts';
import { Alert } from '../../components/ui/states.tsx';
import { Button, Skeleton } from '../../components/ui/primitives.tsx';
import { Input } from '../../components/ui/forms.tsx';
import { AuthShell } from './AuthShell.tsx';

export const ConfirmEmail: React.FC = () => {
  const t = useT();
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get('token') ?? '';
  const [token, setToken] = useState(urlToken);
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>(urlToken ? 'verifying' : 'idle');
  const [message, setMessage] = useState('');

  const confirm = useCallback(
    async (value: string) => {
      if (!value.trim()) {
        setStatus('error');
        setMessage(t('auth.token_required'));
        return;
      }
      setStatus('verifying');
      try {
        await apiClient.post('/auth/me/email/confirm', { token: value.trim() });
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setMessage(apiErrorMessage(err, t) || t('auth.confirm_email.failed'));
      }
    },
    [t],
  );

  useEffect(() => {
    if (urlToken) void confirm(urlToken);
    // run once for the token in the link
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlToken]);

  if (status === 'success') {
    return (
      <AuthShell title={t('auth.confirm_email.success_title')}>
        <div className="auth-stack">
          <Alert tone="success">{t('auth.confirm_email.success_body')}</Alert>
          <Link to="/" className="ui-btn ui-btn--primary ui-btn--lg ui-btn--full">
            {t('common.state.go_home')}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.confirm_email.title')} subtitle={t('auth.confirm_email.subtitle')}>
      {status === 'verifying' ? (
        <div className="auth-stack" role="status">
          <Skeleton height={36} />
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>{t('auth.confirm_email.verifying')}</span>
        </div>
      ) : (
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm(token);
          }}
        >
          {status === 'error' && <Alert tone="danger">{message}</Alert>}
          <Input label={t('auth.token_label')} placeholder={t('auth.token_placeholder')} value={token} autoComplete="off" onChange={(e) => setToken(e.target.value)} />
          <Button type="submit" variant="primary" size="lg" fullWidth>
            {t('auth.confirm_email.submit')}
          </Button>
        </form>
      )}
      <p className="auth-links">
        <Link to="/login">
          <ArrowLeft size={14} /> {t('auth.back_to_login')}
        </Link>
      </p>
    </AuthShell>
  );
};
