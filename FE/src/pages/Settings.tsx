import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs, type TabItem } from '../components/ui/index.ts';
import { NoPermission } from '../auth/RequireRole.tsx';
import { can } from '../auth/permissions.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useT } from '../i18n/index.tsx';
import { AuditTab } from './settings/AuditTab.tsx';
import { ImportTab } from './settings/ImportTab.tsx';
import { PrefsTab } from './settings/PrefsTab.tsx';
import { QualityTab } from './settings/QualityTab.tsx';
import { HoldHeight } from '../components/ui/HoldHeight.tsx';
import { ProfileTab } from './settings/ProfileTab.tsx';
import { SchedulesTab } from './settings/SchedulesTab.tsx';
import { SystemTab } from './settings/SystemTab.tsx';
import { SimulationParamsCard } from './settings/SimulationParamsCard.tsx';
import { UsersTab } from './settings/UsersTab.tsx';
import './settings/settings.css';

type TabId = 'profile' | 'preferences' | 'system' | 'schedules' | 'users' | 'audit' | 'import' | 'quality';

export const Settings: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  // Tabs follow the role: the backend stays the source of truth (a 403 is rendered as a state in each tab).
  const tabs = useMemo<TabItem<TabId>[]>(() => {
    const role = user?.role;
    const items: TabItem<TabId>[] = [
      { id: 'profile', label: t('settings.tabs.profile') },
      { id: 'preferences', label: t('settings.tabs.preferences') },
    ];
    if (can(role, 'inventory:adjust')) items.push({ id: 'system', label: t('settings.tabs.system') });
    if (can(role, 'models:manage')) items.push({ id: 'schedules', label: t('settings.tabs.schedules') });
    if (can(role, 'users:manage')) items.push({ id: 'users', label: t('settings.tabs.users') });
    if (can(role, 'audit:view')) items.push({ id: 'audit', label: t('settings.tabs.audit') });
    if (can(role, 'data:import')) items.push({ id: 'import', label: t('settings.tabs.import') });
    if (can(role, 'data:quality')) items.push({ id: 'quality', label: t('settings.tabs.quality') });
    return items;
  }, [user?.role, t]);

  const requested = params.get('tab');
  const active: TabId = (tabs.find((x) => x.id === requested)?.id ?? 'profile') as TabId;

  const select = (id: TabId) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };

  // A tab id from the URL that the role may not open falls back to profile; this guard is for the explicit case.
  const denied = requested && !tabs.some((x) => x.id === requested) && ['system', 'schedules', 'users', 'audit', 'import', 'quality'].includes(requested);

  return (
    <div className="ui-stack">
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <div className="set-tabs">
        <Tabs<TabId> items={tabs} value={active} onChange={select} aria-label={t('settings.tabs_label')} />
      </div>
      {denied ? (
        <NoPermission />
      ) : (
        <HoldHeight activeKey={active} role="tabpanel">
          {active === 'profile' && <ProfileTab />}
          {active === 'preferences' && <PrefsTab />}
          {active === 'system' && (
            <div className="ui-stack">
              <SystemTab canEdit={can(user?.role, 'users:manage')} />
              <SimulationParamsCard canEdit={can(user?.role, 'users:manage')} />
            </div>
          )}
          {active === 'schedules' && <SchedulesTab />}
          {active === 'users' && <UsersTab />}
          {active === 'audit' && <AuditTab />}
          {active === 'import' && <ImportTab />}
          {active === 'quality' && <QualityTab />}
        </HoldHeight>
      )}
    </div>
  );
};
