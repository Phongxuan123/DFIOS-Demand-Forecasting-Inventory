import React, { useState } from 'react';
import { Alert, Badge, Button, Card, Input, useToast } from '../../components/ui/index.ts';
import { roleKey } from '../../auth/permissions.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useT } from '../../i18n/index.tsx';
import { apiErrorMessage } from '../../services/apiClient.ts';
import { changePassword, updateProfile } from '../../services/settingsApi.ts';

type Level = 'weak' | 'fair' | 'good' | 'strong';

function assess(pw: string) {
  const checks = {
    length: pw.length >= 10,
    case: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    number: /\d/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
  const score = Object.values(checks).filter(Boolean).length + (pw.length >= 6 ? 0 : -1);
  const level: Level = pw.length < 6 || score <= 1 ? 'weak' : score === 2 ? 'fair' : score === 3 ? 'good' : 'strong';
  return { checks, level };
}

const LEVEL_TONE = { weak: 'danger', fair: 'warning', good: 'info', strong: 'success' } as const;

const ProfileForm: React.FC = () => {
  const t = useT();
  const toast = useToast();
  const { user, updateCurrentUser } = useAuth();
  const current = user?.display_name || user?.name || '';
  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const dirty = trimmed !== current.trim();

  const save = async () => {
    if (!trimmed) {
      setError(t('settings.profile.display_name_required'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await updateProfile(trimmed);
      updateCurrentUser({ display_name: res.display_name ?? trimmed });
      toast.success(t('settings.profile.saved'));
    } catch (e) {
      setError(apiErrorMessage(e, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t('settings.profile.title')} description={t('settings.profile.description')}>
      <form
        className="ui-stack set-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input label={t('settings.profile.email')} value={user?.email ?? ''} readOnly disabled />
        <div>
          <div className="set-label">{t('settings.profile.role')}</div>
          <Badge tone="accent">{t(`common.roles.${roleKey(user?.role)}`)}</Badge>
        </div>
        <Input label={t('settings.profile.display_name')} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} error={error ?? undefined} autoComplete="name" />
        <div>
          <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>
            {t('settings.profile.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
};

const PasswordForm: React.FC = () => {
  const t = useT();
  const toast = useToast();
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { checks, level } = assess(newPw);

  const fieldError = (() => {
    if (!newPw) return null;
    if (newPw.length < 6) return t('settings.profile.too_short');
    if (newPw.length > 72) return t('settings.profile.too_long');
    if (oldPw && newPw === oldPw) return t('settings.profile.same_as_old');
    return null;
  })();
  const mismatch = confirm.length > 0 && confirm !== newPw;
  const ready = !!oldPw && !!newPw && !fieldError && confirm === newPw;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await changePassword(oldPw, newPw);
      toast.success(t('settings.profile.changed'));
      setOldPw('');
      setNewPw('');
      setConfirm('');
    } catch (e) {
      setError(apiErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const hints = [
    !checks.length && t('settings.profile.hint_length'),
    !checks.case && t('settings.profile.hint_case'),
    !checks.number && t('settings.profile.hint_number'),
    !checks.symbol && t('settings.profile.hint_symbol'),
    t('settings.profile.hint_reuse'),
  ].filter(Boolean) as string[];

  return (
    <Card title={t('settings.profile.password_title')} description={t('settings.profile.password_description')}>
      <form
        className="ui-stack set-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input type="password" label={t('settings.profile.current_password')} value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" maxLength={72} />
        <Input type="password" label={t('settings.profile.new_password')} value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" maxLength={72} error={fieldError ?? undefined} />
        {newPw && (
          <div className="set-strength" aria-live="polite">
            <Badge tone={LEVEL_TONE[level]}>{t('settings.profile.strength', { level: t(`settings.profile.strength_levels.${level}`) })}</Badge>
            <div className="set-label">{t('settings.profile.hints_title')}</div>
            <ul className="set-hints">
              {hints.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        )}
        <Input type="password" label={t('settings.profile.confirm_password')} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" maxLength={72} error={mismatch ? t('settings.profile.mismatch') : undefined} />
        {error && <Alert tone="danger">{error}</Alert>}
        <div>
          <Button type="submit" variant="primary" loading={busy} disabled={!ready}>
            {t('settings.profile.change')}
          </Button>
        </div>
      </form>
    </Card>
  );
};

export const ProfileTab: React.FC = () => (
  <div className="ui-grid ui-grid--2">
    <ProfileForm />
    <PasswordForm />
  </div>
);
