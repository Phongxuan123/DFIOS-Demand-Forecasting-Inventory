import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  TrendingUp, 
  Truck, 
  PieChart, 
  Cpu, 
  FileBarChart, 
  Boxes, 
  Settings, 
  LogOut,
  X
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useLanguage } from '../../context/LanguageContext.tsx';
import { DfiosBrandMark } from '../common/DfiosBrandMark.tsx';
import { prefetchRouteData } from '../../services/api.ts';
import './Sidebar.css';

interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen = false, onCloseMobile }) => {
  const { logout, user } = useAuth();
  const { t } = useLanguage();

  const handleNavClick = (path: string) => {
    prefetchRouteData(path);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  const formatRole = (role?: string) => {
    if (!role) return 'USER';
    const r = role.toUpperCase();
    if (r === 'ADMIN') return 'ADMIN';
    if (r === 'WAREHOUSE MANAGER') return 'WAREHOUSE MGR';
    if (r === 'VIEWER') return 'VIEWER';
    return r;
  };

  const getInitials = (name?: string, email?: string) => {
    const raw = (name || email || 'US').trim();
    const parts = raw.split(/[\s@._-]+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return raw.substring(0, 2).toUpperCase();
  };

  const displayName = user?.display_name || user?.name || user?.email || 'User';

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div 
          className="sidebar-mobile-backdrop" 
          onClick={onCloseMobile}
          aria-hidden="true" 
        />
      )}

      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-container">
            <div className="logo-icon">
              <DfiosBrandMark size={20} />
            </div>
            <div className="logo-text">
              <div className="logo-title-row">
                <h2>DFIOS</h2>
                <span className="logo-tag">SCM · ML</span>
              </div>
              <span className="logo-subtext">{t('nav.brand_sub', 'Inventory Intelligence')}</span>
            </div>
          </div>
          {onCloseMobile && (
            <button 
              type="button" 
              className="sidebar-close-btn" 
              onClick={onCloseMobile}
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group-title">{t('nav.main_menu', 'MAIN MENU')}</div>
          
          <NavLink 
            to="/" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/')}
          >
            <LayoutDashboard size={17} className="nav-icon" />
            <span>{t('nav.dashboard', 'Dashboard')}</span>
          </NavLink>

          <NavLink 
            to="/forecast-explorer" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/forecast-explorer')}
          >
            <TrendingUp size={17} className="nav-icon" />
            <span>{t('nav.forecast_explorer', 'Forecast Explorer')}</span>
          </NavLink>

          <NavLink 
            to="/replenishment" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/replenishment')}
          >
            <Truck size={17} className="nav-icon" />
            <span>{t('nav.replenishment', 'Replenishment')}</span>
          </NavLink>

          <NavLink 
            to="/abc-xyz" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/abc-xyz')}
          >
            <PieChart size={17} className="nav-icon" />
            <span>{t('nav.abc_xyz', 'ABC/XYZ Analysis')}</span>
          </NavLink>

          <NavLink 
            to="/model-performance" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/model-performance')}
          >
            <Cpu size={17} className="nav-icon" />
            <span>{t('nav.model_performance', 'Model Performance')}</span>
          </NavLink>

          <NavLink 
            to="/reports" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/reports')}
          >
            <FileBarChart size={17} className="nav-icon" />
            <span>{t('nav.reports', 'Reports')}</span>
          </NavLink>

          <div className="nav-divider" />
          <div className="nav-group-title">{t('nav.system', 'SYSTEM')}</div>

          <NavLink 
            to="/products" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/products')}
          >
            <Boxes size={17} className="nav-icon" />
            <span>{t('nav.products', 'Products')}</span>
          </NavLink>
          
          <NavLink 
            to="/settings" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/settings')}
          >
            <Settings size={17} className="nav-icon" />
            <span>{t('nav.settings', 'Settings')}</span>
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile-bottom">
            <div className="user-profile-info">
              <div className="user-avatar-wrap">
                <div className="user-avatar-initials">
                  {getInitials(user?.display_name || user?.name, user?.email)}
                </div>
                <span className="user-status-dot" title="Session Active" />
              </div>
              <div className="user-details">
                <span className="user-name" title={displayName}>
                  {displayName}
                </span>
                <span className="user-role-badge">
                  {formatRole(user?.role)}
                </span>
              </div>
            </div>
            <button 
              type="button" 
              onClick={logout} 
              className="logout-btn-bottom" 
              title={t('nav.logout', 'Sign Out')}
              aria-label={t('nav.logout', 'Sign Out')}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
