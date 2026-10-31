import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, Calendar, X, Loader2, ArrowRight, Menu } from 'lucide-react';
import { api } from '../../services/api.ts';
import { useSSE } from '../../hooks/useSSE.ts';
import { useLanguage } from '../../context/LanguageContext.tsx';
import { LanguageToggle } from '../common/LanguageToggle.tsx';
import './Topbar.css';

interface TopbarProps {
  onToggleMobileSidebar?: () => void;
}

const getPageConfig = (pathname: string, t: (k: string, fb?: string) => string) => {
  switch (pathname) {
    case '/': return { title: t('dashboard.hero_title', 'Inventory Optimization Cockpit'), placeholder: t('topbar.search_placeholder', 'Search products, locations...'), context: 'dashboard' };
    case '/forecast-explorer': return { title: t('forecast.title', 'Forecast Explorer & Overrides'), placeholder: t('topbar.search_placeholder', 'Search SKUs for forecast data...'), context: 'forecast' };
    case '/replenishment': return { title: t('replenishment.title', 'Replenishment & Order Management'), placeholder: t('topbar.search_placeholder', 'Search orders, suppliers...'), context: 'replenishment' };
    case '/abc-xyz': return { title: t('abcxyz.title', 'ABC/XYZ Inventory Analysis Matrix'), placeholder: t('topbar.search_placeholder', 'Search SKUs to see classification...'), context: 'abcxyz' };
    case '/model-performance': return { title: t('modelPerformance.title', 'Model Performance & Diagnostics'), placeholder: t('topbar.search_placeholder', 'Search models, metrics...'), context: 'models' };
    case '/reports': return { title: t('reports.title', 'Reports & Analytics'), placeholder: t('topbar.search_placeholder', 'Search report templates...'), context: 'reports' };
    case '/products': return { title: t('products.title', 'Product Catalog'), placeholder: t('topbar.search_placeholder', 'Search product names or SKUs...'), context: 'products' };
    case '/settings': return { title: t('settings.title', 'System Settings'), placeholder: t('topbar.search_placeholder', 'Search settings, parameters...'), context: 'settings' };
    default: return { title: 'DFIOS', placeholder: t('topbar.search_placeholder', 'Search...'), context: 'general' };
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
  const [stockAlerts, setStockAlerts] = useState<any[]>([]);
  
  const notifRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    api.inventory.getReplenishmentAlerts()
      .then((result) => setStockAlerts(result.alerts || []))
      .catch(() => setStockAlerts([]));
  }, []);

  const sse = useSSE('/events');
  useEffect(() => {
    if (sse.data && sse.data.type !== 'connected' && sse.data.type !== 'close') {
      const newNotif = {
        name: `[Event: ${sse.data.type}]`,
        details: typeof sse.data.payload === 'object' ? JSON.stringify(sse.data.payload) : String(sse.data.payload || ''),
        status: 'WARNING',
        statusClass: 'warning',
      };
      setStockAlerts((prev) => [newNotif, ...prev]);
    }
  }, [sse.data]);

  // Keyboard shortcut for command palette
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

  // Real search logic querying backend
  useEffect(() => {
    if (!searchTerm.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    const delay = setTimeout(async () => {
      try {
        const term = searchTerm.toLowerCase();
        const res = await api.products.getProducts({ search: term, limit: 10 });
        const found = (res.list || []).map((p: any) => ({
          id: p.item_id,
          name: p.name,
          category: p.cat_id || p.dept_id || 'Product',
        }));
        setResults(found);
      } catch (err) {
        console.error('Search failed', err);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(delay);
  }, [searchTerm, config.context]);

  const handleSelectHistory = (term: string) => {
    setSearchTerm(term);
  };

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
            <Menu size={20} />
          </button>
        )}
        <h1 className="topbar-page-title">{config.title}</h1>
      </div>
      
      <div className="topbar-actions-right">
        {/* Search trigger button opening Command Palette */}
        <div 
          className="topbar-search-trigger" 
          onClick={() => setIsCommandPaletteOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsCommandPaletteOpen(true); }}
          aria-label={t('topbar.search_placeholder', 'Search products, locations, SKUs')}
        >
          <Search size={14} className="search-icon-svg" />
          <span className="search-placeholder">{t('topbar.search', 'Search...')}</span>
          <kbd className="search-kbd">⌘K</kbd>
        </div>

        {/* Nút chuyển đổi ngôn ngữ EN / VI ngay cạnh thanh tìm kiếm */}
        <LanguageToggle />

        {/* Command Palette Modal */}
        {isCommandPaletteOpen && createPortal(
          <div className="command-palette-overlay" onClick={() => setIsCommandPaletteOpen(false)}>
            <div className="command-palette-modal" onClick={e => e.stopPropagation()}>
              <div className="cp-header">
                <Search size={18} className="cp-icon" />
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
                  <span style={{ fontSize: '10px', fontWeight: 600 }}>{t('topbar.esc_to_close', 'ESC')}</span>
                </button>
              </div>
              
              <div className="cp-body">
                {isSearching && (
                  <div className="cp-loading">
                    <Loader2 size={16} className="animate-spin" style={{marginRight: '8px'}} /> {t('common.loading', 'Searching...')}
                  </div>
                )}
                
                {!searchTerm && history.length > 0 && (
                  <div className="cp-section">
                    <div className="cp-section-title">{t('topbar.recent_searches', 'Recent Searches')}</div>
                    {history.map((h, i) => (
                      <div key={i} className="cp-item" onClick={() => handleSelectHistory(h)}>
                        <ArrowRight size={14} className="cp-item-icon" />
                        <span>{h}</span>
                      </div>
                    ))}
                  </div>
                )}
                
                {!searchTerm && (
                  <>
                    <div className="cp-section">
                      <div className="cp-section-title">{t('topbar.navigation_section', 'Navigation')}</div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/'); }}><ArrowRight size={14} className="cp-item-icon" /><span>{t('nav.dashboard', 'Dashboard')}</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/forecast-explorer'); }}><ArrowRight size={14} className="cp-item-icon" /><span>{t('nav.forecast_explorer', 'Forecast Explorer')}</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/replenishment'); }}><ArrowRight size={14} className="cp-item-icon" /><span>{t('nav.replenishment', 'Replenishment')}</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/abc-xyz'); }}><ArrowRight size={14} className="cp-item-icon" /><span>{t('nav.abc_xyz', 'ABC/XYZ Analysis')}</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/model-performance'); }}><ArrowRight size={14} className="cp-item-icon" /><span>{t('nav.model_performance', 'Model Performance')}</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/reports'); }}><ArrowRight size={14} className="cp-item-icon" /><span>{t('nav.reports', 'Reports & Analytics')}</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/products'); }}><ArrowRight size={14} className="cp-item-icon" /><span>{t('nav.products', 'Products')}</span></div>
                    </div>
                    
                    <div className="cp-section">
                      <div className="cp-section-title">{t('topbar.settings_section', 'Settings & Administration')}</div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/settings'); }}><ArrowRight size={14} className="cp-item-icon" /><span>{t('settings.tab_profile', 'Profile & Account')}</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/settings'); }}><ArrowRight size={14} className="cp-item-icon" /><span>{t('settings.tab_config', 'System Configuration')}</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/settings'); }}><ArrowRight size={14} className="cp-item-icon" /><span>{t('settings.tab_users', 'User Management')}</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/settings'); }}><ArrowRight size={14} className="cp-item-icon" /><span>{t('settings.tab_audit', 'Audit Logs')}</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/settings'); }}><ArrowRight size={14} className="cp-item-icon" /><span>{t('settings.tab_pipeline', 'ML Pipeline & Quality')}</span></div>
                    </div>
                  </>
                )}
                
                {searchTerm && !isSearching && results.length === 0 && (
                  <div className="cp-no-results">
                    <p style={{ margin: 0, fontWeight: 500, color: '#334155' }}>{t('topbar.no_results_found', 'No results found for')} "{searchTerm}"</p>
                    <span className="cp-search-hint">{t('topbar.search_hint', 'Try searching for a different keyword, SKU, or check your spelling.')}</span>
                  </div>
                )}
                
                {searchTerm && !isSearching && results.length > 0 && (
                  <div className="cp-section">
                    <div className="cp-section-title">{t('topbar.suggested_results', 'Suggested Results')}</div>
                    {results.slice(0, 5).map((res, idx) => (
                      <div key={idx} className="cp-item" onClick={() => {
                        setSearchTerm(res.name || res.title);
                        if (!history.includes(res.name || res.title)) {
                          const updated = [res.name || res.title, ...history].slice(0, 5);
                          setHistory(updated);
                          try { localStorage.setItem('dfios_search_history', JSON.stringify(updated)); } catch {}
                        }
                        setIsCommandPaletteOpen(false);
                      }}>
                        <ArrowRight size={14} className="cp-item-icon" />
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

        <div className="notif-wrapper" ref={notifRef}>
          <button 
            type="button" 
            className="topbar-bell-btn" 
            onClick={() => setShowNotifications(!showNotifications)}
            aria-label={t('topbar.notifications', 'Notifications')}
          >
            <Bell size={16} />
            {stockAlerts.length > 0 && <span className="topbar-bell-badge">{stockAlerts.length}</span>}
          </button>
          
          {showNotifications && (
            <div className="topbar-notifications-dropdown">
              <div className="notifications-header">
                <h3>{t('topbar.stock_alerts', 'Stock Alerts')}</h3>
                <button
                  type="button"
                  onClick={() => setStockAlerts([])}
                  style={{ background: 'none', border: 'none', color: '#0d9488', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                >
                  {t('topbar.mark_all_read', 'Mark all read')}
                </button>
              </div>
              <div className="notifications-list">
                {stockAlerts.length === 0 && (
                  <div className="notification-item">
                    <div className="notif-dot teal"></div>
                    <div className="notif-content">
                      <p>{t('topbar.no_alerts', 'No SKU is currently below reorder point.')}</p>
                      <span>{t('topbar.updated_now', 'Updated now')}</span>
                    </div>
                  </div>
                )}
                {stockAlerts.slice(0, 5).map((alert, idx) => (
                  <div className="notification-item" key={alert.id ? `${alert.id}-${alert.store || idx}` : `event-${idx}`}>
                    <div className={`notif-dot ${alert.status === 'CRITICAL' ? 'red' : 'orange'}`}></div>
                    <div className="notif-content">
                      {alert.details ? (
                        <>
                          <p><strong>{alert.name}</strong>: {alert.details}</p>
                          <span>Realtime SSE &bull; {t('topbar.updated_now', 'Updated now')}</span>
                        </>
                      ) : (
                        <>
                          <p><strong>{alert.id} {alert.name}</strong> is below ROP ({alert.rop}). Current: {alert.stock} units</p>
                          <span>{alert.store || 'Store'} &bull; {t('topbar.updated_now', 'Updated now')}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="topbar-date-display">
          <Calendar size={14} />
          <span>
            {new Date().toLocaleDateString(language === 'vi' ? 'vi-VN' : 'en-US', { 
              month: 'short', 
              day: 'numeric', 
              year: 'numeric' 
            })}
          </span>
        </div>
      </div>
    </header>
  );
};
