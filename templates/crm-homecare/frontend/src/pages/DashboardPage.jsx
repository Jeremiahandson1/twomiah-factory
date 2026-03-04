import { useState, useEffect } from 'react';
import api from '../services/api.js';
import { Users, UserCheck, Calendar, AlertTriangle, DollarSign, Clock, Activity, TrendingUp } from 'lucide-react';

function StatCard({ label, value, icon: Icon, color = 'blue', sub }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value ?? '—'}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg bg-${color}-50`}>
          <Icon size={20} className={`text-${color}-600`} style={{ color: 'var(--color-primary)' }} />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/dashboard/stats'), api.get('/dashboard/recent-activity')])
      .then(([s, a]) => { setStats(s); setActivity(a); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-gray-500">Loading dashboard…</div>;

  const fmt = (n) => n?.toLocaleString() ?? '0';
  const fmtMoney = (n) => n ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0 })}` : '$0';

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">{{COMPANY_NAME}} Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active Clients" value={fmt(stats?.activeClients)} icon={Users} />
        <StatCard label="Active Caregivers" value={fmt(stats?.activeCaregiversCount)} icon={UserCheck} />
        <StatCard label="Clocked In Now" value={fmt(stats?.caregiversClockedIn)} icon={Clock} sub="currently on shift" />
        <StatCard label="Open Shifts" value={fmt(stats?.openShifts)} icon={Calendar} />
        <StatCard label="Open No-Shows" value={fmt(stats?.openNoshows)} icon={AlertTriangle} />
        <StatCard label="Outstanding Revenue" value={fmtMoney(stats?.outstandingRevenue)} icon={DollarSign} />
        <StatCard label="Auths Expiring (30d)" value={fmt(stats?.authsExpiringSoon)} icon={Activity} />
        <StatCard label="Incomplete Onboarding" value={fmt(stats?.incompleteOnboarding)} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-900 mb-4">Recent Time Entries</h2>
          <div className="space-y-3">
            {activity?.recentTimeEntries?.slice(0, 6).map(e => (
              <div key={e.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{e.caregiver?.firstName} {e.caregiver?.lastName}</span>
                  <span className="text-gray-400 mx-1">→</span>
                  <span className="text-gray-600">{e.client?.firstName} {e.client?.lastName}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs ${e.isComplete ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {e.isComplete ? 'Done' : 'Active'}
                </span>
              </div>
            ))}
            {!activity?.recentTimeEntries?.length && <p className="text-sm text-gray-400">No recent entries</p>}
          </div>
        </div>

        {/* Pending Absences */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-900 mb-4">Coverage Needed</h2>
          <div className="space-y-3">
            {activity?.pendingAbsences?.map(a => (
              <div key={a.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{a.caregiver?.firstName} {a.caregiver?.lastName}</span>
                  <span className="text-gray-400 mx-1">—</span>
                  <span className="text-gray-600 capitalize">{a.type}</span>
                </div>
                <span className="text-xs text-gray-400">{new Date(a.date).toLocaleDateString()}</span>
              </div>
            ))}
            {!activity?.pendingAbsences?.length && <p className="text-sm text-gray-400">No coverage needed</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
