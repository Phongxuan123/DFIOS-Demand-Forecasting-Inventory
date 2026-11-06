import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, Calendar, X, Loader2, ArrowRight, Menu, AlertTriangle, AlertCircle } from 'lucide-react';
import { api } from '../../services/api.ts';
import { useSSE } from '../../hooks/useSSE.ts';
import { useLanguage } from '../../context/LanguageContext.tsx';
import { LanguageToggle } from '../common/LanguageToggle.tsx';
import './Topbar.css';

interface TopbarProps {
  onToggleMobileSidebar?: () => void;
}

interface AlertItem {
  id?: string;
  item_id?: string;
  name?: string;
  store?: string;
  store_id?: string;
  on_hand?: number;
  stock?: number;
  safety_stock?: number;
  reorder_point?: number;
  rop?: number;
  severity?: 'CRITICAL' | 'WARNING' | 'HEALTHY';
  status?: string;
  details?: string;
}

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
  const config = getPageConfig(location.pathname, t);
  
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
  const [stockAlerts, setStockAlerts] = useState<AlertItem[]>([]);
  const [criticalCount, setCriticalCount] = useState<number>(0);
  
  const notifRef = useRef<HTMLDivElement>(null);

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

  // Fetch real Backend stock alerts from /dashboard/alerts
  useEffect(() => {
    api.dashboard.getAlerts({ severity: 'CRITICAL', limit: 8 })
      .then((res: any) => {
        const items = res?.items || [];
        setStockAlerts(items);
        setCriticalCount(res?.critical_count ?? items.length);
      })
      .catch(() => {
        // Fallback gracefully to inventory alerts if needed
        api.inventory.getReplenishmentAlerts()
          .then((res: any) => {
            const list = res?.alerts || [];
            setStockAlerts(list);
            setCriticalCount(list.length);
          })
          .catch(() => {
            setStockAlerts([]);
            setCriticalCount(0);
          });
      });
  }, []);

  // Realtime Server-Sent Events (SSE) stream listener
  const sse = useSSE('/events');
  useEffect(() => {
    if (sse.data && sse.data.type !== 'connected' && sse.data.type !== 'close') {
      const newNotif: AlertItem = {
        name: `[Event: ${sse.data.type}]`,
        details: typeof sse.data.payload === 'object' ? JSON.stringify(sse.data.payload) : String(sse.data.payload || ''),
        severity: 'WARNING',
        status: 'WARNING',
      };
      setStockAlerts((prev) => [newNotif, ...prev]);
      setCriticalCount((c) => c + 1);
    }
  }, [sse.data]);

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

  const handleAlertItemClick = (alert: AlertItem) => {
    setShowNotifications(false);
    const sku = alert.item_id || alert.id;
    navigate(sku ? `/replenishment?search=${encodeURIComponent(sku)}` : '/replenishment');
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
            className="topbar-bell-btn" 
            onClick={() => setShowNotifications(!showNotifications)}
            aria-label={t('topbar.notifications', 'Notifications')}
          >
            <Bell size={16} />
            {criticalCount > 0 && (
              <span className="topbar-bell-badge">
                {criticalCount > 99 ? '99+' : criticalCount}
              </span>
            )}
          </button>
          
          {showNotifications && (
            <div className="topbar-notifications-dropdown">
              <div className="notifications-header">
                <div className="notifications-header-left">
                  <h3>{t('topbar.stock_alerts', 'Stock Alerts')}</h3>
                  {criticalCount > 0 && (
                    <span className="notif-count-pill">{criticalCount} critical</span>
                  )}
                </div>
                <button
                  type="button"
                  className="notif-mark-read-btn"
                  onClick={() => {
                    setStockAlerts([]);
                    setCriticalCount(0);
                  }}
                >
                  {t('topbar.mark_all_read', 'Mark all read')}
                </button>
              </div>

              <div className="notifications-list">
                {stockAlerts.length === 0 && (
                  <div className="notification-empty">
                    <p>{t('topbar.no_alerts', 'No SKU is currently below reorder point.')}</p>
                    <span>{t('topbar.updated_now', 'Updated now')}</span>
                  </div>
                )}

                {stockAlerts.slice(0, 7).map((alert, idx) => {
                  const itemId = alert.item_id || alert.id;
                  const storeId = alert.store_id || alert.store || 'All';
                  const onHand = alert.on_hand ?? alert.stock ?? 0;
                  const rop = alert.reorder_point ?? alert.rop ?? 0;
                  const isCritical = alert.severity === 'CRITICAL' || onHand <= 0;

                  return (
                    <div 
                      className="notification-item" 
                      key={itemId ? `${itemId}-${storeId}-${idx}` : `event-${idx}`}
                      onClick={() => handleAlertItemClick(alert)}
                    >
                      <div className="notif-icon-col">
                        {isCritical ? (
                          <AlertCircle size={15} className="notif-icon-svg critical" />
                        ) : (
                          <AlertTriangle size={15} className="notif-icon-svg warning" />
                        )}
                      </div>
                      <div className="notif-content">
                        {alert.details ? (
                          <>
                            <p className="notif-title"><strong>{alert.name}</strong></p>
                            <p className="notif-detail">{alert.details}</p>
                            <span className="notif-meta">Realtime SSE &bull; {t('topbar.updated_now', 'Updated now')}</span>
                          </>
                        ) : (
                          <>
                            <div className="notif-title-row">
                              <span className="notif-sku">{itemId}</span>
                              <span className="notif-store-tag">{storeId}</span>
                              <span className={`notif-sev-badge ${isCritical ? 'critical' : 'warning'}`}>
                                {isCritical ? 'CRITICAL' : 'WARNING'}
                              </span>
                            </div>
                            <p className="notif-metrics">
                              On-Hand: <strong>{onHand}</strong> &middot; ROP: <strong>{rop}</strong>
                            </p>
                            <span className="notif-meta">{alert.name ? `${alert.name} &bull; ` : ''}{t('topbar.updated_now', 'Updated now')}</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="notifications-footer">
                <button
                  type="button"
                  className="notif-footer-link"
                  onClick={() => {
                    setShowNotifications(false);
                    navigate('/replenishment');
                  }}
                >
                  <span>{t('topbar.view_all_replenishment', 'View all in Replenishment')}</span>
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
