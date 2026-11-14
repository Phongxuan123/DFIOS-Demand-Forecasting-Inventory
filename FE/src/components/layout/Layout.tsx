import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.tsx';
import { Topbar } from './Topbar.tsx';

export const Layout: React.FC = () => {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [forbiddenToast, setForbiddenToast] = useState<string | null>(null);

  useEffect(() => {
    let timer: any = null;
    const handleForbidden = (e: Event) => {
      const msg = (e as CustomEvent)?.detail?.message || 'Access denied (403 Forbidden)';
      setForbiddenToast(msg);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setForbiddenToast(null);
      }, 5000);
    };

    window.addEventListener('dfios:forbidden', handleForbidden);
    return () => {
      window.removeEventListener('dfios:forbidden', handleForbidden);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="app-container">
      {forbiddenToast && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            right: 20,
            zIndex: 99999,
            background: '#b91c1c',
            color: '#ffffff',
            padding: '10px 18px',
            borderRadius: 8,
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <span>{forbiddenToast}</span>
        </div>
      )}
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
