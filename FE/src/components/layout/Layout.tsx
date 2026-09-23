import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.tsx';
import { Topbar } from './Topbar.tsx';

export const Layout: React.FC = () => {
  
  

  return (
    <div className="app-container">
      <Sidebar />
      <main className="main-content">
        <Topbar />
        <div className="page-container">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
