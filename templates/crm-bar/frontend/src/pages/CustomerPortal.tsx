import { useState, useEffect } from 'react';
import { formatDate } from '../utils/date';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase, Globe, Palette, Inbox, Users,
  DollarSign, ArrowRight, ExternalLink, Settings,
  Clock, LogOut, Camera
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
// One definition of what money looks like. Building the string here dropped the cents: bare
// toLocaleString() renders $824.60 as "$824.6" — the defect T12 L1 named, on a screen its fix missed.
import { money, maySeeRoute, meetsRole, useMayWrite, usePermissions } from '../shared';
import { SHELL } from '../shellConfig';
import { brandSurfaceUnderWhite } from '../shared';
import client from '../services/api';

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
  // Settings is the company's: name, users, integrations, billing — company:update. A seat without it still
  // has its own sign-in to look after, so its tile is My Account (password and two-factor) rather than a
  // door to a page of things it cannot change. (T62 Vet: "an 'Account Settings' tile they can't use")
  const runsTheCompany = useMayWrite('company:update');
  // The shell blanks /crm/settings for a role its vertical does not let in (shellConfig.routeRoles /
  // routePermissions), and this tile was handing that role the door anyway — an offer with a refusal
  // behind it. Same question the sidebar's Settings link asks, from the same declaration, so the two
  // cannot drift. Verticals that declare no rule are unaffected: maySeeRoute says yes. (T41)
  const maySeeSettings = maySeeRoute(SHELL, '/crm/settings', user?.role);
  // The CRM card named stock to a bartender, who has no Stock page (Bar Run 2). It now names only what this
  // seat's sidebar shows — the same three tests AppShell runs on SHELL.nav, so the card and the menu agree.
  const { can } = usePermissions();
  const inMenu = (to: string) => SHELL.nav.some((i) => i.to === to
    && meetsRole(user?.role, i.minRole)
    && (!i.permission || can(i.permission))
    && (!i.features || i.features.some((f) => hasFeature(f))));
  const crmCardParts = ([
    ['/crm/register', 'the register, the grill'],
    ['/crm/menu', 'the menu and taps'],
    ['/crm/stock', 'stock'],
    ['/crm/shifts', 'the schedule'],
    ['/crm/events', 'parties'],
  ] as const).filter(([to]) => inMenu(to)).map(([, words]) => words);
  const crmCardText = crmCardParts.length
    ? `${crmCardParts.join(', ').replace(/^t/, 'T')} and more`
    : 'Guests, the night and more';
  const [stats, setStats] = useState(null);
  // The recent-activity feed is its OWN endpoint. The panel below used to read stats.recentActivity —
  // a key /api/dashboard/stats has never returned — so it showed "No recent activity" permanently, over
  // a tenant with 5 jobs, 5 quotes and 5 invoices waiting on /api/dashboard/recent-activity. (T26 M1)
  const [activity, setActivity] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading) fetchStats();
  }, [authLoading]);

  async function fetchStats() {
    try {
      // Through the client: the current token, refreshed if it has expired.
      const [statsRes, activityRes] = await Promise.all([
        client.raw('/api/dashboard/stats').catch(() => null),
        client.raw('/api/dashboard/recent-activity').catch(() => null),
      ]);
      if (statsRes?.ok) setStats(await statsRes.json());
      if (activityRes?.ok) setActivity(await activityRes.json());
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
  const siteUrl = settings.siteUrl || null;
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
          <div className={`grid grid-cols-2 ${(stats as any).payments?.outstanding !== undefined ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-4 mb-8`}>
            {[
              // The bar's /api/dashboard/stats (routes/dashboard.ts) is the events shape — { contacts, pipeline,
              // events, payments }. These tiles were the contractor's "Open Jobs" and "Pending Quotes", read from
              // keys this endpoint never sends, so they always said 0 on a bar's front page (Bar Run 1).
              { label: 'Guests', value: (stats as any).contacts ?? 0, icon: Users, color: 'blue' },
              { label: 'Parties in the next 30 days', value: (stats as any).events?.upcoming30 ?? 0, icon: Briefcase, color: 'emerald' },
              { label: 'Party enquiries', value: (stats as any).pipeline?.enquiry ?? 0, icon: Inbox, color: 'amber' },
              // A money tile only when the figure was SENT — the server leaves it off for a seat that may not see money,
              // and `?? 0` drew that absence as "$0.00". (T62: "Salon portal home shows '$0.00 Outstanding'")
              ...((stats as any).payments?.outstanding !== undefined ? [{ label: 'Owed on parties', value: money((stats as any).payments?.outstanding ?? 0), icon: DollarSign, color: 'green' }] : []),
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
              {crmCardText}
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
                <ExternalLink className="w-5 h-5 text-slate-300 group-hover:text-slate-500 dark:text-slate-400 transition-all" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">Live Website</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                View your public-facing website
              </p>
            </a>
          )}

          {/* CMS - if cms product was included. Only for a seat that runs the company: the site's admin is its own
              sign-in, the owner's, and a manager or bartender was offered a door they cannot open (Bar Run 2). */}
          {runsTheCompany && (products.includes('cms') || cmsUrl) && (
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

          {/* No Pricebook offer: a bar is never offered Pricebook (featureRegistry), so a trial tile would sell a module it cannot switch on. */}

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
              <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 dark:text-slate-400 group-hover:translate-x-1 transition-all" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">{runsTheCompany ? 'Account Settings' : 'My Account'}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
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
          <div className="divide-y divide-slate-100">
            {(() => {
              // The bar's /api/dashboard/recent-activity (routes/dashboard.ts) is the parties feed:
              // { newEnquiries, upcomingEvents, duePayments? }. This panel read crm-basic's recentJobs /
              // recentQuotes / recentInvoices, keys that endpoint never sends, so a bar with a booked party
              // still read "Get started by adding contacts and jobs" (Bar Run 2). Same reading as
              // crm-restaurant's portal, whose endpoint this is.
              const upcoming = activity?.upcomingEvents || [];
              const enquiries = activity?.newEnquiries || [];
              // An event date is a calendar day; noon keeps it on that day in every zone.
              const onDay = (d: any) => (d ? formatDate(`${d}T12:00:00`) : '');
              return (upcoming.length || enquiries.length) ? (
                <>
                  {upcoming.slice(0, 3).map((item: any) => (
                    <div key={`e-${item.id}`} className="px-6 py-3 flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span className="text-sm text-slate-700 dark:text-slate-300">Party: {item.name || 'Untitled'}{item.clientName ? ` — ${item.clientName}` : ''}</span>
                      <span className="text-xs text-slate-400 ml-auto">{onDay(item.eventDate)}</span>
                    </div>
                  ))}
                  {enquiries.slice(0, 2).map((item: any) => (
                    <div key={`q-${item.id}`} className="px-6 py-3 flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-amber-400" />
                      <span className="text-sm text-slate-700 dark:text-slate-300">Enquiry: {item.name || 'Untitled'}{item.clientName ? ` — ${item.clientName}` : ''}</span>
                      <span className="text-xs text-slate-400 ml-auto">{onDay(item.eventDate)}</span>
                    </div>
                  ))}
                </>
              ) : (
                <div className="px-6 py-8 text-center">
                  <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500 dark:text-slate-400">No recent activity</p>
                  <p className="text-xs text-slate-400 mt-1">Party enquiries and booked parties show here</p>
                </div>
              );
            })()}
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
