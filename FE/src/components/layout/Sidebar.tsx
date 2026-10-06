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
  LogOut
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import './Sidebar.css';

export const Sidebar: React.FC = () => {
  const { logout, user } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-container">
          <div className="logo-icon">DF</div>
          <span className="logo-text">DFIOS</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-group-title">MAIN MENU</div>
        
        <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={18} />
          <span>Dashboard</span>
        </NavLink>
        <NavLink to="/forecast-explorer" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <LineChart size={18} />
          <span>Forecast Explorer</span>
        </NavLink>
        <NavLink to="/replenishment" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Package size={18} />
          <span>Replenishment</span>
        </NavLink>
        <NavLink to="/abc-xyz" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <PieChart size={18} />
          <span>ABC/XYZ Analysis</span>
        </NavLink>

        {user?.role === 'ADMIN' && (
          <NavLink to="/model-performance" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Activity size={18} />
            <span>Model Performance</span>
          </NavLink>
        )}
        <NavLink to="/reports" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <FileText size={18} />
          <span>Reports</span>
        </NavLink>

        {user?.role === 'ADMIN' && (
          <>
            <div className="nav-divider" />
            <div className="nav-group-title">SYSTEM</div>

            <NavLink to="/products" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Package size={18} />
              <span>Products</span>
            </NavLink>
            
            <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Settings size={18} />
              <span>Settings</span>
            </NavLink>
          </>
        )}
      </nav>

      <div className="sidebar-footer" style={{flexDirection: 'column', padding: '16px'}}>
        <div className="user-profile-bottom" style={{padding: 0, border: 'none'}}>
          <div className="user-profile-info">
            <img src={`https://ui-avatars.com/api/?name=${(user?.name || 'User').replace(' ', '+')}&background=0d9488&color=fff`} alt="User" className="user-avatar" />
            <div className="user-details">
              <span className="user-name">{user?.name || 'Unknown'}</span>
              <span className="user-role">{user?.role || 'User'}</span>
            </div>
          </div>
          <button onClick={logout} className="logout-btn-bottom" title="Logout">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
};
