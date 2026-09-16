import React from 'react';
import { Search, Bell, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import './Topbar.css';

export const Topbar: React.FC = () => {
  const { logout } = useAuth();

  return (
    <header className="topbar">
      <div className="topbar-search">
        <Search size={16} className="search-icon" />
        <input type="text" placeholder="Search SKU or location..." />
      </div>
      
      <div className="topbar-actions">
        <button className="icon-btn">
          <Bell size={18} />
        </button>
        
        <div className="user-profile">
          <div className="avatar">
            <img src="https://ui-avatars.com/api/?name=John+Doe&background=0f172a&color=fff" alt="User" />
          </div>
          <div className="user-info">
            <span className="user-name">John D.</span>
            <span className="user-role">Inventory Manager</span>
          </div>
          <button className="logout-btn" onClick={logout} title="Sign Out">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  );
};
