import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase, Globe, Palette, Users, FileText,
  DollarSign, ArrowRight, ExternalLink, Settings,
  Clock, LogOut, Camera, Sparkles
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function CustomerPortal() {
  const { user, company, logout, loading: authLoading, checkAuth, hasFeature } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [activity, setActivity] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [configReady, setConfigReady] = useState(false);

  // Ensure company config (including settings) is fully loaded before rendering cards.
  // After login the response may not include settings — refetch via /me if needed.
  useEffect(() => {
    if (authLoading) return;
    if (company && company.settings !== undefined) {
      setConfigReady(true);
    } else if (company) {
      checkAuth().finally(() => setConfigReady(true));
    } else {
      setConfigReady(true); // no company = not logged in, let page render
    }
  }, [authLoading, company]);

  useEffect(() => {
    if (!authLoading) fetchDashboardData();
  }, [authLoading]);

  async function fetchDashboardData() {
    try {
      const token = localStorage.getItem('accessToken');
      const headers = { 'Authorization': `Bearer ${token}` };
      const [statsRes, activityRes] = await Promise.all([
        fetch(`${API_URL}/api/dashboard/stats`, { headers }).catch(() => null),
        fetch(`${API_URL}/api/dashboard/recent-activity`, { headers }).catch(() => null),
      ]);
      if (statsRes?.ok) setStats(await statsRes.json());
      if (activityRes?.ok) setActivity(await activityRes.json());
    } catch (err) {
      // Stats may not be available yet
    } finally {
      setLoading(false);
    }
  }

  // Show loading spinner while auth or company config is resolving to prevent race condition
  if (authLoading || !configReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600" />
      </div>
    );
  }

  const primaryColor = company?.primaryColor || '{{PRIMARY_COLOR}}';
  const companyName = company?.name || import.meta.env.VITE_COMPANY_NAME || 'My Company';

  // Determine which products are available based on company settings
  let settings: Record<string, any> = {};
  try {
    settings = typeof company?.settings === 'string'
      ? JSON.parse(company.settings)
      : (company?.settings || {});
  } catch {
    // Invalid JSON in settings, use defaults
  }
  
  const products = settings.products || ['crm']; // default: CRM always available
  const siteUrl = settings.siteUrl || null;
  const cmsUrl = settings.cmsUrl || null;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              {company?.logo ? (
                <img src={company.logo} alt="" className="h-8 w-8 object-contain" />
              ) : (
                <div 
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                  style={{ backgroundColor: primaryColor }}
                >
                  {companyName.charAt(0)}
                </div>
              )}
              <h1 className="text-lg font-bold text-slate-900">{companyName}</h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-500">
                {user?.firstName} {user?.lastName}
              </span>
              <button
                onClick={handleLogout}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-slate-900">
            Welcome back{user?.firstName ? `, ${user.firstName}` : ''}
          </h2>
          <p className="text-slate-500 mt-1">Manage your business from one place</p>
        </div>

        {/* Quick Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Contacts', value: stats.contacts ?? 0, icon: Users, color: 'blue' },
              { label: 'Open Jobs', value: stats.jobs?.today ?? 0, icon: Briefcase, color: 'emerald' },
              { label: 'Pending Quotes', value: stats.quotes?.pending ?? 0, icon: FileText, color: 'amber' },
              { label: 'Outstanding', value: `$${(stats.invoices?.outstandingValue ?? 0).toLocaleString()}`, icon: DollarSign, color: 'green' },
            ].map((stat) => (
              <div key={stat.label} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className={`w-8 h-8 rounded-lg bg-${stat.color}-50 flex items-center justify-center mb-2`}>
                  <stat.icon className={`w-4 h-4 text-${stat.color}-500`} />
                </div>
                <p className="text-xl font-bold text-slate-900">{loading ? '—' : stat.value}</p>
                <p className="text-xs text-slate-500">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Product Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* CRM - always available */}
          <div
            onClick={() => navigate('/crm')}
            className="bg-white rounded-xl border border-slate-200 p-6 cursor-pointer hover:border-slate-300 hover:shadow-md transition-all group relative overflow-hidden"
          >
            <div 
              className="absolute top-0 left-0 right-0 h-1"
              style={{ backgroundColor: primaryColor }}
            />
            <div className="flex items-start justify-between mb-4">
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${primaryColor}15` }}
              >
                <Briefcase className="w-6 h-6" style={{ color: primaryColor }} />
              </div>
              <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-1 transition-all" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">Business CRM</h3>
            <p className="text-sm text-slate-500">
              Contacts, jobs, quotes, invoices, scheduling, and more
            </p>
          </div>

          {/* Website - if website product was included */}
          {(products.includes('website') || siteUrl) && (
            <a
              href={siteUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-xl border border-slate-200 p-6 cursor-pointer hover:border-slate-300 hover:shadow-md transition-all group relative overflow-hidden block"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <Globe className="w-6 h-6 text-emerald-600" />
                </div>
                <ExternalLink className="w-5 h-5 text-slate-300 group-hover:text-slate-500 transition-all" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Live Website</h3>
              <p className="text-sm text-slate-500">
                View your public-facing website
              </p>
            </a>
          )}

          {/* CMS - if cms product was included */}
          {(products.includes('cms') || cmsUrl) && (
            <a
              href={cmsUrl || (siteUrl ? `${siteUrl}/admin` : '#')}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-xl border border-slate-200 p-6 cursor-pointer hover:border-slate-300 hover:shadow-md transition-all group relative overflow-hidden block"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-purple-500" />
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center">
                  <Palette className="w-6 h-6 text-purple-600" />
                </div>
                <ExternalLink className="w-5 h-5 text-slate-300 group-hover:text-slate-500 transition-all" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Website Manager</h3>
              <p className="text-sm text-slate-500">
                Edit pages, services, gallery, and content
              </p>
            </a>
          )}

          {/* Visualizer Promo — show if they don't have the feature yet */}
          {!hasFeature('visualizer') && (
            <div
              onClick={() => navigate('/crm/visualizer-trial')}
              className="bg-white rounded-xl border border-violet-200 border-dashed p-6 cursor-pointer hover:border-violet-300 hover:shadow-md transition-all group relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 to-purple-500" />
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center">
                  <Camera className="w-6 h-6 text-violet-600" />
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-bold bg-violet-100 text-violet-700 px-2 py-1 rounded-full">
                  <Sparkles className="w-3 h-3" />
                  FREE TRIAL
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Exterior Visualizer</h3>
              <p className="text-sm text-slate-500">
                Show customers what their home will look like — AI-powered exterior renderings
              </p>
            </div>
          )}

          {/* Settings */}
          <div
            onClick={() => navigate('/crm/settings')}
            className="bg-white rounded-xl border border-slate-200 p-6 cursor-pointer hover:border-slate-300 hover:shadow-md transition-all group relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-slate-400" />
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
                <Settings className="w-6 h-6 text-slate-600" />
              </div>
              <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-1 transition-all" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">Account Settings</h3>
            <p className="text-sm text-slate-500">
              Company info, users, integrations, billing
            </p>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900">Recent Activity</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {(activity?.recentJobs?.length > 0 || activity?.recentQuotes?.length > 0 || activity?.recentInvoices?.length > 0) ? (
              <>
                {(activity.recentJobs || []).slice(0, 3).map((item: any) => (
                  <div key={item.id} className="px-6 py-3 flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-400" />
                    <span className="text-sm text-slate-700">Job: {item.title || item.number} — {item.status?.replace('_', ' ') || 'pending'}</span>
                    <span className="text-xs text-slate-400 ml-auto">
                      {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : ''}
                    </span>
                  </div>
                ))}
                {(activity.recentQuotes || []).slice(0, 2).map((item: any) => (
                  <div key={item.id} className="px-6 py-3 flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-sm text-slate-700">Quote: {item.name || item.number} — ${Number(item.total || 0).toLocaleString()}</span>
                    <span className="text-xs text-slate-400 ml-auto">
                      {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : ''}
                    </span>
                  </div>
                ))}
              </>
            ) : (
              <div className="px-6 py-8 text-center">
                <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No recent activity</p>
                <p className="text-xs text-slate-400 mt-1">Get started by adding contacts and jobs</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-slate-400">
            Powered by <span className="font-medium">{{COMPANY_NAME}}</span>
          </p>
        </div>
      </main>
    </div>
  );
}
