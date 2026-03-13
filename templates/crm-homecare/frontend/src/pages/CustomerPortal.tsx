import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Heart, Globe, Palette, Settings,
  ArrowRight, ExternalLink, LogOut, Clock
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function CustomerPortal() {
  const { user, company, logout, loading: authLoading, checkAuth } = useAuth();
  const navigate = useNavigate();
  const [configReady, setConfigReady] = useState(false);

  // Ensure company config (including settings) is fully loaded before rendering cards.
  useEffect(() => {
    if (authLoading) return;
    if (company && company.settings !== undefined) {
      setConfigReady(true);
    } else if (company) {
      checkAuth().finally(() => setConfigReady(true));
    } else {
      setConfigReady(true);
    }
  }, [authLoading, company]);

  if (authLoading || !configReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600" />
      </div>
    );
  }

  const primaryColor = company?.primaryColor || '#10b981';
  const companyName = company?.name || import.meta.env.VITE_COMPANY_NAME || 'My Agency';

  let settings: Record<string, any> = {};
  try {
    settings = typeof company?.settings === 'string'
      ? JSON.parse(company.settings)
      : (company?.settings || {});
  } catch {
    // Invalid JSON in settings, use defaults
  }

  const products = settings.products || ['crm'];
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
          <p className="text-slate-500 mt-1">Manage your agency from one place</p>
        </div>

        {/* Product Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Home Care CRM - always available */}
          <div
            onClick={() => navigate('/crm')}
            className="bg-white rounded-2xl shadow p-6 cursor-pointer hover:shadow-md transition-all group relative overflow-hidden"
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
                <Heart className="w-6 h-6" style={{ color: primaryColor }} />
              </div>
              <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-1 transition-all" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">Home Care CRM</h3>
            <p className="text-sm text-slate-500">
              Clients, caregivers, scheduling, billing, and compliance
            </p>
          </div>

          {/* Website - if website product was included */}
          {(products.includes('website') || siteUrl) && (
            <a
              href={siteUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-2xl shadow p-6 cursor-pointer hover:shadow-md transition-all group relative overflow-hidden block"
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
              className="bg-white rounded-2xl shadow p-6 cursor-pointer hover:shadow-md transition-all group relative overflow-hidden block"
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

          {/* Settings */}
          <div
            onClick={() => navigate('/crm/settings')}
            className="bg-white rounded-2xl shadow p-6 cursor-pointer hover:shadow-md transition-all group relative overflow-hidden"
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
              Agency info, users, integrations, billing
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-slate-400">
            Powered by <span className="font-medium">Twomiah</span>
          </p>
        </div>
      </main>
    </div>
  );
}
