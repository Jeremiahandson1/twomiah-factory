import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  Menu, X, Home, Users, FolderKanban, Briefcase, FileText, Receipt, 
  Calendar, Clock, DollarSign, FileQuestion, ClipboardList, CheckSquare,
  BookOpen, ClipboardCheck, Target, Settings, ChevronDown, ChevronUp
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const navGroups = [
  {
    label: 'Main',
    items: [
      { to: '/', icon: Home, label: 'Dashboard', exact: true },
      { to: '/contacts', icon: Users, label: 'Contacts' },
      { to: '/projects', icon: FolderKanban, label: 'Projects' },
      { to: '/jobs', icon: Briefcase, label: 'Jobs' },
    ],
  },
  {
    label: 'Financial',
    items: [
      { to: '/quotes', icon: FileText, label: 'Quotes' },
      { to: '/invoices', icon: Receipt, label: 'Invoices' },
      { to: '/expenses', icon: DollarSign, label: 'Expenses' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/schedule', icon: Calendar, label: 'Schedule' },
      { to: '/time', icon: Clock, label: 'Time Tracking' },
      { to: '/rfis', icon: FileQuestion, label: 'RFIs' },
      { to: '/change-orders', icon: ClipboardList, label: 'Change Orders' },
    ],
  },
  {
    label: 'Quality',
    items: [
      { to: '/punch-lists', icon: CheckSquare, label: 'Punch Lists' },
      { to: '/daily-logs', icon: BookOpen, label: 'Daily Logs' },
      { to: '/inspections', icon: ClipboardCheck, label: 'Inspections' },
      { to: '/bids', icon: Target, label: 'Bids' },
    ],
  },
];

export default function MobileNav() {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(['Main']);
  const location = useLocation();
  const { company } = useAuth();

  // Close menu on route change
  useEffect(() => {
    setIsOpen(false);
  }, [location]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const toggleGroup = (label) => {
    setExpandedGroups(prev => 
      prev.includes(label) 
        ? prev.filter(g => g !== label)
        : [...prev, label]
    );
  };

  return (
    <>
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b h-14 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsOpen(true)}
            className="p-2 -ml-2 hover:bg-gray-100 rounded-lg"
            aria-label="Open menu"
            aria-expanded={isOpen}
          >
            <Menu className="w-6 h-6" />
          </button>
          <span className="font-bold text-gray-900 truncate">
            {company?.name || '{{COMPANY_NAME}}'}
          </span>
        </div>
      </header>

      {/* Overlay */}
      {isOpen && (
        <div 
          className="lg:hidden fixed inset-0 z-50 bg-black/50 animate-fade-in"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Slide-out Menu */}
      <nav
        className={`
          lg:hidden fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-xl
          transform transition-transform duration-300 ease-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        aria-label="Mobile navigation"
      >
        {/* Menu Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b">
          <span className="font-bold text-gray-900">{company?.name || '{{COMPANY_NAME}}'}</span>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 -mr-2 hover:bg-gray-100 rounded-lg"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Menu Content */}
        <div className="overflow-y-auto h-[calc(100%-3.5rem)] py-4">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-2">
              <button
                onClick={() => toggleGroup(group.label)}
                className="w-full px-4 py-2 flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-gray-50"
              >
                {group.label}
                {expandedGroups.includes(group.label) ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              
              {expandedGroups.includes(group.label) && (
                <div className="mt-1 space-y-1 px-2">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.exact}
                      className={({ isActive }) => `
                        flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                        transition-colors touch-manipulation
                        ${isActive 
                          ? 'bg-orange-50 text-orange-600' 
                          : 'text-gray-700 hover:bg-gray-100 active:bg-gray-200'
                        }
                      `}
                    >
                      <item.icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                      <span>{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Settings */}
          <div className="mt-4 pt-4 border-t px-2">
            <NavLink
              to="/settings"
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                ${isActive ? 'bg-orange-50 text-orange-600' : 'text-gray-700 hover:bg-gray-100'}
              `}
            >
              <Settings className="w-5 h-5" aria-hidden="true" />
              <span>Settings</span>
            </NavLink>
          </div>
        </div>
      </nav>
    </>
  );
}
