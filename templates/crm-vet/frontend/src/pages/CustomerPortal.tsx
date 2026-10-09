import { useState, useEffect } from 'react';
import { formatDate } from '../utils/date';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase, Globe, Palette, Users, FileText,
  DollarSign, ArrowRight, ExternalLink, Settings,
  Clock, LogOut, Camera, Ruler,
  PawPrint, CalendarDays, Syringe
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import { brandSurfaceUnderWhite, maySeeRoute, useMayWrite } from '../shared';
import { SHELL } from '../shellConfig';

// The shape GET /api/dashboard/stats actually returns on this template, not the contractor one.
interface DashboardStats {
  contacts?: number;
  patients?: { total?: number; active?: number; [key: string]: unknown };
  appointments?: { today?: number; upcoming7?: number; [key: string]: unknown };
  reminders?: { overdue?: number; dueSoon?: number; [key: string]: unknown };
  [key: string]: unknown;
}

interface ActivityData {
  recentPatients?: Record<string, unknown>[];
  recentVisits?: Record<string, unknown>[];
  upcomingAppointments?: Record<string, unknown>[];
  [key: string]: unknown;
}

interface StatCard {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

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
  const { user, company, logout, loading: authLoading, checkAuth, hasFeature } = useAuth();
  const navigate = useNavigate();
  // Settings is the company's: name, users, integrations, billing — company:update. A seat without it still
  // has its own sign-in to look after, so its tile is My Account (password and two-factor) rather than a
  // door to a page of things it cannot change. (T62 Vet: "an 'Account Settings' tile they can't use")
  const runsTheCompany = useMayWrite('company:update');
  // The shell blanks /crm/settings for a role its vertical does not let in (shellConfig.routeRoles /
  // routePermissions), and this tile was handing that role the door anyway — an offer with a refusal
  // behind it. Same question the sidebar's Settings link asks, from the same declaration, so the two
  // cannot drift. Verticals that declare no rule are unaffected: maySeeRoute says yes. (T41)
  const maySeeSettings = maySeeRoute(SHELL, '/crm/settings', user?.role);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
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
      const [statsData, activityData] = await Promise.all([
        api.dashboard.stats().catch(() => null),
        api.dashboard.recentActivity().catch(() => null),
      ]);
      if (statsData) setStats(statsData as DashboardStats);
      if (activityData) setActivity(activityData as ActivityData);
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
  // White text sits on this one, so it must be dark enough to carry it — 14px bold is under
  // WCAG's large-text threshold, so the 4.5:1 bar applies. The raw brand colour is still used
  // below for the accent rule, the washes and the icons, where bright is correct.
  const primaryOnWhiteText = brandSurfaceUnderWhite(primaryColor);
  const companyName = company?.name || import.meta.env.VITE_COMPANY_NAME || 'My Company';

  // Determine which products are available based on company settings
  let settings: Record<string, unknown> = {};
  try {
    settings = typeof company?.settings === 'string'
      ? JSON.parse(company.settings as string)
      : (company?.settings || {}) as Record<string, unknown>;
  } catch {
    // Invalid JSON in settings, use defaults
  }

  const products = (settings.products as string[]) || ['crm']; // default: CRM always available
  const siteUrl = (settings.siteUrl as string) || null;
  const cmsUrl = (settings.cmsUrl as string) || null;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50">
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
              <span className="text-sm text-slate-500">
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
          <p className="text-slate-500 mt-1">Manage your business from one place</p>
        </div>

        {/* Quick Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            {/*
              FOUR TILES FROM A CONTRACTOR'S DASHBOARD, IN A VETERINARY CLINIC. (T41)

                "the staff portal home shows contractor tiles"

              They read stats.jobs.open, stats.quotes.pending and stats.invoices.outstandingValue.
              GET /api/dashboard/stats on this template returns none of those keys — it returns
              contacts, patients, appointments, visits, reminders and wellness — so `?? 0` turned
              three absent figures into a confident "Open Jobs 0 · Pending Quotes 0 · Outstanding
              $0.00" on the practice's own home page. Not merely the wrong words: three numbers
              that were never measured, printed as if they had been.

              These four are the clinic's, from the keys the endpoint actually sends.
            */}
            {([
              { label: 'Owners', value: stats.contacts ?? 0, icon: Users, color: 'blue' },
              { label: 'Patients', value: (stats.patients as Record<string, unknown>)?.active ?? 0, icon: PawPrint, color: 'emerald' },
              { label: 'Appointments today', value: (stats.appointments as Record<string, unknown>)?.today ?? 0, icon: CalendarDays, color: 'amber' },
              { label: 'Reminders due', value: Number((stats.reminders as Record<string, unknown>)?.overdue ?? 0) + Number((stats.reminders as Record<string, unknown>)?.dueSoon ?? 0), icon: Syringe, color: 'green' },
            ] as unknown as StatCard[]).map((stat) => (
              <div key={stat.label} className="bg-white rounded-xl border border-slate-200 p-4 dark:bg-slate-900">
                <div className={`w-8 h-8 rounded-lg ${tileTone(stat.color).chip} flex items-center justify-center mb-2`}>
                  <stat.icon className={`w-4 h-4 ${tileTone(stat.color).icon}`} />
                </div>
                <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{loading ? '—' : stat.value}</p>
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
              <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-1 transition-all" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1 dark:text-slate-100">Practice CRM</h3>
            <p className="text-sm text-slate-500">
              {/* The practice's words, not a contractor's "Contacts, jobs, quotes". (T62 Vet) */}
              Owners, patients, appointments, visits, reminders and more
            </p>
          </div>

          {/* Website - if website product was included */}
          {(products.includes('website') || siteUrl) && (
            <a
              href={siteUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-xl border border-slate-200 p-6 cursor-pointer hover:border-slate-300 hover:shadow-md transition-all group relative overflow-hidden block dark:bg-slate-900"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <Globe className="w-6 h-6 text-emerald-700" />
                </div>
                <ExternalLink className="w-5 h-5 text-slate-300 group-hover:text-slate-500 transition-all" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1 dark:text-slate-100">Live Website</h3>
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
              className="bg-white rounded-xl border border-slate-200 p-6 cursor-pointer hover:border-slate-300 hover:shadow-md transition-all group relative overflow-hidden block dark:bg-slate-900"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-purple-500" />
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center">
                  <Palette className="w-6 h-6 text-purple-600" />
                </div>
                <ExternalLink className="w-5 h-5 text-slate-300 group-hover:text-slate-500 transition-all" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1 dark:text-slate-100">Website Manager</h3>
              <p className="text-sm text-slate-500">
                Edit pages, services, gallery, and content
              </p>
            </a>
          )}

          {/* No Pricebook trial tile: this template mounts no /crm/pricebook-trial, so the tile led nowhere. (T62 Vet: "a dead Pricebook FREE TRIAL tile") */}

          {/* Exterior Visualizer add-on is contractor/roofer-only — no promo on vet portals */}

          {/* Instant Roof Estimator add-on is contractor/roofer-only — no promo on vet portals */}

          {/* Settings — or, for a seat that cannot change the company, its own account */}
          {(maySeeSettings || !runsTheCompany) && (
          <div
            onClick={() => navigate(runsTheCompany ? '/crm/settings' : '/crm/account')}
            className="bg-white rounded-xl border border-slate-200 p-6 cursor-pointer hover:border-slate-300 hover:shadow-md transition-all group relative overflow-hidden dark:bg-slate-900"
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-slate-400" />
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
                <Settings className="w-6 h-6 text-slate-600" />
              </div>
              <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-1 transition-all" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1 dark:text-slate-100">{runsTheCompany ? 'Account Settings' : 'My Account'}</h3>
            <p className="text-sm text-slate-500">
              {runsTheCompany ? 'Company info, users, integrations, billing' : 'Your password and two-factor sign-in'}
            </p>
          </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-slate-200 dark:bg-slate-900">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">Recent Activity</h3>
          </div>
          {/*
            The same fault as the tiles above, one panel down: this read recentJobs / recentQuotes /
            recentInvoices, and GET /api/dashboard/recent-activity on this template returns
            recentPatients / recentVisits / upcomingAppointments. So the panel was permanently in its
            empty state, telling a working clinic it had no recent activity and to "get started by
            adding contacts and jobs". (T41)
          */}
          <div className="divide-y divide-slate-100">
            {(activity?.upcomingAppointments?.length || activity?.recentVisits?.length || activity?.recentPatients?.length) ? (
              <>
                {(activity?.upcomingAppointments || []).slice(0, 3).map((item: Record<string, unknown>) => (
                  <div key={item.id as string} className="px-6 py-3 flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-sm text-slate-700 dark:text-slate-200">
                      Appointment: {(item.patientName as string) || 'patient'}
                      {item.ownerName ? ` (${item.ownerName as string})` : ''}
                      {item.type ? ` — ${String(item.type).replace(/_/g, ' ')}` : ''}
                    </span>
                    <span className="text-xs text-slate-400 ml-auto">
                      {item.startTime ? formatDate(item.startTime as string) : ''}
                    </span>
                  </div>
                ))}
                {(activity?.recentVisits || []).slice(0, 3).map((item: Record<string, unknown>) => (
                  <div key={item.id as string} className="px-6 py-3 flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-400" />
                    <span className="text-sm text-slate-700 dark:text-slate-200">
                      Visit: {(item.patientName as string) || 'patient'}
                      {item.reason ? ` — ${item.reason as string}` : ''}
                    </span>
                    <span className="text-xs text-slate-400 ml-auto">
                      {item.visitDate ? formatDate(item.visitDate as string) : ''}
                    </span>
                  </div>
                ))}
              </>
            ) : (
              <div className="px-6 py-8 text-center">
                <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No recent activity</p>
                <p className="text-xs text-slate-400 mt-1">Get started by adding an owner and their pet</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-slate-400">
            Powered by <span className="font-medium">{'{{COMPANY_NAME}}'}</span>
          </p>
        </div>
      </main>
    </div>
  );
}
