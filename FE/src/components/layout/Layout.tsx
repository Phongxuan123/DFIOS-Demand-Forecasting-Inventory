import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.tsx';
import { Topbar } from './Topbar.tsx';

export const Layout: React.FC = () => {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="app-container">
      <Sidebar 
        mobileOpen={mobileSidebarOpen} 
        onCloseMobile={() => setMobileSidebarOpen(false)} 
      />
      <main className="main-content">
        <Topbar 
          onToggleMobileSidebar={() => setMobileSidebarOpen((prev) => !prev)} 
        />
        <div className="page-container">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
