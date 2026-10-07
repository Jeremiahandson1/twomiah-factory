import { useState, useEffect } from 'react';
import { formatDate } from '../utils/date';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase, Globe, Palette, Users, FileText,
  DollarSign, ArrowRight, ExternalLink, Settings,
  Clock, LogOut, Camera, Sparkles, BookOpen
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
// One definition of what money looks like. Building the string here dropped the cents: bare
// toLocaleString() renders $824.60 as "$824.6" — the defect T12 L1 named, on a screen its fix missed.
import { money, maySeeRoute } from '../shared';
import { SHELL } from '../shellConfig';
import { brandSurfaceUnderWhite } from '../shared';

const API_URL = import.meta.env.VITE_API_URL || '';

// LITERAL class names. These used to be built by interpolating the stat's colour name into the
// utility, and Tailwind finds classes by scanning source text — so an assembled name is never
// emitted, and whether the rule exists at all comes down to whether some other file happens to use
// the same literal. Measured on the deployed build: the blue and green shades were present and the
// emerald and amber ones were not, so two of these four tiles drew an icon with no colour, and which
// two depended on what else was in the bundle. The icon is -700 rather than -500 because the chip is
// a -50 tint and amber-500 on amber-50 is about 1.9:1, under the 3:1 non-text contrast needs. (T58d)
const TILE_TONE: Record<string, { chip: string; icon: string }> = {
  blue: { chip: 'bg-blue-50 dark:bg-blue-950/40', icon: 'text-blue-700 dark:text-blue-300' },
  emerald: { chip: 'bg-emerald-50 dark:bg-emerald-950/40', icon: 'text-emerald-700 dark:text-emerald-300' },
  amber: { chip: 'bg-amber-50 dark:bg-amber-950/40', icon: 'text-amber-700 dark:text-amber-300' },
  green: { chip: 'bg-green-50 dark:bg-green-950/40', icon: 'text-green-700 dark:text-green-300' },
}
const tileTone = (name: string) => TILE_TONE[name] ?? TILE_TONE.blue

export default function CustomerPortal() {
  const { user, company, logout, loading: authLoading, hasFeature } = useAuth();
  const navigate = useNavigate();
  // The shell blanks /crm/settings for a role its vertical does not let in (shellConfig.routeRoles /
  // routePermissions), and this tile was handing that role the door anyway — an offer with a refusal
  // behind it. Same question the sidebar's Settings link asks, from the same declaration, so the two
  // cannot drift. Verticals that declare no rule are unaffected: maySeeRoute says yes. (T41)
  const maySeeSettings = maySeeRoute(SHELL, '/crm/settings', user?.role);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading) fetchStats();
  }, [authLoading]);

  async function fetchStats() {
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_URL}/api/dashboard/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setStats(await res.json());
      }
    } catch (err) {
      // Stats may not be available yet
    } finally {
      setLoading(false);
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600" />
      </div>
    );
  }

  const primaryColor = company?.primaryColor || '{{PRIMARY_COLOR}}';
  // White text sits on this one, so it must be dark enough to carry it — 14px bold is under
  // WCAG's large-text threshold, so the 4.5:1 bar applies. The raw brand colour is still used
  // below for the accent rule, the washes and the icons, where bright is correct.
  const primaryOnWhiteText = brandSurfaceUnderWhite(primaryColor);
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
  // Normalise the website URL (protocol + a real dotted host) so a typo or an
  // unset value doesn't render as a live "View website" link that dead-ends.
  const normalizeUrl = (u) => {
    if (!u || typeof u !== 'string' || !u.trim()) return null;
    const withProto = /^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`;
    try { const parsed = new URL(withProto); return parsed.hostname.includes('.') ? parsed.href.replace(/\/$/, '') : null; } catch { return null; }
  };
  const siteUrl = normalizeUrl(settings.siteUrl);
  const cmsUrl = settings.cmsUrl || null;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 dark:bg-slate-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              {company?.logo ? (
                <img src={company.logo} alt="" className="h-8 w-8 object-contain" />
              ) : (
                <div 
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                  style={{ backgroundColor: primaryOnWhiteText }}
                >
                  {companyName.charAt(0)}
                </div>
              )}
              <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">{companyName}</h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {user?.firstName} {user?.lastName}
              </span>
              <button
                onClick={handleLogout}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
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
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Welcome back{user?.firstName ? `, ${user.firstName}` : ''}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Manage your business from one place</p>
        </div>

        {/* Quick Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            {[
              // /api/dashboard/stats returns { contacts, jobs:{total}, quotes:{pending}, invoices:{totalValue} };
              // the old keys (contactCount/openJobCount/…) never existed, so every tile read 0.
              { label: 'Contacts', value: (stats as any).contacts ?? 0, icon: Users, color: 'blue' },
              { label: 'Open Jobs', value: (stats as any).jobs?.open ?? 0, icon: Briefcase, color: 'emerald' },
              { label: 'Pending Quotes', value: (stats as any).quotes?.pending ?? 0, icon: FileText, color: 'amber' },
              { label: 'Total Invoiced', value: money((stats as any).invoices?.totalValue ?? 0), icon: DollarSign, color: 'green' },
            ].map((stat) => (
              <div key={stat.label} className="bg-white rounded-xl border border-slate-200 p-4 dark:bg-slate-900">
                <div className={`w-8 h-8 rounded-lg ${tileTone(stat.color).chip} flex items-center justify-center mb-2`}>
                  <stat.icon className={`w-4 h-4 ${tileTone(stat.color).icon}`} />
                </div>
                <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{loading ? '—' : stat.value}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Product Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* CRM - always available */}
          <div
            onClick={() => navigate('/crm')}
            className="bg-white rounded-xl border border-slate-200 p-6 cursor-pointer hover:border-slate-300 hover:shadow-md transition-all group relative overflow-hidden dark:bg-slate-900"
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
              <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 dark:text-slate-400 group-hover:translate-x-1 transition-all" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">Business CRM</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Contacts, jobs, quotes, invoices, scheduling, and more
            </p>
          </div>

          {/* Website - if website product was included */}
          {(products.includes('website') || siteUrl) && (
            siteUrl ? (
              <a
                href={siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white rounded-xl border border-slate-200 p-6 cursor-pointer hover:border-slate-300 hover:shadow-md transition-all group relative overflow-hidden block dark:bg-slate-900"
              >
                <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                    <Globe className="w-6 h-6 text-emerald-700" />
                  </div>
                  <ExternalLink className="w-5 h-5 text-slate-300 group-hover:text-slate-500 dark:text-slate-400 transition-all" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">Live Website</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">View your public-facing website</p>
              </a>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 p-6 relative overflow-hidden opacity-75 dark:bg-slate-900">
                <div className="absolute top-0 left-0 right-0 h-1 bg-slate-300" />
                <div className="w-12 h-12 rounded-xl bg-slate-50 dark:bg-slate-950 flex items-center justify-center mb-4">
                  <Globe className="w-6 h-6 text-slate-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">Live Website</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Your website address hasn’t been set yet — add it in Settings.</p>
              </div>
            )
          )}

          {/* CMS - if cms product was included */}
          {(products.includes('cms') || cmsUrl) && (
            <a
              href={cmsUrl || (siteUrl ? `${siteUrl}/admin` : '#')}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-xl border border-slate-200 p-6 cursor-pointer hover:border-slate-300 hover:shadow-md transition-all group relative overflow-hidden block dark:bg-slate-900"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-purple-500" />
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center">
                  <Palette className="w-6 h-6 text-purple-600" />
                </div>
                <ExternalLink className="w-5 h-5 text-slate-300 group-hover:text-slate-500 dark:text-slate-400 transition-all" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">Website Manager</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Edit pages, services, gallery, and content
              </p>
            </a>
          )}

          {/* Pricebook Promo — show if they don't have it yet */}
          {!hasFeature('pricebook') && (
            <div
              onClick={() => navigate('/crm/pricebook-trial')}
              className="bg-white rounded-xl border border-amber-200 border-dashed p-6 cursor-pointer hover:border-amber-300 hover:shadow-md transition-all group relative overflow-hidden dark:bg-slate-900"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-amber-700" />
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-bold bg-amber-100 text-amber-700 px-2 py-1 rounded-full dark:bg-amber-950/40 dark:text-amber-300">
                  <Sparkles className="w-3 h-3" />
                  FREE TRIAL
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">Pricebook</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Standardized pricing catalog — consistent quotes, faster estimates
              </p>
            </div>
          )}

          {/* Settings */}
          {maySeeSettings && (
          <div
            onClick={() => navigate('/crm/settings')}
            className="bg-white rounded-xl border border-slate-200 p-6 cursor-pointer hover:border-slate-300 hover:shadow-md transition-all group relative overflow-hidden dark:bg-slate-900"
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-slate-400" />
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
                <Settings className="w-6 h-6 text-slate-600" />
              </div>
              <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 dark:text-slate-400 group-hover:translate-x-1 transition-all" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">Account Settings</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Company info, users, integrations, billing
            </p>
          </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-slate-200 dark:bg-slate-900">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">Recent Activity</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {stats?.recentActivity?.length > 0 ? (
              stats.recentActivity.slice(0, 5).map((item, i) => (
                <div key={i} className="px-6 py-3 flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-sm text-slate-700 dark:text-slate-300">{item.description}</span>
                  <span className="text-xs text-slate-400 ml-auto">
                    {formatDate(item.createdAt)}
                  </span>
                </div>
              ))
            ) : (
              <div className="px-6 py-8 text-center">
                <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500 dark:text-slate-400">No recent activity</p>
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
