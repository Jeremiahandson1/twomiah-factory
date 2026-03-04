import React, { useState, useMemo } from 'react';
import { NavLink, Outlet, useParams, useNavigate } from 'react-router-dom';
import {
  Menu, X, ChevronDown, LogOut, Settings, Bell, Search, User,
  LayoutDashboard, Megaphone, Calculator, Calendar, Wrench, Building2,
  ShieldCheck, Gavel, Users, MessageSquare, CreditCard, PieChart,
  Sparkles, UserCog, Server, FileText, Home
} from 'lucide-react';
import clsx from 'clsx';
import { useBuilderStore } from '../../stores/builderStore';
import { FEATURE_CATEGORIES } from '../../data/features';

const iconMap = {
  Megaphone, Calculator, Calendar, Wrench, Building2, ShieldCheck,
  Gavel, Users, MessageSquare, CreditCard, PieChart, Sparkles,
  UserCog, Server, LayoutDashboard, FileText
};

// Map categories to their primary route
const categoryRoutes = {
  marketing: { path: 'marketing', icon: 'Megaphone', label: 'Marketing' },
  quoting: { path: 'quotes', icon: 'Calculator', label: 'Quotes' },
  scheduling: { path: 'scheduling', icon: 'Calendar', label: 'Schedule' },
  job_execution: { path: 'jobs', icon: 'Wrench', label: 'Jobs' },
  construction_pm: { path: 'projects', icon: 'Building2', label: 'Projects' },
  quality_safety: { path: 'quality', icon: 'ShieldCheck', label: 'Quality & Safety' },
  bidding: { path: 'bidding', icon: 'Gavel', label: 'Bidding' },
  crm: { path: 'contacts', icon: 'Users', label: 'Contacts' },
  communication: { path: 'communication', icon: 'MessageSquare', label: 'Messages' },
  invoicing: { path: 'invoicing', icon: 'CreditCard', label: 'Invoicing' },
  financial: { path: 'financials', icon: 'PieChart', label: 'Financials' },
  advanced: { path: 'advanced', icon: 'Sparkles', label: 'Advanced' },
  team: { path: 'team', icon: 'UserCog', label: 'Team' },
  platform: { path: 'settings', icon: 'Server', label: 'Platform' },
};

function Sidebar({ instance, isOpen, onClose }) {
  const navigate = useNavigate();
  const [expandedSection, setExpandedSection] = useState(null);

  // Determine which categories have enabled features
  const enabledCategories = useMemo(() => {
    const enabled = new Set(instance.enabledFeatures);
    return FEATURE_CATEGORIES.filter(cat => 
      cat.features.some(f => enabled.has(f.id))
    ).map(cat => ({
      ...cat,
      route: categoryRoutes[cat.id],
      enabledCount: cat.features.filter(f => enabled.has(f.id)).length
    }));
  }, [instance.enabledFeatures]);

  const primaryColor = instance.primaryColor || '#ec7619';

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        'fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 border-r border-slate-800 transform transition-transform duration-200 lg:translate-x-0 lg:static',
        isOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            {instance.companyLogo ? (
              <img src={instance.companyLogo} alt="" className="w-8 h-8 object-contain" />
            ) : (
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: primaryColor }}
              >
                {instance.companyName?.[0]?.toUpperCase() || 'C'}
              </div>
            )}
            <span className="font-semibold text-white truncate">
              {instance.companyName || 'My CRM'}
            </span>
          </div>
          <button onClick={onClose} className="lg:hidden p-1 hover:bg-slate-800 rounded">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-1 overflow-y-auto h-[calc(100vh-8rem)]">
          {/* Dashboard - always visible */}
          <NavLink
            to=""
            end
            className={({ isActive }) => clsx(
              'sidebar-link',
              isActive && 'active'
            )}
            style={({ isActive }) => isActive ? { 
              borderLeftColor: primaryColor,
              backgroundColor: `${primaryColor}15`,
              color: primaryColor 
            } : {}}
          >
            <LayoutDashboard className="w-5 h-5" />
            Dashboard
          </NavLink>

          {/* Dynamic navigation based on enabled features */}
          {enabledCategories.map((category) => {
            const Icon = iconMap[category.route?.icon] || FileText;
            const route = category.route;
            
            if (!route) return null;

            return (
              <NavLink
                key={category.id}
                to={route.path}
                className={({ isActive }) => clsx(
                  'sidebar-link',
                  isActive && 'active'
                )}
                style={({ isActive }) => isActive ? { 
                  borderLeftColor: primaryColor,
                  backgroundColor: `${primaryColor}15`,
                  color: primaryColor 
                } : {}}
              >
                <Icon className="w-5 h-5" />
                {route.label}
                <span className="ml-auto text-xs bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">
                  {category.enabledCount}
                </span>
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-slate-800">
          <button 
            onClick={() => navigate('/instances')}
            className="sidebar-link w-full justify-center text-slate-500 hover:text-white"
          >
            <Home className="w-4 h-4" />
            Back to Instances
          </button>
        </div>
      </aside>
    </>
  );
}

function Header({ instance, onMenuClick }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const primaryColor = instance.primaryColor || '#ec7619';

  return (
    <header className="h-16 bg-slate-900/80 backdrop-blur-sm border-b border-slate-800 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
      {/* Left */}
      <div className="flex items-center gap-4">
        <button 
          onClick={onMenuClick}
          className="lg:hidden p-2 hover:bg-slate-800 rounded-lg"
        >
          <Menu className="w-5 h-5 text-slate-400" />
        </button>

        {/* Search */}
        <div className="hidden sm:block relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search..."
            className="w-64 pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ '--tw-ring-color': primaryColor }}
          />
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <button className="sm:hidden p-2 hover:bg-slate-800 rounded-lg">
          <Search className="w-5 h-5 text-slate-400" />
        </button>
        
        <button className="relative p-2 hover:bg-slate-800 rounded-lg">
          <Bell className="w-5 h-5 text-slate-400" />
          <span 
            className="absolute top-1 right-1 w-2 h-2 rounded-full"
            style={{ backgroundColor: primaryColor }}
          />
        </button>
        
        <button className="p-2 hover:bg-slate-800 rounded-lg">
          <Settings className="w-5 h-5 text-slate-400" />
        </button>

        <div className="ml-2 flex items-center gap-3 pl-4 border-l border-slate-700">
          <div 
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
            style={{ backgroundColor: primaryColor }}
          >
            A
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-medium text-white">Admin</p>
            <p className="text-xs text-slate-500">admin@company.com</p>
          </div>
        </div>
      </div>
    </header>
  );
}

export function CRMLayout() {
  const { instanceId } = useParams();
  const navigate = useNavigate();
  const { instances, loadInstance, getCurrentInstance } = useBuilderStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Load instance on mount
  React.useEffect(() => {
    if (instanceId) {
      loadInstance(instanceId);
    }
  }, [instanceId, loadInstance]);

  const instance = instances.find(i => i.id === instanceId);

  if (!instance) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-white mb-2">CRM Not Found</h2>
          <p className="text-slate-400 mb-4">This CRM instance doesn't exist.</p>
          <button 
            onClick={() => navigate('/instances')}
            className="btn btn-primary"
          >
            View My CRMs
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex">
      <Sidebar 
        instance={instance} 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)} 
      />
      
      <div className="flex-1 flex flex-col min-w-0">
        <Header 
          instance={instance} 
          onMenuClick={() => setSidebarOpen(true)} 
        />
        
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet context={{ instance }} />
        </main>
      </div>
    </div>
  );
}
