import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, PawPrint, CalendarDays, Stethoscope, BellRing,
  HeartPulse, DollarSign, AlertTriangle, ArrowRight,
} from 'lucide-react';
import api from '../../services/api';

/**
 * Twomiah Vet — practice dashboard.
 * KPI cards over /api/dashboard/stats + recent activity. Every field is
 * null/zero-guarded because a brand-new clinic comes back all zeros.
 */

interface Stats {
  contacts?: number;
  patients?: { total?: number; active?: number; bySpecies?: Record<string, number> };
  appointments?: { today?: number; upcoming7?: number; byStatus?: Record<string, number> };
  visits?: { thisMonth?: number; revenueThisMonth?: number };
  reminders?: { overdue?: number; dueSoon?: number };
  wellness?: { activeEnrollments?: number };
}

interface RecentPatient {
  id: string;
  name?: string;
  species?: string;
  breed?: string;
  ownerName?: string;
}
interface RecentVisit {
  id: string;
  patientId?: string;
  patientName?: string;
  visitDate?: string;
  reason?: string;
  total?: number | string;
}
interface UpcomingAppt {
  id: string;
  patientName?: string;
  ownerName?: string;
  type?: string;
  status?: string;
  startTime?: string;
}
interface Activity {
  recentPatients?: RecentPatient[];
  recentVisits?: RecentVisit[];
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

  const patients = stats.patients || {};
  const appts = stats.appointments || {};
  const visits = stats.visits || {};
  const reminders = stats.reminders || {};
  const wellness = stats.wellness || {};
  const bySpecies = patients.bySpecies || {};
  const overdue = reminders.overdue || 0;
  const dueSoon = reminders.dueSoon || 0;
  const reminderTotal = overdue + dueSoon;

  const speciesEntries = Object.entries(bySpecies).filter(([, n]) => Number(n) > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Dashboard</h1>
        <p className="text-gray-500 dark:text-slate-400">Practice overview</p>
      </div>

      {/* Headline reminders card */}
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
              <p className="text-sm font-medium text-gray-600 dark:text-slate-400">Reminders Due</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                {overdue} overdue
                <span className="text-base font-medium text-gray-500 dark:text-slate-400"> · {dueSoon} due soon</span>
              </p>
              <p className="text-sm text-gray-500 dark:text-slate-400">Bring lapsed patients back in for care</p>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-gray-400" />
        </div>
      </Link>

      {/* KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Patients */}
        <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500 dark:text-slate-400">Active Patients</p>
            <PawPrint className="w-5 h-5 text-teal-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-1 dark:text-slate-100">{patients.active || 0}</p>
          <p className="text-xs text-gray-400">{patients.total || 0} total in records</p>
          {speciesEntries.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {speciesEntries.map(([sp, n]) => (
                <span key={sp} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize dark:bg-slate-800 dark:text-slate-400">
                  {sp} {n}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Appointments */}
        <Link to="/crm/appointments" className="bg-white rounded-xl border p-5 hover:shadow-md transition block dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500 dark:text-slate-400">Appointments Today</p>
            <CalendarDays className="w-5 h-5 text-indigo-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-1 dark:text-slate-100">{appts.today || 0}</p>
          <p className="text-xs text-gray-400">{appts.upcoming7 || 0} in the next 7 days</p>
        </Link>

        {/* Visits + revenue */}
        <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500 dark:text-slate-400">Visits This Month</p>
            <Stethoscope className="w-5 h-5 text-purple-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-1 dark:text-slate-100">{visits.thisMonth || 0}</p>
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <DollarSign className="w-3 h-3 text-green-600" />
            {money(visits.revenueThisMonth)} revenue
          </p>
        </div>

        {/* Wellness */}
        <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500 dark:text-slate-400">Wellness Enrollments</p>
            <HeartPulse className="w-5 h-5 text-rose-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-1 dark:text-slate-100">{wellness.activeEnrollments || 0}</p>
          <p className="text-xs text-gray-400">Active plan members</p>
        </div>
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent patients */}
        <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-slate-100">
            <PawPrint className="w-4 h-4 text-teal-500" /> Recent Patients
          </h2>
          {(activity.recentPatients || []).length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No patients yet</p>
          ) : (
            <ul className="divide-y">
              {(activity.recentPatients || []).map((p) => (
                <li key={p.id} className="py-2">
                  <Link to={`/crm/patients/${p.id}`} className="block hover:bg-gray-50 -mx-2 px-2 rounded">
                    <p className="font-medium text-gray-900 dark:text-slate-100">{p.name || 'Unnamed'}</p>
                    <p className="text-xs text-gray-500 capitalize dark:text-slate-400">
                      {[p.species, p.breed].filter(Boolean).join(' · ') || '—'}
                      {p.ownerName ? ` — ${p.ownerName}` : ''}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent visits */}
        <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-slate-100">
            <Stethoscope className="w-4 h-4 text-purple-500" /> Recent Visits
          </h2>
          {(activity.recentVisits || []).length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No visits yet</p>
          ) : (
            <ul className="divide-y">
              {(activity.recentVisits || []).map((v) => (
                <li key={v.id} className="py-2">
                  <Link
                    to={v.patientId ? `/crm/patients/${v.patientId}` : '#'}
                    className="block hover:bg-gray-50 -mx-2 px-2 rounded"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-gray-900 dark:text-slate-100">{v.patientName || 'Patient'}</p>
                      <span className="text-xs text-gray-500 dark:text-slate-400">{money(v.total)}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      {fmtDate(v.visitDate)}{v.reason ? ` · ${v.reason}` : ''}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Upcoming appointments */}
        <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-slate-100">
            <CalendarDays className="w-4 h-4 text-indigo-500" /> Upcoming Appointments
          </h2>
          {(activity.upcomingAppointments || []).length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Nothing scheduled</p>
          ) : (
            <ul className="divide-y">
              {(activity.upcomingAppointments || []).map((a) => (
                <li key={a.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-900 dark:text-slate-100">{a.patientName || 'Patient'}</p>
                    {a.type && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize dark:bg-slate-800 dark:text-slate-400">
                        {a.type}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    {fmtDateTime(a.startTime)}{a.ownerName ? ` · ${a.ownerName}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {reminderTotal > 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <AlertTriangle className="w-3 h-3" />
          Tip: the Reminders page lets you batch-text owners of patients due for vaccines.
        </div>
      )}
    </div>
  );
}
