/** EmptyState, ErrorState (retry, forbidden aware), Unavailable. */
import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Inbox, Info, Lock, SearchX } from 'lucide-react';
import { useT } from '../../i18n/index.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { roleKey } from '../../auth/permissions.ts';
import { apiErrorMessage, toApiError, type ApiError } from '../../services/apiClient.ts';
import { Button, cx } from './primitives.tsx';
import './ui.css';

export interface EmptyStateProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  /** Use "no results" wording (a filter/search yielded nothing) instead of "no data". */
  filtered?: boolean;
  compact?: boolean;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ title, description, icon, action, filtered, compact, className }) => {
  const t = useT();
  return (
    <div className={cx('ui-state', compact && 'ui-state--compact', className)}>
      <div className="ui-state__icon">{icon ?? (filtered ? <SearchX size={20} /> : <Inbox size={20} />)}</div>
      <div className="ui-state__title">{title ?? t(filtered ? 'common.state.no_results_title' : 'common.state.empty_title')}</div>
      <div className="ui-state__desc">{description ?? t(filtered ? 'common.state.no_results_description' : 'common.state.empty_description')}</div>
      {action && <div className="ui-state__action">{action}</div>}
    </div>
  );
};

export interface ErrorStateProps {
  /** Anything thrown by apiClient / useApi; decides the wording (403 -> "no permission"). */
  error?: unknown;
  title?: React.ReactNode;
  description?: React.ReactNode;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}

/**
 * 403 is rendered as "you have no permission" (never as an empty list, F-20/R-36).
 * Other errors show the translated generic message plus the server detail when useful.
 */
export const ErrorState: React.FC<ErrorStateProps> = ({ error, title, description, onRetry, compact, className }) => {
  const t = useT();
  const { user } = useAuth();
  const e: ApiError | null = error === undefined || error === null ? null : toApiError(error);
  const forbidden = e?.kind === 'forbidden';
  const roleLabel = t(`common.roles.${roleKey(user?.role)}`);

  return (
    <div className={cx('ui-state', forbidden ? 'ui-state--forbidden' : 'ui-state--error', compact && 'ui-state--compact', className)} role="alert">
      <div className="ui-state__icon">{forbidden ? <Lock size={20} /> : <AlertTriangle size={20} />}</div>
      <div className="ui-state__title">{title ?? t(forbidden ? 'common.state.no_permission_title' : 'common.state.error_title')}</div>
      <div className="ui-state__desc">
        {description ??
          (forbidden
            ? t('common.state.no_permission_description', { role: roleLabel })
            : e
              ? apiErrorMessage(e, t)
              : t('common.state.error_description'))}
      </div>
      {!forbidden && onRetry && (
        <div className="ui-state__action">
          <Button size="sm" onClick={onRetry}>
            {t('common.actions.retry')}
          </Button>
        </div>
      )}
    </div>
  );
};

/** Inline "—" with the reason, for a single number/field that cannot be computed. */
export const Unavailable: React.FC<{ reason?: string; className?: string }> = ({ reason, className }) => {
  const t = useT();
  return (
    <span className={className} title={reason ? t('common.state.unavailable_reason', { reason }) : t('common.state.unavailable')} style={{ color: 'var(--color-text-disabled)' }}>
      —
    </span>
  );
};

/** Inline message box (form errors, notices). role=alert for danger/warning, status otherwise. */
export const Alert: React.FC<{
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}> = ({ tone = 'info', title, children, className }) => {
  const icon = tone === 'success' ? <CheckCircle2 size={16} /> : tone === 'info' ? <Info size={16} /> : tone === 'warning' ? <AlertTriangle size={16} /> : <AlertCircle size={16} />;
  return (
    <div className={cx('ui-alert', `ui-alert--${tone}`, className)} role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}>
      <span className="ui-alert__icon">{icon}</span>
      <div>
        {title && <div className="ui-alert__title">{title}</div>}
        {children && <div className="ui-alert__body">{children}</div>}
      </div>
    </div>
  );
};
