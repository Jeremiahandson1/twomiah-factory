import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, CalendarDays, Wallet, TrendingUp, ArrowRight, DoorOpen,
  Users, Inbox, AlertTriangle,
} from 'lucide-react';
import api from '../../services/api';
import { STATUS_COLORS, fmtEventDate, prettyType } from './EventsPage';

/**
 * Twomiah Events — dashboard.
 * KPI cards over /api/dashboard/stats + what needs attention today. Every field
 * is null/zero-guarded because a brand-new venue comes back all zeros.
 */

interface Pipeline { enquiry?: number; tentative?: number; confirmed?: number; completed?: number; lost?: number; cancelled?: number }
interface Stats {
  contacts?: number;
  pipeline?: Pipeline;
  events?: { upcoming30?: number; thisMonth?: number; bookedValue?: number };
  payments?: { overdue?: number; outstanding?: number };
  byType?: Record<string, number>;
  bySpace?: { spaceId?: string; name?: string; events?: number }[];
}
interface EnquiryRow { id: string; name?: string; eventDate?: string; eventType?: string; guestCount?: number; clientName?: string }
interface UpcomingRow {
  id: string; name?: string; eventDate?: string; startTime?: string; status?: string;
  guestCount?: number; guestCountFinal?: number; spaceName?: string; clientName?: string;
  coordinatorFirstName?: string; coordinatorLastName?: string;
}
interface DueRow { id: string; label?: string; amount?: number | string; dueDate?: string; eventId?: string; eventName?: string; clientName?: string }
interface Activity { newEnquiries?: EnquiryRow[]; upcomingEvents?: UpcomingRow[]; duePayments?: DueRow[] }

function money(v: number | string | undefined | null): string {
  return `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function isOverdue(dueDate?: string): boolean {
  return !!dueDate && dueDate < new Date().toISOString().slice(0, 10);
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

  const pipeline = stats.pipeline || {};
  const events = stats.events || {};
  const payments = stats.payments || {};
  const bySpace = stats.bySpace || [];
  const overdue = Number(payments.overdue || 0);
  const topSpace = Math.max(1, ...bySpace.map((s) => Number(s.events || 0)));

  const stages: { key: keyof Pipeline; label: string }[] = [
    { key: 'enquiry', label: 'Enquiry' },
    { key: 'tentative', label: 'Tentative' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'completed', label: 'Completed' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Dashboard</h1>
        <p className="text-gray-500 dark:text-slate-400">Events overview</p>
      </div>

      {/* Headline: money owed. This is the number a venue loses track of. */}
      <Link
        to="/crm/events"
        className={`block rounded-xl border p-5 transition hover:shadow-md ${overdue > 0 ? 'bg-red-50 border-red-200' : 'bg-white'}`}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-lg ${overdue > 0 ? 'bg-red-100' : 'bg-gray-100'}`}>
              <Wallet className={`w-6 h-6 ${overdue > 0 ? 'text-red-600' : 'text-gray-500'}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-slate-400">Payments Overdue</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                {money(overdue)}
                <span className="text-base font-medium text-gray-500 dark:text-slate-400"> · {money(payments.outstanding)} outstanding</span>
              </p>
              <p className="text-sm text-gray-500 dark:text-slate-400">Deposits and balances past their due date</p>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-gray-400" />
        </div>
      </Link>

      {/* KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Link to="/crm/events" className="bg-white rounded-xl border p-5 hover:shadow-md transition block dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500 dark:text-slate-400">Open Enquiries</p>
            <Inbox className="w-5 h-5 text-amber-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-1 dark:text-slate-100">{pipeline.enquiry || 0}</p>
          <p className="text-xs text-gray-400">Waiting on you</p>
        </Link>

        <Link to="/crm/events" className="bg-white rounded-xl border p-5 hover:shadow-md transition block dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500 dark:text-slate-400">Next 30 Days</p>
            <CalendarDays className="w-5 h-5 text-indigo-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-1 dark:text-slate-100">{events.upcoming30 || 0}</p>
          <p className="text-xs text-gray-400">{events.thisMonth || 0} this month</p>
        </Link>

        <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500 dark:text-slate-400">Booked Value Ahead</p>
            <TrendingUp className="w-5 h-5 text-green-600" />
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-1 dark:text-slate-100">{money(events.bookedValue)}</p>
          <p className="text-xs text-gray-400">Food &amp; beverage on held events</p>
        </div>

        <Link to="/crm/spaces" className="bg-white rounded-xl border p-5 hover:shadow-md transition block dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500 dark:text-slate-400">Confirmed</p>
            <DoorOpen className="w-5 h-5 text-teal-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-1 dark:text-slate-100">{pipeline.confirmed || 0}</p>
          <p className="text-xs text-gray-400">{pipeline.tentative || 0} tentative</p>
        </Link>
      </div>

      {/* Pipeline strip */}
      <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
        <h2 className="font-semibold text-gray-900 mb-3 dark:text-slate-100">Pipeline</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stages.map((s) => (
            <Link key={s.key} to="/crm/events" className="border rounded-lg p-3 hover:bg-gray-50">
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[s.key] || 'bg-gray-100 text-gray-700'}`}>{s.label}</span>
              <p className="text-2xl font-bold text-gray-900 mt-2 dark:text-slate-100">{pipeline[s.key] || 0}</p>
            </Link>
          ))}
        </div>
        {((pipeline.lost || 0) > 0 || (pipeline.cancelled || 0) > 0) && (
          <p className="text-xs text-gray-400 mt-3">
            {pipeline.lost || 0} lost · {pipeline.cancelled || 0} cancelled
          </p>
        )}
      </div>

      {/* Space utilisation */}
      {bySpace.length > 0 && (
        <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-slate-100">
            <DoorOpen className="w-4 h-4 text-teal-500" /> Space Utilisation
            <span className="text-xs text-gray-400 font-normal">upcoming held events</span>
          </h2>
          <ul className="space-y-3">
            {bySpace.map((s) => (
              <li key={s.spaceId || s.name}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-900 dark:text-slate-100">{s.name}</span>
                  <span className="text-gray-600 dark:text-slate-400">{s.events} event{s.events === 1 ? '' : 's'}</span>
                </div>
                <div className="mt-1 h-2 bg-gray-100 rounded-full overflow-hidden dark:bg-slate-800">
                  <div className="h-full bg-teal-500" style={{ width: `${Math.round((Number(s.events || 0) / topSpace) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Three lists */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-slate-100">
            <Inbox className="w-4 h-4 text-amber-500" /> New Enquiries
          </h2>
          {(activity.newEnquiries || []).length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Nothing waiting</p>
          ) : (
            <ul className="divide-y">
              {(activity.newEnquiries || []).map((e) => (
                <li key={e.id} className="py-2">
                  <Link to={`/crm/events/${e.id}`} className="block hover:bg-gray-50 -mx-2 px-2 rounded">
                    <p className="font-medium text-gray-900 dark:text-slate-100">{e.name || 'Untitled'}</p>
                    <p className="text-xs text-gray-500 capitalize dark:text-slate-400">
                      {fmtEventDate(e.eventDate)}{e.guestCount ? ` · ${e.guestCount} guests` : ''}{e.eventType ? ` · ${prettyType(e.eventType)}` : ''}
                    </p>
                    {e.clientName && <p className="text-xs text-gray-400">{e.clientName}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-slate-100">
            <CalendarDays className="w-4 h-4 text-indigo-500" /> Coming Up
          </h2>
          {(activity.upcomingEvents || []).length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Nothing booked</p>
          ) : (
            <ul className="divide-y">
              {(activity.upcomingEvents || []).map((e) => (
                <li key={e.id} className="py-2">
                  <Link to={`/crm/events/${e.id}`} className="block hover:bg-gray-50 -mx-2 px-2 rounded">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-gray-900 dark:text-slate-100">{e.name || 'Untitled'}</p>
                      {(e.guestCountFinal || e.guestCount) && (
                        <span className="text-xs text-gray-500 flex items-center gap-1 dark:text-slate-400">
                          <Users className="w-3 h-3" /> {e.guestCountFinal ?? e.guestCount}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      {fmtEventDate(e.eventDate)}{e.startTime ? ` · ${e.startTime}` : ''}{e.spaceName ? ` · ${e.spaceName}` : ''}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-slate-100">
            <Wallet className="w-4 h-4 text-green-600" /> Payments Due
          </h2>
          {(activity.duePayments || []).length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Nothing outstanding</p>
          ) : (
            <ul className="divide-y">
              {(activity.duePayments || []).map((p) => (
                <li key={p.id} className="py-2">
                  <Link to={p.eventId ? `/crm/events/${p.eventId}` : '/crm/events'} className="block hover:bg-gray-50 -mx-2 px-2 rounded">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-gray-900 dark:text-slate-100">{p.eventName || 'Event'}</p>
                      <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">{money(p.amount)}</span>
                    </div>
                    <p className={`text-xs flex items-center gap-1 ${isOverdue(p.dueDate) ? 'text-red-700 font-medium' : 'text-gray-500'}`}>
                      {isOverdue(p.dueDate) && <AlertTriangle className="w-3 h-3" />}
                      {p.label}{p.dueDate ? ` · due ${p.dueDate}` : ' · no due date'}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
