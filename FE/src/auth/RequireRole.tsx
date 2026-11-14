import React from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useT } from '../i18n/index.tsx';
import { EmptyState } from '../components/ui/states.tsx';
import { can, roleKey, type Action } from './permissions.ts';

/** The "you have no permission" page state. Used by <RequireRole>; usable for partial sections too. */
export const NoPermission: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const t = useT();
  const { user } = useAuth();
  return (
    <EmptyState
      compact={compact}
      icon={<Lock size={20} />}
      title={t('common.state.no_permission_title')}
      description={t('common.state.no_permission_description', { role: t(`common.roles.${roleKey(user?.role)}`) })}
      action={
        <Link to="/" className="ui-btn ui-btn--secondary">
          {t('common.state.go_home')}
        </Link>
      }
    />
  );
};

/**
 *   <RequireRole action="view:models"><ModelPerformance /></RequireRole>
 * Renders `fallback` (default: <NoPermission/>) when the role may not perform `action`.
 * Hiding is cosmetic: the backend still enforces; a 403 must still render <ErrorState error=…/>.
 */
export const RequireRole: React.FC<{ action: Action; children: React.ReactNode; fallback?: React.ReactNode }> = ({ action, children, fallback }) => {
  const { user } = useAuth();
  if (!can(user?.role, action)) return <>{fallback ?? <NoPermission />}</>;
  return <>{children}</>;
};
