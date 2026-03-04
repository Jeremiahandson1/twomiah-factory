import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { services } from '../data/services';

function CommandPalette({ isOpen, onClose, onToggleDarkMode }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Build searchable items
  const allItems = useMemo(() => {
    const items = [
      // Navigation
      { type: 'nav', label: 'Dashboard', icon: '📊', action: () => navigate('/admin') },
      { type: 'nav', label: 'All Pages', icon: '📄', action: () => navigate('/pages') },
      { type: 'nav', label: 'Media Library', icon: '🖼️', action: () => navigate('/media') },
      { type: 'nav', label: 'Form Submissions / Leads', icon: '💬', action: () => navigate('/leads') },
      { type: 'nav', label: 'Site Settings', icon: '⚙️', action: () => navigate('/site-settings') },
      { type: 'nav', label: 'Redirects', icon: '↪️', action: () => navigate('/redirects') },
      { type: 'nav', label: 'Account Settings', icon: '🔐', action: () => navigate('/settings') },
      { type: 'nav', label: 'Trash / Recycle Bin', icon: '🗑️', action: () => navigate('/trash') },
      { type: 'nav', label: 'Activity Log', icon: '📈', action: () => navigate('/activity') },
      { type: 'nav', label: 'View Live Site', icon: '🌐', action: () => window.open('/', '_blank') },
      
      // Pages
      { type: 'page', label: 'Edit Home Page', icon: '🏠', action: () => navigate('/edit/home') },
    ];

    // Add all service pages
    services.forEach(service => {
      items.push({
        type: 'page',
        label: `Edit ${service.title}`,
        icon: '📝',
        action: () => navigate(`/edit/${service.id}`)
      });

      // Add sub-services
      if (service.subServices) {
        service.subServices.forEach(sub => {
          items.push({
            type: 'page',
            label: `Edit ${sub.title}`,
            subtitle: service.title,
            icon: '📝',
            action: () => navigate(`/edit/${encodeURIComponent(`${service.id}/${sub.id}`)}`)
          });
        });
      }
    });

    // Actions
    items.push(
      { type: 'action', label: 'Toggle Dark Mode', icon: '🌙', action: onToggleDarkMode },
      { type: 'action', label: 'Logout', icon: '🚪', action: () => { localStorage.removeItem('adminToken'); window.location.href = '/admin/login'; } }
    );

    return items;
  }, [navigate, onToggleDarkMode]);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems.slice(0, 8);
    
    const q = query.toLowerCase();
    return allItems.filter(item => 
      item.label.toLowerCase().includes(q) ||
      (item.subtitle && item.subtitle.toLowerCase().includes(q))
    ).slice(0, 8);
  }, [query, allItems]);

  // Reset selection when filtered items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setQuery('');
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(i => Math.min(i + 1, filteredItems.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(i => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredItems[selectedIndex]) {
            filteredItems[selectedIndex].action();
            onClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div className="command-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <div className="command-input-wrap">
          <svg className="command-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="M21 21l-4.35-4.35"></path>
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="command-input"
            placeholder="Search pages, actions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="command-kbd">ESC</kbd>
        </div>
        
        <div className="command-results">
          {filteredItems.length === 0 ? (
            <div className="command-empty">No results found</div>
          ) : (
            filteredItems.map((item, index) => (
              <button
                key={`${item.label}-${index}`}
                className={`command-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => {
                  item.action();
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="command-item-icon">{item.icon}</span>
                <div className="command-item-content">
                  <span className="command-item-label">{item.label}</span>
                  {item.subtitle && <span className="command-item-subtitle">{item.subtitle}</span>}
                </div>
                <span className="command-item-type">{item.type}</span>
              </button>
            ))
          )}
        </div>
        
        <div className="command-footer">
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Select</span>
          <span><kbd>esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
