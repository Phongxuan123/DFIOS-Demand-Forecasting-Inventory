import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, Calendar, X, Loader2, ArrowRight } from 'lucide-react';
import { mockProducts, mockReports, mockForecastExplorer } from '../../data/mockData.ts';
import './Topbar.css';

const getPageConfig = (pathname: string) => {
  switch (pathname) {
    case '/': return { title: 'Inventory Optimization Cockpit', placeholder: 'Search products, locations...', context: 'dashboard' };
    case '/forecast-explorer': return { title: 'Forecast Explorer & Overrides', placeholder: 'Search SKUs for forecast data...', context: 'forecast' };
    case '/replenishment': return { title: 'Replenishment & Order Management', placeholder: 'Search orders, suppliers...', context: 'replenishment' };
    case '/abc-xyz': return { title: 'ABC/XYZ Inventory Analysis Matrix', placeholder: 'Search SKUs to see classification...', context: 'abcxyz' };
    case '/model-performance': return { title: 'Model Performance & Diagnostics', placeholder: 'Search models, metrics...', context: 'models' };
    case '/reports': return { title: 'Reports & Analytics', placeholder: 'Search report templates...', context: 'reports' };
    case '/products': return { title: 'Product Catalog', placeholder: 'Search product names or SKUs...', context: 'products' };
    case '/settings': return { title: 'System Settings', placeholder: 'Search settings, parameters...', context: 'settings' };
    default: return { title: 'DFIOS', placeholder: 'Search...', context: 'general' };
  }
};

export const Topbar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const config = getPageConfig(location.pathname);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [history, setHistory] = useState<string[]>(['Nike Ultra Boost', 'SKU-4402']);
  const [showNotifications, setShowNotifications] = useState(false);
  
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

  // Simulate search logic based on context
  useEffect(() => {
    if (!searchTerm.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    const delay = setTimeout(() => {
      let found: any[] = [];
      const term = searchTerm.toLowerCase();
      
      // Contextual search logic
      if (config.context === 'products' || config.context === 'dashboard' || config.context === 'abcxyz') {
        found = mockProducts.list.filter(p => p.name.toLowerCase().includes(term) || p.id.toLowerCase().includes(term));
      } else if (config.context === 'reports') {
        found = mockReports.templates.filter(r => r.title.toLowerCase().includes(term) || r.desc.toLowerCase().includes(term));
      } else if (config.context === 'forecast') {
        found = mockForecastExplorer.skus.filter(s => s.name.toLowerCase().includes(term) || s.id.toLowerCase().includes(term));
      } else {
        // Generic fallback
        found = mockProducts.list.filter(p => p.name.toLowerCase().includes(term));
      }

      setResults(found);
      setIsSearching(false);
    }, 400); // 400ms loading simulation

    return () => clearTimeout(delay);
  }, [searchTerm, config.context]);


  const handleSelectHistory = (term: string) => {
    setSearchTerm(term);
  };

  return (
    <header className="topbar">
      <h1 className="topbar-page-title">{config.title}</h1>
      
      <div className="topbar-actions-right">
        <div className="topbar-search-trigger" onClick={() => setIsCommandPaletteOpen(true)}>
          <Search size={14} />
          <span className="search-placeholder">Search...</span>
        </div>

        {/* Command Palette Modal */}
        {isCommandPaletteOpen && createPortal(
          <div className="command-palette-overlay" onClick={() => setIsCommandPaletteOpen(false)}>
            <div className="command-palette-modal" onClick={e => e.stopPropagation()}>
              <div className="cp-header">
                <Search size={18} className="cp-icon" />
                <input 
                  type="text" 
                  placeholder={config.placeholder || "Type a command or search..."}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="cp-input"
                  autoFocus
                />
                {searchTerm && (
                  <button className="cp-clear-input-btn" onClick={() => setSearchTerm('')}>
                    <X size={14} />
                  </button>
                )}
                <button className="cp-close-btn" onClick={() => setIsCommandPaletteOpen(false)}>
                  <span style={{ fontSize: '10px', fontWeight: 600 }}>ESC</span>
                </button>
              </div>
              
              <div className="cp-body">
                {isSearching && (
                  <div className="cp-loading">
                    <Loader2 size={16} className="animate-spin" style={{marginRight: '8px'}} /> Searching...
                  </div>
                )}
                
                {!searchTerm && history.length > 0 && (
                  <div className="cp-section">
                    <div className="cp-section-title">Recent Searches</div>
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
                      <div className="cp-section-title">Navigation</div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/'); }}><ArrowRight size={14} className="cp-item-icon" /><span>Dashboard</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/forecast-explorer'); }}><ArrowRight size={14} className="cp-item-icon" /><span>Forecast Explorer</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/replenishment'); }}><ArrowRight size={14} className="cp-item-icon" /><span>Replenishment</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/abc-xyz'); }}><ArrowRight size={14} className="cp-item-icon" /><span>ABC/XYZ Analysis</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/model-performance'); }}><ArrowRight size={14} className="cp-item-icon" /><span>Model Performance</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/reports'); }}><ArrowRight size={14} className="cp-item-icon" /><span>Reports</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/products'); }}><ArrowRight size={14} className="cp-item-icon" /><span>Products</span></div>
                    </div>
                    
                    <div className="cp-section">
                      <div className="cp-section-title">Settings</div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/settings'); }}><ArrowRight size={14} className="cp-item-icon" /><span>Profile & Account</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/settings'); }}><ArrowRight size={14} className="cp-item-icon" /><span>System Configuration</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); navigate('/settings'); }}><ArrowRight size={14} className="cp-item-icon" /><span>Notifications</span></div>
                    </div>

                    <div className="cp-section">
                      <div className="cp-section-title">Theme</div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); }}><ArrowRight size={14} className="cp-item-icon" /><span>Light Mode</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); }}><ArrowRight size={14} className="cp-item-icon" /><span>Dark Mode</span></div>
                      <div className="cp-item" onClick={() => { setIsCommandPaletteOpen(false); }}><ArrowRight size={14} className="cp-item-icon" /><span>System Default</span></div>
                    </div>
                  </>
                )}
                
                {searchTerm && !isSearching && results.length === 0 && (
                  <div className="cp-no-results">
                    <p style={{ margin: 0, fontWeight: 500, color: '#334155' }}>No results found for "{searchTerm}"</p>
                    <span className="cp-search-hint">Try searching for a different keyword, SKU, or check your spelling.</span>
                  </div>
                )}
                
                {searchTerm && !isSearching && results.length > 0 && (
                  <div className="cp-section">
                    <div className="cp-section-title">Suggested Results</div>
                    {results.slice(0, 5).map((res, idx) => (
                      <div key={idx} className="cp-item" onClick={() => {
                        setSearchTerm(res.name || res.title);
                        if (!history.includes(res.name || res.title)) {
                          setHistory([res.name || res.title, ...history].slice(0, 5));
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
          <button className="topbar-bell-btn" onClick={() => setShowNotifications(!showNotifications)}>
            <Bell size={16} />
            <span className="topbar-bell-badge">3</span>
          </button>
          
          {showNotifications && (
            <div className="topbar-notifications-dropdown">
              <div className="notifications-header">
                <h3>Stock Alerts</h3>
                <a href="#">Mark all read</a>
              </div>
              <div className="notifications-list">
                <div className="notification-item">
                  <div className="notif-dot red"></div>
                  <div className="notif-content">
                    <p><strong>SKU-8921 Nike Ultra Boost</strong> dropped below ROP (20 units). Current: 8 units</p>
                    <span>2 min ago</span>
                  </div>
                </div>
                <div className="notification-item">
                  <div className="notif-dot red"></div>
                  <div className="notif-content">
                    <p><strong>SKU-4402 Nike Vapor</strong> inventory fell below safety stock (12 units). Current: 6 units</p>
                    <span>15 min ago</span>
                  </div>
                </div>
                <div className="notification-item">
                  <div className="notif-dot red"></div>
                  <div className="notif-content">
                    <p><strong>SKU-1024 Puma Classic</strong> stockout detected at Eastside Mall. Current: 0 units</p>
                    <span>1 hour ago</span>
                  </div>
                </div>
                <div className="notification-item">
                  <div className="notif-dot orange"></div>
                  <div className="notif-content">
                    <p><strong>SKU-7721 Adidas Samba</strong> demand spike detected. Recommended allocation +15%</p>
                    <span>2 hours ago</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="topbar-date-display">
          <Calendar size={14} />
          October 24, 2024
        </div>
      </div>
    </header>
  );
};
