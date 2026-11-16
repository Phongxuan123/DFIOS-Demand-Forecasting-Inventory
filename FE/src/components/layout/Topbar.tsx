import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bell, CalendarClock, ChevronDown, Languages, LogOut, Menu, Moon, RefreshCw, Store, Sun, User as UserIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useStore } from '../../context/StoreContext.tsx';
import { CLOCK_ADVANCE_DAYS, useClock } from '../../context/ClockContext.tsx';
import { useTheme } from '../../theme/ThemeContext.tsx';
import { useI18n } from '../../i18n/index.tsx';
import { roleKey } from '../../auth/permissions.ts';
import { apiErrorMessage } from '../../services/apiClient.ts';
import { Badge, Button, IconButton, Skeleton, cx } from '../ui/primitives.tsx';
import { useConfirm } from '../ui/overlays.tsx';
import { useToast } from '../ui/Toast.tsx';
import { LanguageToggle, ThemeToggle } from '../common/PreferenceToggles.tsx';
import { Popover } from './Popover.tsx';
import { countPhrase, reviewsPhrase, reviewsSinceStart } from '../../utils/simText.ts';
import { useAlertFeed } from './useAlertFeed.ts';
import { AdvanceProgress } from '../common/AdvanceProgress.tsx';
import './shell.css';

/* ------------------------------ Store selector ----------------------------- */
const StoreSelector: React.FC = () => {
  const { t } = useI18n();
  const { storeId, stores, loading, error, setStoreId, reload, supportsGlobal } = useStore();

  if (loading && stores.length === 0) return <Skeleton width={110} height={30} />;
  if (error || stores.length === 0) {
    return (
      <Button size="sm" variant="secondary" leftIcon={<AlertTriangle size={14} />} onClick={reload} title={t('shell.store.error')}>
        {t(error ? 'shell.store.error' : 'shell.store.empty')}
      </Button>
    );
  }
  return (
    <label className="shell-store" title={t('shell.store.select')}>
      <Store size={15} aria-hidden="true" />
      <span className="ui-sr-only">{t('shell.store.label')}</span>
      <select value={storeId ?? ''} onChange={(e) => setStoreId(e.target.value)} aria-label={t('shell.store.select')}>
        {supportsGlobal && <option value="GLOBAL">{t('shell.store.all')}</option>}
        {stores.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </label>
  );
};

/* ------------------------------- Clock chip -------------------------------- */
const ADVANCE_STEPS = CLOCK_ADVANCE_DAYS;

const ClockChip: React.FC = () => {
  const { t, fmt } = useI18n();
  const { clock, status, reason, canAdvance, advancing, refresh, advance } = useClock();
  const { concreteStoreId: storeId } = useStore();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [open, setOpen] = useState(false);

  const onAdvance = async (days: number) => {
    const store = storeId ?? '';
    const ok = await confirm({
      title: t('shell.clock.advance_title', { days }),
      description: t('shell.clock.advance_body', { store }),
      confirmLabel: t('shell.clock.advance_days', { days }),
    });
    if (!ok) return;
    try {
      const res = await advance(days);
      setOpen(false);
      toast.success(
        t('shell.clock.advanced', {
          from: fmt.date(res.previous_date),
          to: fmt.date(res.current_date),
          reviews: reviewsPhrase(t, fmt, res.reviews_executed, !!res.day0_review_executed),
          recommendations: countPhrase(t, fmt, 'recs', res.recommendations_generated),
        }),
        typeof res.duration_seconds === 'number' ? t('shell.clock.advance_duration', { seconds: fmt.number(res.duration_seconds, { digits: 1 }) }) : undefined,
      );
    } catch (err) {
      toast.error(t('shell.clock.advance_failed'), apiErrorMessage(err, t));
    }
  };

  const label =
    status === 'ready' && clock ? fmt.date(clock.current_date) : status === 'loading' ? t('shell.clock.loading') : '—';
  const unavailableText = reason ? t(`shell.clock.unavailable_${reason}`) : '';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <button
        type="button"
        className={cx('shell-chip', status === 'unavailable' && 'is-muted')}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={status === 'unavailable' ? unavailableText : t('shell.clock.label')}
      >
        {advancing ? <span className="ui-spinner" aria-hidden="true" /> : <CalendarClock size={15} aria-hidden="true" />}
        <span className="shell-chip__text ui-tabular">{label}</span>
        {advancing && <span className="ui-sr-only">{t('shell.clock.advancing')}</span>}
      </button>
      {open && (
        <div className="shell-popover shell-popover--clock" role="dialog" aria-label={t('shell.clock.label')}>
          <div className="shell-popover__title">{t('shell.clock.label')}</div>
          {status === 'ready' && clock ? (
            <dl className="shell-kv">
              <dt>{t('shell.clock.label')}</dt>
              <dd className="ui-tabular">{fmt.date(clock.current_date, 'long')}</dd>
              <dt>{t('shell.clock.day_index', { days: fmt.integer(clock.days_elapsed), start: fmt.date(clock.start_date) })}</dt>
              <dd>{t('shell.clock.reviews', { reviews: reviewsPhrase(t, fmt, reviewsSinceStart(clock), true) })}</dd>
              <dt>{t('shell.clock.mode', { mode: clock.mode })}</dt>
              <dd className="shell-popover__source">{t('shell.clock.source', { store: clock.store_id })}</dd>
            </dl>
          ) : (
            <p className="shell-popover__muted">{status === 'loading' ? t('shell.clock.loading') : unavailableText}</p>
          )}
          <div className="shell-popover__actions">
            <Button size="sm" variant="ghost" leftIcon={<RefreshCw size={13} />} onClick={() => void refresh()} disabled={advancing}>
              {t('shell.clock.refresh')}
            </Button>
          </div>
          {canAdvance && status === 'ready' && (
            <div className="shell-popover__actions">
              {ADVANCE_STEPS.map((d) => (
                <Button key={d} size="sm" variant="secondary" loading={advancing} onClick={() => void onAdvance(d)}>
                  {t('shell.clock.advance_days', { days: d })}
                </Button>
              ))}
            </div>
          )}
          {canAdvance && <AdvanceProgress className="shell-popover__muted" />}
        </div>
      )}
      {dialog}
    </Popover>
  );
};

/* --------------------------- Notification bell ----------------------------- */
const NotificationBell: React.FC = () => {
  const { t, fmt } = useI18n();
  const { total: count, rows, pending, failed, muted } = useAlertFeed();
  const { withStore } = useStore();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <button
        type="button"
        className="ui-btn ui-btn--ghost ui-btn--icon shell-bell"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={count > 0 ? `${t('common.misc.notifications')}: ${t('shell.notifications.critical', { count: fmt.integer(count) })}` : t('common.misc.notifications')}
        title={t('common.misc.notifications')}
      >
        <Bell size={17} aria-hidden="true" />
        {count > 0 && <span className="shell-bell__badge ui-tabular" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="shell-popover shell-popover--alerts" role="dialog" aria-label={t('shell.notifications.title')}>
          <div className="shell-popover__title">
            {t('shell.notifications.title')}
            {count > 0 && <Badge tone="danger">{t('shell.notifications.critical', { count: fmt.integer(count) })}</Badge>}
          </div>
          {failed && <p className="shell-popover__muted">{t('shell.notifications.unavailable')}</p>}
          {muted && !failed && (
            <p className="shell-popover__muted">
              {t('shell.notifications.muted')} <Link to={withStore('/settings?tab=preferences')} onClick={() => setOpen(false)}>{t('shell.notifications.muted_link')}</Link>
            </p>
          )}
          {!failed && !muted && rows.length === 0 && <p className="shell-popover__muted">{t('shell.notifications.empty')}</p>}
          <ul className="shell-alert-list">
            {rows.map((a) => (
              <li key={`${a.item_id}__${a.store_id}`}>
                <Link to={withStore(`/replenishment?sku=${encodeURIComponent(a.item_id)}`)} onClick={() => setOpen(false)}>
                  <span className="shell-alert-list__name">{a.product_name || a.item_id}</span>
                  <span className="shell-alert-list__meta">
                    {a.item_id} · {a.store_id} · {t('shell.notifications.stock', { on_hand: fmt.integer(a.on_hand), rop: fmt.integer(a.reorder_point) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {count > rows.length && <p className="shell-popover__muted">{t('shell.notifications.more', { count: fmt.integer(count - rows.length) })}</p>}
          {pending !== null && (
            <div className="shell-popover__actions">
              <Link to={withStore('/replenishment')} onClick={() => setOpen(false)}>
                {t('shell.notifications.pending', { count: fmt.integer(pending) })}
              </Link>
            </div>
          )}
        </div>
      )}
    </Popover>
  );
};

/* -------------------------------- User menu -------------------------------- */
const UserMenu: React.FC = () => {
  const { t, locale, toggleLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { withStore } = useStore();
  const [open, setOpen] = useState(false);
  const name = user?.display_name || user?.name || user?.email || '';
  const initials = (name.trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('') || 'U').toUpperCase();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <button type="button" className="shell-avatar" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t('shell.user.menu')} title={name}>
        {initials}
      </button>
      {open && (
        <div className="shell-popover shell-popover--user" role="menu">
          <div className="shell-user-head">
            <div className="shell-user-head__name">{name}</div>
            <div className="shell-user-head__email">{user?.email}</div>
            <Badge tone="accent">{t(`common.roles.${roleKey(user?.role)}`)}</Badge>
          </div>
          <Link role="menuitem" className="shell-menu-item" to={withStore('/settings')} onClick={() => setOpen(false)}>
            <UserIcon size={15} /> {t('shell.user.profile')}
          </Link>
          <button type="button" role="menuitem" className="shell-menu-item shell-menu-item--mobile" onClick={toggleLocale}>
            <Languages size={15} /> {t(locale === 'vi' ? 'common.language.switch_to_en' : 'common.language.switch_to_vi')}
          </button>
          <button type="button" role="menuitem" className="shell-menu-item shell-menu-item--mobile" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />} {t(theme === 'dark' ? 'common.theme.switch_to_light' : 'common.theme.switch_to_dark')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="shell-menu-item shell-menu-item--danger"
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            <LogOut size={15} /> {t('shell.user.logout')}
          </button>
        </div>
      )}
    </Popover>
  );
};

/* --------------------------------- Topbar ---------------------------------- */
export const Topbar: React.FC<{ onOpenMobileMenu: () => void }> = ({ onOpenMobileMenu }) => {
  const { t } = useI18n();
  return (
    <header className="shell-topbar">
      <IconButton className="shell-topbar__menu" label={t('shell.sidebar.open_menu')} icon={<Menu size={18} />} onClick={onOpenMobileMenu} />
      <StoreSelector />
      <ClockChip />
      <div className="shell-topbar__spacer" />
      <div className="shell-topbar__tools shell-hide-mobile">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <NotificationBell />
      <UserMenu />
    </header>
  );
};
