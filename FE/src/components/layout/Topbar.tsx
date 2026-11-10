import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Search,
  Bell,
  Calendar,
  X,
  Loader2,
  ArrowRight,
  Menu,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  MoreHorizontal,
} from 'lucide-react';
import { api, clearApiCache } from '../../services/api.ts';
import { useSSE } from '../../hooks/useSSE.ts';
import { useLanguage } from '../../context/LanguageContext.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { LanguageToggle } from '../common/LanguageToggle.tsx';
import {
  ALERTS_SYNC_EVENT,
  type AlertsSyncDetail,
  type TrackedAlertItem,
  applyOptimisticAlertSync,
  fetchCriticalDashboardAlerts,
  fetchRecommendationsForAlerts,
  getAlertStorageKey,
  loadTrackedAlerts,
  prefetchReplenishmentTarget,
  reconcileTrackedAlerts,
  saveTrackedAlerts,
} from '../../utils/alertTracker.ts';
import './Topbar.css';

interface TopbarProps {
  onToggleMobileSidebar?: () => void;
}

const NOTIF_PAGE_SIZE = 6;

const getCompactPageNumbers = (current: number, total: number): Array<number | 'ellipsis'> => {
  if (total <= 5) {
    return Array.from({ length: total }, (_, idx) => idx + 1);
  }
  if (current <= 3) {
    return [1, 2, 3, 4, 'ellipsis', total];
  }
  if (current >= total - 2) {
    return [1, 'ellipsis', total - 3, total - 2, total - 1, total];
  }
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total];
};

const getPageConfig = (pathname: string, t: (k: string, fb?: string) => string) => {
  switch (pathname) {
    case '/':
      return {
        section: t('nav.main_menu', 'MAIN MENU'),
        title: t('nav.dashboard', 'Dashboard'),
        subtitle: t('dashboard.hero_title', 'Executive Operations & Control'),
        placeholder: t('topbar.search_placeholder', 'Search products, locations, SKUs...'),
        context: 'dashboard',
      };
    case '/forecast-explorer':
      return {
        section: t('nav.main_menu', 'MAIN MENU'),
        title: t('nav.forecast_explorer', 'Forecast Explorer'),
        subtitle: t('forecast.title', 'Demand Forecast Explorer'),
        placeholder: t('topbar.search_placeholder', 'Search SKUs for forecast data...'),
        context: 'forecast',
      };
    case '/replenishment':
      return {
        section: t('nav.main_menu', 'MAIN MENU'),
        title: t('nav.replenishment', 'Replenishment'),
        subtitle: t('replenishment.title', 'Replenishment & Order Management'),
        placeholder: t('topbar.search_placeholder', 'Search orders, suppliers...'),
        context: 'replenishment',
      };
    case '/abc-xyz':
      return {
        section: t('nav.main_menu', 'MAIN MENU'),
        title: t('nav.abc_xyz', 'ABC/XYZ Analysis'),
        subtitle: t('abcxyz.title', 'ABC/XYZ Inventory Matrix'),
        placeholder: t('topbar.search_placeholder', 'Search SKUs to see classification...'),
        context: 'abcxyz',
      };
    case '/model-performance':
      return {
        section: t('nav.main_menu', 'MAIN MENU'),
        title: t('nav.model_performance', 'Model Performance'),
        subtitle: t('modelPerformance.title', 'Model Registry & Diagnostic Analytics'),
        placeholder: t('topbar.search_placeholder', 'Search models, metrics...'),
        context: 'models',
      };
    case '/reports':
      return {
        section: t('nav.main_menu', 'MAIN MENU'),
        title: t('nav.reports', 'Reports & Analytics'),
        subtitle: t('reports.title', 'Executive Reports & Analytics'),
        placeholder: t('topbar.search_placeholder', 'Search report templates...'),
        context: 'reports',
      };
    case '/products':
      return {
        section: t('nav.system', 'SYSTEM'),
        title: t('nav.products', 'Products'),
        subtitle: t('products.title', 'Product Catalog & Inventory Registry'),
        placeholder: t('topbar.search_placeholder', 'Search product names or SKUs...'),
        context: 'products',
      };
    case '/settings':
      return {
        section: t('nav.system', 'SYSTEM'),
        title: t('nav.settings', 'Settings'),
        subtitle: t('settings.title', 'System Settings & Enterprise Administration'),
        placeholder: t('topbar.search_placeholder', 'Search settings, parameters...'),
        context: 'settings',
      };
    default:
      return {
        section: 'DFIOS',
        title: 'DFIOS',
        subtitle: 'Enterprise Supply Chain & Demand Intelligence',
        placeholder: t('topbar.search_placeholder', 'Search...'),
        context: 'general',
      };
  }
};

export const Topbar: React.FC<TopbarProps> = ({ onToggleMobileSidebar }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const config = getPageConfig(location.pathname, t);
  const alertStorageKey = getAlertStorageKey(user);
  const canViewReplenishments = user?.role?.toUpperCase() !== 'VIEWER';

  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('dfios_search_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifFilter, setNotifFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [notifPage, setNotifPage] = useState(1);
  const [alertsState, setAlertsState] = useState<{
    key: string;
    items: TrackedAlertItem[];
  }>(() => ({
    key: alertStorageKey,
    items: loadTrackedAlerts(alertStorageKey),
  }));

  const trackedAlerts = useMemo(
    () => (alertsState.key === alertStorageKey ? alertsState.items : loadTrackedAlerts(alertStorageKey)),
    [alertsState, alertStorageKey]
  );

  const notifRef = useRef<HTMLDivElement>(null);
  const notifListRef = useRef<HTMLDivElement>(null);
  const trackedRef = useRef<TrackedAlertItem[]>(trackedAlerts);
  const isSyncingRef = useRef(false);
  const pendingResyncRef = useRef(false);
  const lastSyncedAtRef = useRef(0);
  const focusCounterRef = useRef(0);

  useEffect(() => {
    trackedRef.current = trackedAlerts;
  }, [trackedAlerts]);

  // Close notifications on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const syncAlerts = useCallback(
    async (forceFresh: boolean = false, clearReplenishCache: boolean = false) => {
      if (isSyncingRef.current) {
        pendingResyncRef.current = true;
        return;
      }
      isSyncingRef.current = true;
      try {
        if (forceFresh) {
          clearApiCache('/dashboard/alerts');
          if (clearReplenishCache) {
            clearApiCache('/replenishments');
          }
        }
        const [critRes, recRes] = await Promise.all([
          fetchCriticalDashboardAlerts(),
          canViewReplenishments ? fetchRecommendationsForAlerts() : Promise.resolve(null),
        ]);

        if (!critRes.fetchSuccess) return;

        const reconciled = reconcileTrackedAlerts({
          previousTracked: trackedRef.current,
          criticalAlerts: critRes.items,
          totalCriticalInDb: critRes.totalCriticalInDb,
          recommendations: recRes,
        });

        trackedRef.current = reconciled;
        setAlertsState({ key: alertStorageKey, items: reconciled });
        saveTrackedAlerts(alertStorageKey, reconciled);
        lastSyncedAtRef.current = Date.now();
      } finally {
        isSyncingRef.current = false;
        if (pendingResyncRef.current) {
          pendingResyncRef.current = false;
          void syncAlerts(true, false);
        }
      }
    },
    [alertStorageKey, canViewReplenishments]
  );

  // Sync per-account alerts when logged-in account changes
  useEffect(() => {
    trackedRef.current = loadTrackedAlerts(alertStorageKey);
    void syncAlerts(false, false);
  }, [alertStorageKey, syncAlerts]);

  // Listen to same-tab replenishment/inventory actions for immediate status & badge update
  useEffect(() => {
    const handleSyncEvent = (event: Event) => {
      const detail = (event as CustomEvent<AlertsSyncDetail>).detail;
      if (detail) {
        const optimistic = applyOptimisticAlertSync(trackedRef.current, detail);
        trackedRef.current = optimistic;
        setAlertsState({ key: alertStorageKey, items: optimistic });
        saveTrackedAlerts(alertStorageKey, optimistic);
      }
      void syncAlerts(true, true);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSyncedAtRef.current > 15000) {
        void syncAlerts(true, true);
      }
    };

    window.addEventListener(ALERTS_SYNC_EVENT, handleSyncEvent);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener(ALERTS_SYNC_EVENT, handleSyncEvent);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [alertStorageKey, syncAlerts]);

  // Realtime Server-Sent Events (SSE) stream listener: reconcile instead of injecting raw logs
  const sse = useSSE('/events');
  useEffect(() => {
    if (sse.data && sse.data.type !== 'connected' && sse.data.type !== 'close') {
      void syncAlerts(true, true);
    }
  }, [sse.data, syncAlerts]);

  // Keyboard shortcut for command palette (Ctrl+K or Cmd+K)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsCommandPaletteOpen((open) => !open);
      }
      if (e.key === 'Escape' && isCommandPaletteOpen) {
        setIsCommandPaletteOpen(false);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [isCommandPaletteOpen]);

  // Backend product/SKU search
  useEffect(() => {
    if (!searchTerm.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    const delay = setTimeout(async () => {
      try {
        const term = searchTerm.toLowerCase().trim();
        const res = await api.products.getProducts({ search: term, limit: 10 });
        const found = (res.list || []).map((p: any) => ({
          id: p.item_id,
          name: p.name,
          category: p.cat_id || p.dept_id || 'SKU',
        }));
        setResults(found);
      } catch (err) {
        console.error('Search failed', err);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(delay);
  }, [searchTerm]);

  const handleSelectHistory = (term: string) => {
    setSearchTerm(term);
  };

  const unreadAlerts = useMemo(
    () => trackedAlerts.filter((item) => item.alertState === 'unread'),
    [trackedAlerts]
  );

  const readAlerts = useMemo(
    () => trackedAlerts.filter((item) => item.alertState === 'read'),
    [trackedAlerts]
  );

  const unreadCount = unreadAlerts.length;

  const filteredAlerts = useMemo(() => {
    if (notifFilter === 'unread') return unreadAlerts;
    if (notifFilter === 'read') return readAlerts;
    return trackedAlerts;
  }, [notifFilter, unreadAlerts, readAlerts, trackedAlerts]);

  const totalNotifItems = filteredAlerts.length;
  const totalNotifPages = Math.max(1, Math.ceil(totalNotifItems / NOTIF_PAGE_SIZE));
  const safeNotifPage = Math.min(Math.max(1, notifPage), totalNotifPages);
  const notifRangeStart = totalNotifItems === 0 ? 0 : (safeNotifPage - 1) * NOTIF_PAGE_SIZE + 1;
  const notifRangeEnd = Math.min(safeNotifPage * NOTIF_PAGE_SIZE, totalNotifItems);

  const paginatedAlerts = useMemo(() => {
    const startIdx = (safeNotifPage - 1) * NOTIF_PAGE_SIZE;
    return filteredAlerts.slice(startIdx, startIdx + NOTIF_PAGE_SIZE);
  }, [filteredAlerts, safeNotifPage]);

  const pageUnreadAlerts = useMemo(
    () => paginatedAlerts.filter((item) => item.alertState === 'unread'),
    [paginatedAlerts]
  );

  const pageReadAlerts = useMemo(
    () => paginatedAlerts.filter((item) => item.alertState === 'read'),
    [paginatedAlerts]
  );

  const compactPageNumbers = useMemo(
    () => getCompactPageNumbers(safeNotifPage, totalNotifPages),
    [safeNotifPage, totalNotifPages]
  );

  const handleChangeNotifFilter = (nextFilter: 'all' | 'unread' | 'read') => {
    setNotifFilter(nextFilter);
    setNotifPage(1);
    if (notifListRef.current) {
      notifListRef.current.scrollTop = 0;
    }
  };

  const handleChangeNotifPage = (nextPage: number) => {
    const clamped = Math.min(Math.max(1, nextPage), totalNotifPages);
    setNotifPage(clamped);
    if (notifListRef.current) {
      notifListRef.current.scrollTop = 0;
    }
  };

  const handleToggleNotifications = () => {
    const nextOpen = !showNotifications;
    setShowNotifications(nextOpen);
    if (nextOpen) {
      if (notifListRef.current) {
        notifListRef.current.scrollTop = 0;
      }
      // Pre-warm the primary alert's store right on popover open
      const topStore = unreadAlerts[0]?.store_id || trackedAlerts[0]?.store_id;
      if (topStore) {
        prefetchReplenishmentTarget(topStore, canViewReplenishments);
      }
      if (Date.now() - lastSyncedAtRef.current > 10000) {
        void syncAlerts(true, Date.now() - lastSyncedAtRef.current > 45000);
      }
    }
  };

  const handlePrefetchAlertStore = (storeId?: string) => {
    prefetchReplenishmentTarget(storeId, canViewReplenishments);
  };

  const handleAlertItemClick = (alert: TrackedAlertItem) => {
    handlePrefetchAlertStore(alert.store_id);
    setShowNotifications(false);
    focusCounterRef.current += 1;
    const params = new URLSearchParams({
      sku: alert.item_id,
      store: alert.store_id || 'CA_1',
      focus: String(focusCounterRef.current),
    });
    navigate(`/replenishment?${params.toString()}`);
  };

  const renderAlertItem = (alert: TrackedAlertItem) => {
    const isUnread = alert.alertState === 'unread';
    const resolvedSubtitle =
      alert.resolvedReason === 'po_approved'
        ? t('topbar.status_po_approved', 'PO approved · In transit')
        : t('topbar.status_stock_restored', 'Stock above safety threshold');

    return (
      <button
        type="button"
        className={`notification-item ${isUnread ? 'is-unread' : 'is-read'}`}
        key={alert.key}
        onMouseEnter={() => handlePrefetchAlertStore(alert.store_id)}
        onFocus={() => handlePrefetchAlertStore(alert.store_id)}
        onPointerDown={() => handlePrefetchAlertStore(alert.store_id)}
        onClick={() => handleAlertItemClick(alert)}
      >
        <div className="notif-icon-col">
          {isUnread ? (
            <AlertCircle size={15} className="notif-icon-svg critical" />
          ) : (
            <CheckCircle2 size={15} className="notif-icon-svg resolved" />
          )}
        </div>
        <div className="notif-content">
          <div className="notif-title-row">
            <span className="notif-sku">{alert.item_id}</span>
            <span className="notif-store-tag">{alert.store_id}</span>
            <span className={`notif-sev-badge ${isUnread ? 'critical' : 'resolved'}`}>
              {isUnread ? 'CRITICAL' : t('topbar.badge_read', 'DONE')}
            </span>
          </div>
          <p className="notif-metrics">
            {isUnread ? (
              <>
                On-Hand: <strong>{Math.round(alert.on_hand)}</strong> &middot; SS:{' '}
                <strong>{Math.round(alert.safety_stock)}</strong> &middot; ROP:{' '}
                <strong>{Math.round(alert.reorder_point)}</strong>
              </>
            ) : alert.resolvedReason === 'po_approved' ? (
              <>
                {resolvedSubtitle} &middot; OO: <strong>{Math.round(alert.on_order)}</strong>
              </>
            ) : (
              <>
                On-Hand: <strong>{Math.round(alert.on_hand)}</strong> &middot; SS:{' '}
                <strong>{Math.round(alert.safety_stock)}</strong>
              </>
            )}
          </p>
          <span className="notif-meta">
            {alert.product_name && alert.product_name !== alert.item_id ? `${alert.product_name} \u2022 ` : ''}
            {isUnread ? t('topbar.status_alerting', 'Stockout alert') : resolvedSubtitle}
          </span>
        </div>
        <div className="notif-trail-col">
          {isUnread && <span className="notif-unread-dot" aria-hidden="true" />}
          <ChevronRight size={13} className="notif-item-chevron" aria-hidden="true" />
        </div>
      </button>
    );
  };

  const formattedDate = new Date().toLocaleDateString(language === 'vi' ? 'vi-VN' : 'en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });

  return (
    <header className="topbar">
      <div className="topbar-left">
        {onToggleMobileSidebar && (
          <button 
            type="button" 
            className="topbar-mobile-menu-btn" 
            onClick={onToggleMobileSidebar}
            aria-label="Toggle navigation menu"
          >
            <Menu size={18} />
          </button>
        )}
        <div className="topbar-breadcrumb">
          <span className="breadcrumb-brand">DFIOS</span>
          <span className="breadcrumb-sep">/</span>
          <h1 className="topbar-page-title">{config.subtitle || config.title}</h1>
        </div>
      </div>
      
      <div className="topbar-actions-right">
        {/* Search trigger button opening Command Palette */}
        <div 
          className="topbar-search-trigger" 
          onClick={() => setIsCommandPaletteOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsCommandPaletteOpen(true); }}
          aria-label={t('topbar.search_placeholder', 'Search products, locations, SKUs...')}
        >
          <Search size={14} className="search-icon-svg" />
          <span className="search-placeholder">{t('topbar.search', 'Search...')}</span>
        </div>

        {/* Nút chuyển đổi ngôn ngữ EN / VI */}
        <LanguageToggle />

        {/* Command Palette Modal */}
        {isCommandPaletteOpen && createPortal(
          <div className="command-palette-overlay" onClick={() => setIsCommandPaletteOpen(false)}>
            <div className="command-palette-modal" onClick={(e) => e.stopPropagation()}>
              <div className="cp-header">
                <Search size={16} className="cp-icon" />
                <input 
                  type="text" 
                  placeholder={config.placeholder || t('topbar.command_palette_placeholder', 'Type a command or search...')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="cp-input"
                  autoFocus
                />
                {searchTerm && (
                  <button className="cp-clear-input-btn" onClick={() => setSearchTerm('')} aria-label="Clear search">
                    <X size={14} />
                  </button>
                )}
                <button className="cp-close-btn" onClick={() => setIsCommandPaletteOpen(false)} aria-label="Close command palette">
                  <span className="cp-esc-tag">{t('topbar.esc_to_close', 'ESC')}</span>
                </button>
              </div>
              
              <div className="cp-body">
                {isSearching && (
                  <div className="cp-loading">
                    <Loader2 size={15} className="animate-spin" />
                    <span>{t('common.loading', 'Searching...')}</span>
                  </div>
                )}
                
                {!searchTerm && history.length > 0 && (
                  <div className="cp-section">
                    <div className="cp-section-title">{t('topbar.recent_searches', 'Recent Searches')}</div>
                    {history.map((h, i) => (
                      <div key={i} className="cp-item" onClick={() => handleSelectHistory(h)}>
                        <ArrowRight size={13} className="cp-item-icon" />
                        <span>{h}</span>
                      </div>
                    ))}
                  </div>
                )}
                
                {!searchTerm && (
                  <>
                    <div className="cp-section">
                      <div className="cp-section-title">{t('topbar.navigation_section', 'Navigation')}</div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/'); }}>
                        <ArrowRight size={13} className="cp-item-icon" />
                        <span>{t('nav.dashboard', 'Dashboard')}</span>
                      </div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/forecast-explorer'); }}>
                        <ArrowRight size={13} className="cp-item-icon" />
                        <span>{t('nav.forecast_explorer', 'Forecast Explorer')}</span>
                      </div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/replenishment'); }}>
                        <ArrowRight size={13} className="cp-item-icon" />
                        <span>{t('nav.replenishment', 'Replenishment')}</span>
                      </div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/abc-xyz'); }}>
                        <ArrowRight size={13} className="cp-item-icon" />
                        <span>{t('nav.abc_xyz', 'ABC/XYZ Analysis')}</span>
                      </div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/model-performance'); }}>
                        <ArrowRight size={13} className="cp-item-icon" />
                        <span>{t('nav.model_performance', 'Model Performance')}</span>
                      </div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/reports'); }}>
                        <ArrowRight size={13} className="cp-item-icon" />
                        <span>{t('nav.reports', 'Reports & Analytics')}</span>
                      </div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/products'); }}>
                        <ArrowRight size={13} className="cp-item-icon" />
                        <span>{t('nav.products', 'Products')}</span>
                      </div>
                    </div>
                    
                    <div className="cp-section">
                      <div className="cp-section-title">{t('topbar.settings_section', 'Settings & Administration')}</div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/settings'); }}>
                        <ArrowRight size={13} className="cp-item-icon" />
                        <span>{t('settings.tab_config', 'System Configuration')}</span>
                      </div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/settings'); }}>
                        <ArrowRight size={13} className="cp-item-icon" />
                        <span>{t('settings.tab_users', 'User Management')}</span>
                      </div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/settings'); }}>
                        <ArrowRight size={13} className="cp-item-icon" />
                        <span>{t('settings.tab_audit', 'Audit Logs')}</span>
                      </div>
                    </div>
                  </>
                )}
                
                {searchTerm && !isSearching && results.length === 0 && (
                  <div className="cp-no-results">
                    <p>{t('topbar.no_results_found', 'No results found for')} "{searchTerm}"</p>
                    <span className="cp-search-hint">{t('topbar.search_hint', 'Try searching for a different keyword, SKU, or check spelling.')}</span>
                  </div>
                )}
                
                {searchTerm && !isSearching && results.length > 0 && (
                  <div className="cp-section">
                    <div className="cp-section-title">{t('topbar.suggested_results', 'Suggested Results')}</div>
                    {results.slice(0, 6).map((res, idx) => (
                      <div 
                        key={idx} 
                        className="cp-item" 
                        onClick={() => {
                          setSearchTerm(res.name || res.title);
                          if (!history.includes(res.name || res.title)) {
                            const updated = [res.name || res.title, ...history].slice(0, 5);
                            setHistory(updated);
                            try { localStorage.setItem('dfios_search_history', JSON.stringify(updated)); } catch {}
                          }
                          setIsCommandPaletteOpen(false);
                          navigate(`/products?search=${encodeURIComponent(res.id || res.name)}`);
                        }}
                      >
                        <ArrowRight size={13} className="cp-item-icon" />
                        <div className="cp-item-content">
                          {res.id && <span className="cp-result-id">{res.id}</span>}
                          <span className="cp-result-name">{res.name || res.title}</span>
                        </div>
                        {res.category && <span className="cp-result-meta">{res.category}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Stock Alerts Notification Bell */}
        <div className="notif-wrapper" ref={notifRef}>
          <button
            type="button"
            className={`topbar-bell-btn ${showNotifications ? 'is-open' : ''}`}
            onClick={handleToggleNotifications}
            aria-label={t('topbar.notifications', 'Notifications')}
            aria-expanded={showNotifications}
            aria-haspopup="true"
          >
            <Bell size={16} />
            {unreadCount > 0 && (
              <span className="topbar-bell-badge">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="topbar-notifications-dropdown" role="dialog" aria-label={t('topbar.stock_alerts', 'Stock Alerts')}>
              <div className="notifications-header">
                <div className="notifications-header-left">
                  <h3>{t('topbar.stock_alerts', 'Stock Alerts')}</h3>
                </div>
                {unreadCount > 0 ? (
                  <span className="notif-count-pill is-active">
                    {unreadCount} {t('topbar.active_alerts_count', 'active')}
                  </span>
                ) : (
                  <span className="notif-count-pill is-clear">
                    {t('topbar.all_clear', 'All clear')}
                  </span>
                )}
              </div>

              {trackedAlerts.length > 0 && (
                <div className="notifications-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={notifFilter === 'all'}
                    className={`notif-tab-btn ${notifFilter === 'all' ? 'active' : ''}`}
                    onClick={() => handleChangeNotifFilter('all')}
                  >
                    <span>{t('topbar.filter_all', 'All')}</span>
                    <span className="notif-tab-count">{trackedAlerts.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={notifFilter === 'unread'}
                    className={`notif-tab-btn ${notifFilter === 'unread' ? 'active' : ''}`}
                    onClick={() => handleChangeNotifFilter('unread')}
                  >
                    <span>{t('topbar.filter_unread', 'Alerts')}</span>
                    <span className={`notif-tab-count ${unreadCount > 0 ? 'has-unread' : ''}`}>
                      {unreadCount}
                    </span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={notifFilter === 'read'}
                    className={`notif-tab-btn ${notifFilter === 'read' ? 'active' : ''}`}
                    onClick={() => handleChangeNotifFilter('read')}
                  >
                    <span>{t('topbar.filter_read', 'Done')}</span>
                    <span className={`notif-tab-count ${readAlerts.length > 0 ? 'has-done' : ''}`}>
                      {readAlerts.length}
                    </span>
                  </button>
                </div>
              )}

              <div className="notifications-list" ref={notifListRef}>
                {trackedAlerts.length === 0 && (
                  <div className="notification-empty">
                    <div className="notification-empty-icon">
                      <CheckCircle2 size={18} />
                    </div>
                    <p>{t('topbar.no_alerts', 'No active or completed alerts recorded yet.')}</p>
                    <span>{t('topbar.updated_now', 'Updated now')}</span>
                  </div>
                )}

                {trackedAlerts.length > 0 && notifFilter === 'unread' && unreadAlerts.length === 0 && (
                  <div className="notification-empty">
                    <div className="notification-empty-icon">
                      <CheckCircle2 size={18} />
                    </div>
                    <p>{t('topbar.no_unread_alerts', 'All critical stock alerts have been handled.')}</p>
                    <span>{t('topbar.updated_now', 'Updated now')}</span>
                  </div>
                )}

                {trackedAlerts.length > 0 && notifFilter === 'read' && readAlerts.length === 0 && (
                  <div className="notification-empty">
                    <p>{t('topbar.no_read_alerts', 'Completed alerts will appear here once resolved.')}</p>
                    <span>{t('topbar.updated_now', 'Updated now')}</span>
                  </div>
                )}

                {pageUnreadAlerts.length > 0 && (
                  <div className="notifications-section">
                    {notifFilter === 'all' && readAlerts.length > 0 && (
                      <div className="notifications-section-label">
                        <span>{t('topbar.section_unread', 'Active Alerts')}</span>
                        <span>{unreadAlerts.length}</span>
                      </div>
                    )}
                    {pageUnreadAlerts.map(renderAlertItem)}
                  </div>
                )}

                {pageReadAlerts.length > 0 && (
                  <div className="notifications-section">
                    {notifFilter === 'all' && unreadAlerts.length > 0 && (
                      <div className="notifications-section-label">
                        <span>{t('topbar.section_read', 'Done · Resolved')}</span>
                        <span>{readAlerts.length}</span>
                      </div>
                    )}
                    {pageReadAlerts.map(renderAlertItem)}
                  </div>
                )}
              </div>

              {totalNotifPages > 1 && (
                <nav
                  className="notifications-pagination"
                  role="navigation"
                  aria-label={t('topbar.pagination_aria', 'Notifications pagination')}
                >
                  <span className="notif-page-summary">
                    {notifRangeStart}&ndash;{notifRangeEnd} / {totalNotifItems}
                  </span>
                  <ul className="notif-page-list">
                    <li>
                      <button
                        type="button"
                        className="notif-page-btn nav-arrow"
                        onClick={() => handleChangeNotifPage(safeNotifPage - 1)}
                        disabled={safeNotifPage === 1}
                        aria-label={t('topbar.prev_page', 'Previous page')}
                        title={t('topbar.prev_page', 'Previous page')}
                      >
                        <ChevronLeft size={13} />
                      </button>
                    </li>
                    {compactPageNumbers.map((token, idx) =>
                      token === 'ellipsis' ? (
                        <li key={`ellipsis-${idx}`} className="notif-page-ellipsis" aria-hidden="true">
                          <MoreHorizontal size={12} />
                        </li>
                      ) : (
                        <li key={`page-${token}`}>
                          <button
                            type="button"
                            className={`notif-page-btn ${safeNotifPage === token ? 'is-active' : ''}`}
                            aria-current={safeNotifPage === token ? 'page' : undefined}
                            onClick={() => handleChangeNotifPage(token)}
                          >
                            {token}
                          </button>
                        </li>
                      )
                    )}
                    <li>
                      <button
                        type="button"
                        className="notif-page-btn nav-arrow"
                        onClick={() => handleChangeNotifPage(safeNotifPage + 1)}
                        disabled={safeNotifPage === totalNotifPages}
                        aria-label={t('topbar.next_page', 'Next page')}
                        title={t('topbar.next_page', 'Next page')}
                      >
                        <ChevronRight size={13} />
                      </button>
                    </li>
                  </ul>
                </nav>
              )}

              <div className="notifications-footer">
                <button
                  type="button"
                  className="notif-footer-link"
                  onClick={() => {
                    setShowNotifications(false);
                    navigate('/replenishment');
                  }}
                >
                  <span>{t('topbar.view_all_replenishment', 'Open Replenishment & Orders')}</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
        
        {/* Date / Live Operational Clock */}
        <div className="topbar-date-display" title="Operational Date">
          <Calendar size={13} className="topbar-date-icon" />
          <span className="topbar-date-text">{formattedDate}</span>
          <span className="topbar-live-dot" title="Live Clock" />
        </div>
      </div>
    </header>
  );
};
