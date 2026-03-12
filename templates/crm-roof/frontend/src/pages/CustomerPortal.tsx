import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase, Globe, Palette, Settings,
  Clock, LogOut, ArrowRight, ExternalLink,
  Camera, Sparkles, BookOpen, Ruler,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function CustomerPortal() {
  const { user, company, logout } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);

  const hasFeature = (id: string) => company?.enabledFeatures?.includes(id) ?? false;

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    try {
      const token = localStorage.getItem('token');
      const headers = { 'Authorization': `Bearer ${token}` };
      const res = await fetch(`${API_URL}/api/dashboard/stats`, { headers }).catch(() => null);
      if (res?.ok) setStats(await res.json());
    } catch {} finally {
      setLoading(false);
    }
  }

  const primaryColor = company?.settings?.primaryColor || '#2563eb';
  const companyName = company?.name || 'My Company';

  let settings: Record<string, any> = {};
  try {
    settings = typeof company?.settings === 'string'
      ? JSON.parse(company.settings)
      : (company?.settings || {});
  } catch {}

  const siteUrl = settings.siteUrl || null;
  const cmsUrl = settings.cmsUrl || null;
  const products = settings.products || ['crm'];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div
                className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: primaryColor }}
              >
                {companyName.charAt(0)}
              </div>
              <h1 className="text-lg font-bold text-slate-900">{companyName}</h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-500">{user?.email}</span>
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
            Welcome back{user?.email ? '' : ''}
          </h2>
          <p className="text-slate-500 mt-1">Manage your business from one place</p>
        </div>

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
            <h3 className="text-lg font-bold text-slate-900 mb-1">Roofing CRM</h3>
            <p className="text-sm text-slate-500">
              Pipeline, jobs, quotes, invoices, crews, and more
            </p>
          </div>

          {/* Website */}
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
              <p className="text-sm text-slate-500">View your public-facing website</p>
            </a>
          )}

          {/* CMS */}
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
              <p className="text-sm text-slate-500">Edit pages, services, gallery, and content</p>
            </a>
          )}

          {/* Pricebook Promo */}
          {!hasFeature('pricebook') && (
            <div
              onClick={() => navigate('/crm/pricebook-trial')}
              className="bg-white rounded-xl border border-amber-200 border-dashed p-6 cursor-pointer hover:border-amber-300 hover:shadow-md transition-all group relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-amber-600" />
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-bold bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
                  <Sparkles className="w-3 h-3" />
                  FREE TRIAL
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Pricebook</h3>
              <p className="text-sm text-slate-500">
                Standardized pricing catalog — consistent quotes, faster estimates
              </p>
            </div>
          )}

          {/* Exterior Visualizer Promo */}
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

          {/* Instant Roof Estimator Promo */}
          {!hasFeature('instant_estimator') && (
            <div
              onClick={() => navigate('/crm/estimator-trial')}
              className="bg-white rounded-xl border border-sky-200 border-dashed p-6 cursor-pointer hover:border-sky-300 hover:shadow-md transition-all group relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-blue-500" />
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-sky-50 flex items-center justify-center">
                  <Ruler className="w-6 h-6 text-sky-600" />
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-bold bg-sky-100 text-sky-700 px-2 py-1 rounded-full">
                  <Sparkles className="w-3 h-3" />
                  FREE TRIAL
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Instant Roof Estimator</h3>
              <p className="text-sm text-slate-500">
                Satellite-powered roof estimates with embeddable widget and lead capture
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
