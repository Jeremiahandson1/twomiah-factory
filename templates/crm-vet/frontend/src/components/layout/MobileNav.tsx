import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Menu, X, Home, Users, Receipt, Calendar, Settings, ChevronDown, ChevronUp,
  PawPrint, BellRing, HeartPulse, FolderOpen, MessageSquare, BarChart3, Megaphone
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface NavGroupItem {
  to: string;
  icon: LucideIcon;
  label: string;
  exact?: boolean;
}

interface NavGroup {
  label: string;
  items: NavGroupItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Clinical',
    items: [
      { to: '/crm', icon: Home, label: 'Dashboard', exact: true },
      { to: '/crm/patients', icon: PawPrint, label: 'Patients' },
      { to: '/crm/appointments', icon: Calendar, label: 'Appointments' },
      { to: '/crm/reminders', icon: BellRing, label: 'Reminders' },
      { to: '/crm/wellness-plans', icon: HeartPulse, label: 'Wellness Plans' },
    ],
  },
  {
    label: 'Front Desk',
    items: [
      { to: '/crm/contacts', icon: Users, label: 'Owners' },
      { to: '/crm/invoices', icon: Receipt, label: 'Invoices' },
      { to: '/crm/documents', icon: FolderOpen, label: 'Documents' },
      { to: '/crm/messages', icon: MessageSquare, label: 'Messages' },
    ],
  },
  {
    label: 'Business',
    items: [
      { to: '/crm/reports', icon: BarChart3, label: 'Reports' },
      { to: '/crm/marketing', icon: Megaphone, label: 'Marketing' },
      { to: '/crm/team', icon: Users, label: 'Team' },
      { to: '/crm/settings', icon: Settings, label: 'Settings' },
    ],
  },
];

export default function MobileNav() {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['Main']);
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

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev: string[]) =>
      prev.includes(label)
        ? prev.filter((g: string) => g !== label)
        : [...prev, label]
    );
  };

  return (
    <>
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b h-14 px-4 flex items-center justify-between dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsOpen(true)}
            className="p-2 -ml-2 hover:bg-gray-100 rounded-lg"
            aria-label="Open menu"
            aria-expanded={isOpen}
          >
            <Menu className="w-6 h-6" />
          </button>
          <span className="font-bold text-gray-900 truncate dark:text-slate-100">
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
          <span className="font-bold text-gray-900 dark:text-slate-100">{company?.name || '{{COMPANY_NAME}}'}</span>
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
          {navGroups.map((group: NavGroup) => (
            <div key={group.label} className="mb-2">
              <button
                onClick={() => toggleGroup(group.label)}
                className="w-full px-4 py-2 flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-gray-50 dark:text-slate-400"
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
                  {group.items.map((item: NavGroupItem) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.exact}
                      className={({ isActive }: { isActive: boolean }) => `
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
              to="/crm/settings"
              className={({ isActive }: { isActive: boolean }) => `
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
