import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Bell, Calendar, X, Loader2 } from 'lucide-react';
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
  const config = getPageConfig(location.pathname);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [history, setHistory] = useState<string[]>(['Nike Ultra Boost', 'SKU-4402']);
  const [showNotifications, setShowNotifications] = useState(false);
  
  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Simulate search logic based on context
  useEffect(() => {
    if (!searchTerm.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setShowDropdown(true);

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

  const handleClear = () => {
    setSearchTerm('');
    setResults([]);
    setShowDropdown(false);
  };
  
  const handleSelectHistory = (term: string) => {
    setSearchTerm(term);
    setShowDropdown(true);
  };

  return (
    <header className="topbar">
      <h1 className="topbar-page-title">{config.title}</h1>
      
      <div className="topbar-actions-right">
        <div className="topbar-search-container" ref={searchRef}>
          <div className="search-input-wrapper">
            <Search size={14} className="search-icon" />
            <input 
              type="text" 
              placeholder={config.placeholder}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              className="topbar-search-input"
            />
            {isSearching && <Loader2 size={14} className="search-loader animate-spin" />}
            {!isSearching && searchTerm && (
              <button className="search-clear-btn" onClick={handleClear}>
                <X size={14} />
              </button>
            )}
          </div>
          
          {/* Autocomplete Dropdown */}
          {showDropdown && (
            <div className="search-dropdown-menu">
              {!searchTerm && history.length > 0 && (
                <div className="search-section">
                  <div className="search-section-title">Recent Searches</div>
                  {history.map((h, i) => (
                    <div key={i} className="search-history-item" onClick={() => handleSelectHistory(h)}>
                      <Search size={12} className="history-icon" />
                      <span>{h}</span>
                    </div>
                  ))}
                </div>
              )}
              
              {searchTerm && !isSearching && results.length === 0 && (
                <div className="search-no-results">
                  <p>No results found for "{searchTerm}"</p>
                  <span className="search-hint">Try searching for a different SKU, category, or check your spelling.</span>
                </div>
              )}
              
              {searchTerm && !isSearching && results.length > 0 && (
                <div className="search-section">
                  <div className="search-section-title">Suggested Results</div>
                  {results.slice(0, 5).map((res, idx) => (
                    <div key={idx} className="search-result-item" onClick={() => {
                      setSearchTerm(res.name || res.title);
                      if (!history.includes(res.name || res.title)) {
                        setHistory([res.name || res.title, ...history].slice(0, 5));
                      }
                      setShowDropdown(false);
                    }}>
                      {res.id && <span className="result-id">{res.id}</span>}
                      <span className="result-name">{res.name || res.title}</span>
                      {res.category && <span className="result-meta">{res.category}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

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
