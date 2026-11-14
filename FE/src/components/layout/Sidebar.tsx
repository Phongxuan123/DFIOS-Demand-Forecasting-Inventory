import React, { useEffect, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useStore } from '../../context/StoreContext.tsx';
import { can } from '../../auth/permissions.ts';
import { useT } from '../../i18n/index.tsx';
import { DfiosBrandMark } from '../common/DfiosBrandMark.tsx';
import { IconButton, cx } from '../ui/primitives.tsx';
import { NAV_GROUPS } from './navConfig.ts';
import './shell.css';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }) => {
  const t = useT();
  const { user } = useAuth();
  const { withStore } = useStore();
  const location = useLocation();

  // Role-filtered navigation (R-36): items the role cannot use are not rendered at all.
  const groups = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((i) => can(user?.role, i.action) && (!i.devOnly || import.meta.env.DEV)),
      })).filter((g) => g.items.length > 0),
    [user?.role],
  );

  // Close the mobile drawer on navigation.
  useEffect(() => {
    onCloseMobile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const isCollapsed = collapsed && !mobileOpen;

  return (
    <>
      {mobileOpen && <div className="shell-backdrop" onClick={onCloseMobile} aria-hidden="true" />}
      <aside className={cx('shell-sidebar', isCollapsed && 'is-collapsed', mobileOpen && 'is-mobile-open')} aria-label={t('nav.main_label')}>
        <div className="shell-sidebar__brand">
          <span className="shell-sidebar__logo">
            <DfiosBrandMark size={18} />
          </span>
          {!isCollapsed && <span className="shell-sidebar__name">DFIOS</span>}
          <IconButton className="shell-sidebar__close" size="sm" label={t('shell.sidebar.close_menu')} icon={<X size={16} />} onClick={onCloseMobile} />
        </div>

        <nav className="shell-sidebar__nav">
          {groups.map((group) => (
            <div key={group.id} className="shell-nav-group">
              {!isCollapsed && <div className="shell-nav-group__title">{t(group.label)}</div>}
              {group.items.map((item) => {
                const Icon = item.icon;
                const label = t(item.label);
                return (
                  <NavLink
                    key={item.path}
                    to={withStore(item.path)}
                    end={item.end}
                    className={({ isActive }) => cx('shell-nav-item', isActive && 'is-active')}
                    title={isCollapsed ? label : undefined}
                  >
                    <Icon size={17} aria-hidden="true" />
                    {!isCollapsed && <span>{label}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="shell-sidebar__footer">
          <IconButton
            className="shell-sidebar__collapse"
            size="sm"
            label={t(isCollapsed ? 'shell.sidebar.expand' : 'shell.sidebar.collapse')}
            icon={isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            onClick={onToggleCollapsed}
          />
        </div>
      </aside>
    </>
  );
};
