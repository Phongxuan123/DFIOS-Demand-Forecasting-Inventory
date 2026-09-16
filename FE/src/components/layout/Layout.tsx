import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar.tsx';
import { Topbar } from './Topbar.tsx';

export const Layout: React.FC = () => {
  const location = useLocation();
  const isDashboard = location.pathname === '/';

  return (
    <div className="app-container">
      <Sidebar />
      <main className="main-content">
        {!isDashboard && <Topbar />}
        <div className="page-container" style={{ paddingTop: isDashboard ? '2rem' : undefined }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
};
