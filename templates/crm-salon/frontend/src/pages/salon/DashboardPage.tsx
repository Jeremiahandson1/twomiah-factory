import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, Users, CalendarDays, Scissors, BellRing,
  CreditCard, DollarSign, ArrowRight, Armchair,
} from 'lucide-react';
import api from '../../services/api';

/**
 * Twomiah Salon — dashboard.
 * KPI cards over /api/dashboard/stats + recent activity. Every field is
 * null/zero-guarded because a brand-new salon comes back all zeros.
 */

interface StylistRow { stylistId?: string; name?: string; visits?: number; revenue?: number }

interface Stats {
  contacts?: number;
  clients?: { total?: number };
  appointments?: { today?: number; upcoming7?: number; byStatus?: Record<string, number> };
  services?: { thisMonth?: number; revenueThisMonth?: number };
  byStylist?: StylistRow[];
  reminders?: { overdue?: number; dueSoon?: number };
  memberships?: { activeEnrollments?: number };
}

interface RecentClient {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
}
interface RecentService {
  id: string;
  performedAt?: string;
  priceCharged?: number | string;
  serviceName?: string;
  clientName?: string;
  stylistFirstName?: string;
  stylistLastName?: string;
}
interface UpcomingAppt {
  id: string;
  startTime?: string;
  status?: string;
  station?: string;
  serviceName?: string;
  clientName?: string;
  stylistFirstName?: string;
  stylistLastName?: string;
}
interface Activity {
  recentClients?: RecentClient[];
  recentServices?: RecentService[];
  upcomingAppointments?: UpcomingAppt[];
}

function money(v: number | string | undefined | null): string {
  const n = Number(v || 0);
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtDateTime(s?: string): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtDate(s?: string): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function stylistName(r: { stylistFirstName?: string; stylistLastName?: string }): string {
  return [r.stylistFirstName, r.stylistLastName].filter(Boolean).join(' ');
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({});
  const [activity, setActivity] = useState<Activity>({});
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, a] = await Promise.all([
          api.get('/api/dashboard/stats'),
          api.get('/api/dashboard/recent-activity'),
        ]);
        setStats(s || {});
        setActivity(a || {});
      } catch (error) {
        console.error('Failed to load dashboard:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const clients = stats.clients || {};
  const appts = stats.appointments || {};
  const services = stats.services || {};
  const reminders = stats.reminders || {};
  const memberships = stats.memberships || {};
  const byStylist = stats.byStylist || [];
  const overdue = reminders.overdue || 0;
  const dueSoon = reminders.dueSoon || 0;
  const reminderTotal = overdue + dueSoon;
  const topRevenue = Math.max(1, ...byStylist.map((s) => Number(s.revenue || 0)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500">Salon overview</p>
      </div>

      {/* Headline rebooking card */}
      <Link
        to="/crm/reminders"
        className={`block rounded-xl border p-5 transition hover:shadow-md ${
          reminderTotal > 0 ? 'bg-red-50 border-red-200' : 'bg-white'
        }`}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-lg ${reminderTotal > 0 ? 'bg-red-100' : 'bg-gray-100'}`}>
              <BellRing className={`w-6 h-6 ${reminderTotal > 0 ? 'text-red-600' : 'text-gray-500'}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Due to Rebook</p>
              <p className="text-2xl font-bold text-gray-900">
                {overdue} overdue
                <span className="text-base font-medium text-gray-500"> · {dueSoon} due soon</span>
              </p>
              <p className="text-sm text-gray-500">Text them before they book somewhere else</p>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-gray-400" />
        </div>
      </Link>

      {/* KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Link to="/crm/clients" className="bg-white rounded-xl border p-5 hover:shadow-md transition block">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Clients</p>
            <Users className="w-5 h-5 text-teal-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-1">{clients.total || 0}</p>
          <p className="text-xs text-gray-400">In your book</p>
        </Link>

        <Link to="/crm/appointments" className="bg-white rounded-xl border p-5 hover:shadow-md transition block">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Appointments Today</p>
            <CalendarDays className="w-5 h-5 text-indigo-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-1">{appts.today || 0}</p>
          <p className="text-xs text-gray-400">{appts.upcoming7 || 0} in the next 7 days</p>
        </Link>

        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Services This Month</p>
            <Scissors className="w-5 h-5 text-purple-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-1">{services.thisMonth || 0}</p>
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <DollarSign className="w-3 h-3 text-green-600" />
            {money(services.revenueThisMonth)} in the chair
          </p>
        </div>

        <Link to="/crm/memberships" className="bg-white rounded-xl border p-5 hover:shadow-md transition block">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Members</p>
            <CreditCard className="w-5 h-5 text-rose-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-1">{memberships.activeEnrollments || 0}</p>
          <p className="text-xs text-gray-400">Active memberships</p>
        </Link>
      </div>

      {/* Chair productivity */}
      {byStylist.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Armchair className="w-4 h-4 text-teal-500" /> Chair Productivity
            <span className="text-xs text-gray-400 font-normal">this month</span>
          </h2>
          <ul className="space-y-3">
            {byStylist.map((s) => (
              <li key={s.stylistId || s.name}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-900">{s.name || 'Unassigned'}</span>
                  <span className="text-gray-600">
                    {money(s.revenue)} <span className="text-gray-400">· {s.visits || 0} service{s.visits === 1 ? '' : 's'}</span>
                  </span>
                </div>
                <div className="mt-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-500" style={{ width: `${Math.round((Number(s.revenue || 0) / topRevenue) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-teal-500" /> Recent Clients
          </h2>
          {(activity.recentClients || []).length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No clients yet</p>
          ) : (
            <ul className="divide-y">
              {(activity.recentClients || []).map((c) => (
                <li key={c.id} className="py-2">
                  <Link to={`/crm/clients/${c.id}`} className="block hover:bg-gray-50 -mx-2 px-2 rounded">
                    <p className="font-medium text-gray-900">{c.name || 'Unnamed'}</p>
                    <p className="text-xs text-gray-500">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Scissors className="w-4 h-4 text-purple-500" /> Recent Services
          </h2>
          {(activity.recentServices || []).length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Nothing logged yet</p>
          ) : (
            <ul className="divide-y">
              {(activity.recentServices || []).map((s) => (
                <li key={s.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-900">{s.clientName || 'Client'}</p>
                    <span className="text-xs text-gray-500">{money(s.priceCharged)}</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {fmtDate(s.performedAt)}{s.serviceName ? ` · ${s.serviceName}` : ''}{stylistName(s) ? ` · ${stylistName(s)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-indigo-500" /> Upcoming Appointments
          </h2>
          {(activity.upcomingAppointments || []).length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Nothing scheduled</p>
          ) : (
            <ul className="divide-y">
              {(activity.upcomingAppointments || []).map((a) => (
                <li key={a.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-900">{a.clientName || 'Client'}</p>
                    {a.serviceName && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{a.serviceName}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {fmtDateTime(a.startTime)}{stylistName(a) ? ` · ${stylistName(a)}` : ''}{a.station ? ` · ${a.station}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
