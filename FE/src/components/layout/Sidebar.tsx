import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  LineChart, 
  Package, 
  PieChart, 
  Activity, 
  Settings, 
  FileText,
  LogOut,
  X
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useLanguage } from '../../context/LanguageContext.tsx';
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
    if (!role) return 'User';
    const r = role.toUpperCase();
    if (r === 'ADMIN') return 'Administrator';
    if (r === 'WAREHOUSE MANAGER') return 'Warehouse Manager';
    if (r === 'VIEWER') return 'Viewer';
    return role;
  };

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
            <div className="logo-icon">DF</div>
            <div className="logo-text">
              <h2>DFIOS</h2>
              <span>DEMAND FORECASTING</span>
            </div>
          </div>
          {onCloseMobile && (
            <button 
              type="button" 
              className="sidebar-close-btn" 
              onClick={onCloseMobile}
              aria-label="Close menu"
            >
              <X size={18} />
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
            <LayoutDashboard size={18} />
            <span>{t('nav.dashboard', 'Dashboard')}</span>
          </NavLink>
          <NavLink 
            to="/forecast-explorer" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/forecast-explorer')}
          >
            <LineChart size={18} />
            <span>{t('nav.forecast_explorer', 'Forecast Explorer')}</span>
          </NavLink>
          <NavLink 
            to="/replenishment" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/replenishment')}
          >
            <Package size={18} />
            <span>{t('nav.replenishment', 'Replenishment')}</span>
          </NavLink>
          <NavLink 
            to="/abc-xyz" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/abc-xyz')}
          >
            <PieChart size={18} />
            <span>{t('nav.abc_xyz', 'ABC/XYZ Analysis')}</span>
          </NavLink>

          <NavLink 
            to="/model-performance" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/model-performance')}
          >
            <Activity size={18} />
            <span>{t('nav.model_performance', 'Model Performance')}</span>
          </NavLink>
          <NavLink 
            to="/reports" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/reports')}
          >
            <FileText size={18} />
            <span>{t('nav.reports', 'Reports')}</span>
          </NavLink>

          <div className="nav-divider" />
          <div className="nav-group-title">{t('nav.system', 'SYSTEM')}</div>

          <NavLink 
            to="/products" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/products')}
          >
            <Package size={18} />
            <span>{t('nav.products', 'Products')}</span>
          </NavLink>
          
          <NavLink 
            to="/settings" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleNavClick('/settings')}
          >
            <Settings size={18} />
            <span>{t('nav.settings', 'Settings')}</span>
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile-bottom">
            <div className="user-profile-info">
              <img 
                src={`https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || user?.display_name || 'User')}&background=0d9488&color=fff`} 
                alt="User Avatar" 
                className="user-avatar" 
              />
              <div className="user-details">
                <span className="user-name">{user?.name || user?.display_name || 'Admin'}</span>
                <span className="user-role">{formatRole(user?.role)}</span>
              </div>
            </div>
            <button 
              type="button" 
              onClick={logout} 
              className="logout-btn-bottom" 
              title={t('nav.logout', 'Sign Out')}
              aria-label={t('nav.logout', 'Sign Out')}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
