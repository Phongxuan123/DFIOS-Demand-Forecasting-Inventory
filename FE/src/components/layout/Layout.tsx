import React, { Suspense, useCallback, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { StoreProvider } from '../../context/StoreContext.tsx';
import { ClockProvider } from '../../context/ClockContext.tsx';
import { useT } from '../../i18n/index.tsx';
import { Skeleton } from '../ui/primitives.tsx';
import { ErrorState } from '../ui/states.tsx';
import { Sidebar } from './Sidebar.tsx';
import { Topbar } from './Topbar.tsx';
import './shell.css';

const COLLAPSE_KEY = 'dfios_sidebar_collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Catches render errors and failed lazy chunks so one page never blanks the whole shell. */
class PageBoundary extends React.Component<{ children: React.ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('render error') };
  }
  render() {
    if (this.state.error) {
      return <ErrorState error={this.state.error} onRetry={() => window.location.reload()} />;
    }
    return this.props.children;
  }
}

const PageFallback: React.FC = () => {
  const t = useT();
  return (
    <div role="status" aria-label={t('shell.page_loading')} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Skeleton width={240} height={28} />
      <Skeleton width={420} height={14} />
      <Skeleton height={180} style={{ borderRadius: 'var(--radius-lg)' }} />
    </div>
  );
};

export const Layout: React.FC = () => {
  const t = useT();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  }, []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);

  return (
    <StoreProvider>
      <ClockProvider>
        <div className="shell" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
          <a href="#main" className="shell-skip">
            {t('shell.skip_to_content')}
          </a>
          <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} mobileOpen={mobileOpen} onCloseMobile={closeMobile} />
          <div className="shell-main">
            <Topbar onOpenMobileMenu={openMobile} />
            <main id="main" className="shell-content" tabIndex={-1}>
              <div className="shell-content__inner">
                <PageBoundary key={location.pathname}>
                  <Suspense fallback={<PageFallback />}>
                    <Outlet />
                  </Suspense>
                </PageBoundary>
              </div>
            </main>
          </div>
        </div>
      </ClockProvider>
    </StoreProvider>
  );
};
