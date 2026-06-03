import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, User, Folder, Wrench, FileText, File, Users, HelpCircle, Loader2 } from 'lucide-react';
import api from '../../services/api';

const TYPE_ICONS = {
  contact: User,
  project: Folder,
  job: Wrench,
  quote: FileText,
  invoice: FileText,
  document: File,
  team: Users,
  rfi: HelpCircle,
};

const TYPE_COLORS = {
  contact: 'bg-blue-100 text-blue-700',
  project: 'bg-purple-100 text-purple-700',
  job: 'bg-orange-100 text-orange-700',
  quote: 'bg-green-100 text-green-700',
  invoice: 'bg-yellow-100 text-yellow-700',
  document: 'bg-gray-100 text-gray-700',
  team: 'bg-pink-100 text-pink-700',
  rfi: 'bg-red-100 text-red-700',
};

export default function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [recentItems, setRecentItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Keyboard shortcut to open (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      loadRecentItems();
    }
  }, [isOpen]);

  // Search on query change
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await api.get(`/search?q=${encodeURIComponent(query)}`);
        setResults(response.results || []);
        setSelectedIndex(0);
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  const loadRecentItems = async () => {
    try {
      const items = await api.get('/search/recent');
      setRecentItems(items || []);
    } catch (error) {
      console.error('Failed to load recent items:', error);
    }
  };

  const handleSelect = useCallback((item) => {
    setIsOpen(false);
    setQuery('');
    navigate(item.url);
  }, [navigate]);

  // Keyboard navigation
  const handleKeyDown = (e) => {
    const items = query.length >= 2 ? results : recentItems;
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (items[selectedIndex]) {
          handleSelect(items[selectedIndex]);
        }
        break;
    }
  };

  const displayItems = query.length >= 2 ? results : recentItems;

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
      >
        <Search className="w-4 h-4" />
        <span className="hidden sm:inline">Search...</span>
        <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-white rounded border border-gray-300">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={() => setIsOpen(false)}
      />
      
      {/* Modal */}
      <div className="relative min-h-screen flex items-start justify-center pt-[15vh] px-4">
        <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="flex items-center px-4 border-b border-gray-200">
            <Search className="w-5 h-5 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search contacts, projects, jobs, invoices..."
              className="flex-1 px-3 py-4 text-lg outline-none placeholder:text-gray-400"
            />
            {loading && <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />}
            {query && !loading && (
              <button onClick={() => setQuery('')} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </div>

          {/* Results */}
          <div className="max-h-96 overflow-y-auto">
            {displayItems.length === 0 && query.length >= 2 && !loading && (
              <div className="px-4 py-8 text-center text-gray-500">
                No results for "{query}"
              </div>
            )}

            {displayItems.length === 0 && query.length < 2 && recentItems.length === 0 && (
              <div className="px-4 py-8 text-center text-gray-500">
                Start typing to search...
              </div>
            )}

            {displayItems.length > 0 && (
              <div className="py-2">
                {query.length < 2 && recentItems.length > 0 && (
                  <div className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Recent
                  </div>
                )}
                
                {displayItems.map((item, index) => {
                  const Icon = TYPE_ICONS[item.type] || File;
                  const colorClass = TYPE_COLORS[item.type] || 'bg-gray-100 text-gray-700';
                  
                  return (
                    <button
                      key={`${item.type}-${item.id}`}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                        index === selectedIndex ? 'bg-orange-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className={`p-2 rounded-lg ${colorClass}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate">
                          {item.name}
                        </div>
                        {item.description && (
                          <div className="text-sm text-gray-500 truncate">
                            {item.description}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 capitalize">
                        {item.type}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-white rounded border">↑</kbd>
                <kbd className="px-1.5 py-0.5 bg-white rounded border">↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-white rounded border">↵</kbd>
                select
              </span>
            </div>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white rounded border">esc</kbd>
              close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
