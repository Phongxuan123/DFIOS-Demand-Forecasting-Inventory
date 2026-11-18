import React, { useMemo, useState } from 'react';
import { KeyRound, Lock, LockOpen, Mail, Trash2, UserPlus } from 'lucide-react';
import { Alert, Badge, Button, Card, DataSourceNote, IconButton, Input, Modal, SearchInput, Select, Table, useConfirm, usePagination, useToast, type Column } from '../../components/ui/index.ts';
import { normalizeRole, roleKey } from '../../auth/permissions.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import { apiErrorMessage } from '../../services/apiClient.ts';
import { createUser, deleteUser, listUsers, resendActivation, revokeUserTokens, USERS_LIMIT, setUserActive, setUserRole, type CreateUserBody, type UserRecord } from '../../services/settingsApi.ts';

type ApiRole = CreateUserBody['role'];
const ROLES: ApiRole[] = ['Admin', 'Warehouse Manager', 'Planner', 'Viewer'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CreateModal: React.FC<{ open: boolean; onClose: () => void; onCreated: () => void }> = ({ open, onClose, onCreated }) => {
  const t = useT();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<ApiRole>('Viewer');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailErr = email && !EMAIL_RE.test(email.trim()) ? t('settings.users.email_invalid') : undefined;
  const pwErr = password && (password.length < 6 || password.length > 72) ? t('settings.users.password_invalid') : undefined;
  const valid = EMAIL_RE.test(email.trim()) && !pwErr;

  const roleLabel = (r: ApiRole) => t(`common.roles.${roleKey(r)}`);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const u = await createUser({ email: email.trim(), role, display_name: name.trim() || undefined, password: password || undefined });
      toast.success(t('settings.users.created', { email: u.email }));
      setEmail('');
      setName('');
      setPassword('');
      setRole('Viewer');
      onCreated();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      dismissible={!busy}
      title={t('settings.users.create_title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.actions.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t('common.actions.create')}
          </Button>
        </>
      }
    >
      <div className="ui-stack">
        <Input label={t('settings.users.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={emailErr} autoComplete="off" />
        <Input label={t('settings.users.display_name')} value={name} onChange={(e) => setName(e.target.value)} />
        <Select<ApiRole> label={t('settings.users.role')} value={role} onChange={setRole} options={ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} />
        <Input label={t('settings.users.password')} hint={t('settings.users.password_hint')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={pwErr} autoComplete="new-password" />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
};

export const UsersTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const { user: me } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const pg = usePagination(25);
  const { data: usersData, loading, error, refetch } = useApi((s) => listUsers(s), [version]);
  const data = usersData?.items;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = data ?? [];
    return needle ? all.filter((u) => u.email.toLowerCase().includes(needle) || (u.display_name ?? '').toLowerCase().includes(needle)) : all;
  }, [data, q]);

  const isMe = (u: UserRecord) => u.id === me?.id || u.email.toLowerCase() === (me?.email ?? '').toLowerCase();
  const roleLabel = (r: string) => t(`common.roles.${roleKey(r)}`);
  const refresh = () => setVersion((v) => v + 1);

  const act = async (u: UserRecord, fn: () => Promise<unknown>, okMsg: string) => {
    setBusyId(u.id);
    try {
      await fn();
      toast.success(okMsg);
      refresh();
    } catch (e) {
      toast.error(t('common.errors.unknown'), apiErrorMessage(e, t));
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (u: UserRecord) => {
    const lock = u.is_active;
    const ok = await confirm({
      title: t(lock ? 'settings.users.lock_title' : 'settings.users.unlock_title', { email: u.email }),
      description: t(lock ? 'settings.users.lock_description' : 'settings.users.unlock_description'),
      tone: lock ? 'danger' : 'default',
      confirmLabel: t(lock ? 'settings.users.lock' : 'settings.users.unlock'),
    });
    if (ok) await act(u, () => setUserActive(u.id, !lock), t(lock ? 'settings.users.locked_done' : 'settings.users.unlocked_done', { email: u.email }));
  };

  const changeRole = async (u: UserRecord, role: ApiRole) => {
    if (normalizeRole(u.role) === normalizeRole(role)) return;
    const ok = await confirm({ title: t('settings.users.role_title', { email: u.email, role: roleLabel(role) }), description: t('settings.users.role_description') });
    if (ok) await act(u, () => setUserRole(u.id, role), t('settings.users.role_done', { email: u.email }));
  };

  const revokeTokens = async (u: UserRecord) => {
    const ok = await confirm({
      title: t('settings.users.revoke_title', { email: u.email }),
      description: t('settings.users.revoke_description'),
      tone: 'danger',
      confirmLabel: t('settings.users.revoke'),
    });
    if (ok) await act(u, () => revokeUserTokens(u.id), t('settings.users.revoke_done', { email: u.email }));
  };

  const removeUser = async (u: UserRecord) => {
    const ok = await confirm({
      title: t('settings.users.delete_title', { email: u.email }),
      description: t('settings.users.delete_description'),
      tone: 'danger',
      confirmLabel: t('settings.users.delete'),
    });
    if (ok) await act(u, () => deleteUser(u.id), t('settings.users.delete_done', { email: u.email }));
  };

  const columns: Column<UserRecord>[] = [
    {
      key: 'email',
      header: t('settings.users.col_email'),
      value: (u) => u.email,
      sortable: true,
      cell: (u) => (
        <span className="ui-row">
          {u.email}
          {isMe(u) && <Badge tone="accent">{t('settings.users.you')}</Badge>}
        </span>
      ),
    },
    { key: 'name', header: t('settings.users.col_name'), value: (u) => u.display_name },
    {
      key: 'role',
      header: t('settings.users.col_role'),
      width: 190,
      cell: (u) => (
        <Select<ApiRole>
          size="sm"
          aria-label={t('settings.users.col_role')}
          value={ROLES.find((r) => normalizeRole(r) === normalizeRole(u.role)) ?? 'Viewer'}
          onChange={(r) => void changeRole(u, r)}
          disabled={isMe(u) || busyId === u.id}
          options={ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
        />
      ),
    },
    { key: 'status', header: t('settings.users.col_status'), cell: (u) => <Badge tone={u.is_active ? 'success' : 'danger'} dot>{t(u.is_active ? 'settings.users.status_active' : 'settings.users.status_locked')}</Badge> },
    { key: 'verified', header: t('settings.users.col_verified'), cell: (u) => <Badge tone={u.is_verified ? 'neutral' : 'warning'}>{t(u.is_verified ? 'settings.users.verified' : 'settings.users.pending')}</Badge> },
    { key: 'created', header: t('settings.users.col_created'), value: (u) => u.created_at ?? null, cell: (u) => (u.created_at ? fmt.date(u.created_at) : '—'), sortable: true },
    {
      key: 'actions',
      header: t('settings.users.col_actions'),
      align: 'right',
      width: 176,
      cell: (u) => (
        <span className="ui-row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          {!u.is_verified && (
            <IconButton label={t('settings.users.resend')} icon={<Mail size={16} />} disabled={busyId === u.id} onClick={() => void act(u, () => resendActivation(u.id), t('settings.users.resend_done'))} />
          )}
          <IconButton label={t('settings.users.revoke')} icon={<KeyRound size={16} />} disabled={busyId === u.id} onClick={() => void revokeTokens(u)} />
          <IconButton
            label={isMe(u) ? t('settings.users.cannot_self') : t(u.is_active ? 'settings.users.lock' : 'settings.users.unlock')}
            icon={u.is_active ? <Lock size={16} /> : <LockOpen size={16} />}
            disabled={isMe(u) || busyId === u.id}
            onClick={() => void toggleActive(u)}
          />
          <IconButton
            label={isMe(u) ? t('settings.users.cannot_self') : t('settings.users.delete')}
            icon={<Trash2 size={16} />}
            disabled={isMe(u) || busyId === u.id}
            onClick={() => void removeUser(u)}
          />
        </span>
      ),
    },
  ];

  return (
    <Card
      title={t('settings.users.title')}
      description={t('settings.users.description')}
      flush
      actions={
        <Button variant="primary" size="sm" leftIcon={<UserPlus size={16} />} onClick={() => setCreating(true)}>
          {t('settings.users.create')}
        </Button>
      }
    >
      <div className="set-pad">
        <SearchInput value={q} onChange={setQ} placeholder={t('settings.users.search')} aria-label={t('settings.users.search')} />
        <Alert tone="info">{t('settings.users.revoke_info')}</Alert>
        {usersData && usersData.total > usersData.items.length && <Alert tone="warning">{t('settings.users.truncated', { shown: String(usersData.items.length), total: String(usersData.total), limit: String(USERS_LIMIT) })}</Alert>}
      </div>
      <Table columns={columns} rows={rows} rowKey={(u) => u.id} loading={loading} error={error} onRetry={refetch} filtered={!!q} pagination={{ page: pg.page, pageSize: pg.pageSize, onPageChange: pg.setPage, onPageSizeChange: pg.setPageSize }} dense />
      <div className="set-pad">
        <DataSourceNote source={t('settings.users.source')} note={usersData ? t('settings.users.total', { total: fmt.integer(usersData.total) }) : undefined} />
      </div>
      <CreateModal open={creating} onClose={() => setCreating(false)} onCreated={refresh} />
      {dialog}
    </Card>
  );
};
