import { useState, useEffect, useCallback } from 'react';
import { BarChart3, TrendingUp, DollarSign, Users, Briefcase } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  inspection_scheduled: 'Inspection Sched.',
  inspected: 'Inspected',
  measurement_ordered: 'Measurement',
  proposal_sent: 'Proposal Sent',
  signed: 'Signed',
  material_ordered: 'Material Ordered',
  in_production: 'In Production',
  final_inspection: 'Final Inspection',
  invoiced: 'Invoiced',
  collected: 'Collected',
};

const TYPE_COLORS: Record<string, string> = {
  insurance: '#f97316',
  retail: '#3b82f6',
  commercial: '#6b7280',
  new_construction: '#22c55e',
  emergency: '#ef4444',
};

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-36 text-gray-600 truncate text-right">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
        <div className="h-full rounded-full flex items-center px-2" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}>
          {pct > 15 && <span className="text-white text-xs font-medium">${value.toLocaleString()}</span>}
        </div>
      </div>
      {pct <= 15 && <span className="text-xs text-gray-500 w-20">${value.toLocaleString()}</span>}
    </div>
  );
}

export default function ReportsPage() {
  const { token } = useAuth();
  const toast = useToast();

  const [jobs, setJobs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [crews, setCrews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const [jobsRes, usersRes, crewsRes] = await Promise.all([
        fetch('/api/jobs?limit=1000', { headers }),
        fetch('/api/users', { headers }),
        fetch('/api/crews', { headers }),
      ]);
      const jobsData = await jobsRes.json();
      const usersData = await usersRes.json();
      const crewsData = await crewsRes.json();
      setJobs(Array.isArray(jobsData) ? jobsData : jobsData.data || []);
      setUsers(Array.isArray(usersData) ? usersData : usersData.data || []);
      setCrews(Array.isArray(crewsData) ? crewsData : crewsData.data || []);
    } catch {
      toast.error('Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  // Pipeline value by stage
  const pipelineByStage: Record<string, number> = {};
  const pipelineCountByStage: Record<string, number> = {};
  jobs.forEach((j) => {
    const stage = j.status || 'lead';
    const value = Number(j.revenue || j.total || 0);
    pipelineByStage[stage] = (pipelineByStage[stage] || 0) + value;
    pipelineCountByStage[stage] = (pipelineCountByStage[stage] || 0) + 1;
  });
  const maxPipelineValue = Math.max(...Object.values(pipelineByStage), 1);

  // Jobs by type
  const jobsByType: Record<string, number> = {};
  jobs.forEach((j) => {
    const type = j.jobType || 'retail';
    jobsByType[type] = (jobsByType[type] || 0) + 1;
  });

  // Close rate
  const proposalsSent = jobs.filter((j) => ['proposal_sent', 'signed', 'material_ordered', 'in_production', 'final_inspection', 'invoiced', 'collected'].includes(j.status)).length;
  const signed = jobs.filter((j) => ['signed', 'material_ordered', 'in_production', 'final_inspection', 'invoiced', 'collected'].includes(j.status)).length;
  const closeRate = proposalsSent > 0 ? ((signed / proposalsSent) * 100).toFixed(1) : '0';

  // Average job value
  const jobsWithValue = jobs.filter((j) => Number(j.revenue || j.total || 0) > 0);
  const avgJobValue = jobsWithValue.length > 0
    ? jobsWithValue.reduce((s, j) => s + Number(j.revenue || j.total || 0), 0) / jobsWithValue.length
    : 0;

  // Revenue by sales rep
  const repMap: Record<string, string> = {};
  users.forEach((u: any) => (repMap[u.id] = u.name || u.email));
  const revByRep: Record<string, number> = {};
  jobs.forEach((j) => {
    if (j.salesRepId) {
      const name = repMap[j.salesRepId] || 'Unknown';
      revByRep[name] = (revByRep[name] || 0) + Number(j.revenue || j.total || 0);
    }
  });
  const maxRepRev = Math.max(...Object.values(revByRep), 1);

  // Revenue by crew
  const crewMap: Record<string, string> = {};
  crews.forEach((c: any) => (crewMap[c.id] = c.name));
  const revByCrew: Record<string, number> = {};
  jobs.forEach((j) => {
    if (j.crewId) {
      const name = crewMap[j.crewId] || 'Unknown';
      revByCrew[name] = (revByCrew[name] || 0) + Number(j.revenue || j.total || 0);
    }
  });
  const maxCrewRev = Math.max(...Object.values(revByCrew), 1);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Reports</h1>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Briefcase className="w-5 h-5 text-blue-600" />
              </div>
              <span className="text-sm text-gray-500">Total Jobs</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{jobs.length}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <span className="text-sm text-gray-500">Close Rate</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{closeRate}%</p>
            <p className="text-xs text-gray-400 mt-1">{signed} signed / {proposalsSent} proposed</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-purple-600" />
              </div>
              <span className="text-sm text-gray-500">Avg Job Value</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">
              ${avgJobValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-orange-600" />
              </div>
              <span className="text-sm text-gray-500">Total Revenue</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">
              ${jobs.reduce((s, j) => s + Number(j.revenue || j.total || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pipeline Value by Stage */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Pipeline Value by Stage</h2>
            <div className="space-y-2">
              {Object.keys(STAGE_LABELS).map((stage) => {
                const value = pipelineByStage[stage] || 0;
                const count = pipelineCountByStage[stage] || 0;
                return (
                  <div key={stage}>
                    <Bar
                      label={`${STAGE_LABELS[stage]} (${count})`}
                      value={value}
                      max={maxPipelineValue}
                      color="#3b82f6"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Jobs by Type */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Jobs by Type</h2>
            <div className="space-y-3">
              {Object.entries(jobsByType)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => {
                  const pct = jobs.length > 0 ? ((count / jobs.length) * 100).toFixed(1) : '0';
                  const color = TYPE_COLORS[type] || '#6b7280';
                  return (
                    <div key={type} className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded" style={{ backgroundColor: color }} />
                      <span className="text-sm text-gray-700 capitalize flex-1">{type.replace('_', ' ')}</span>
                      <span className="text-sm font-medium text-gray-900">{count}</span>
                      <span className="text-xs text-gray-400 w-12 text-right">{pct}%</span>
                      <div className="w-24 bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              {Object.keys(jobsByType).length === 0 && (
                <p className="text-sm text-gray-400">No data</p>
              )}
            </div>
          </div>

          {/* Revenue by Sales Rep */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-gray-400" /> Revenue by Sales Rep
            </h2>
            <div className="space-y-2">
              {Object.entries(revByRep)
                .sort(([, a], [, b]) => b - a)
                .map(([name, value]) => (
                  <Bar key={name} label={name} value={value} max={maxRepRev} color="#8b5cf6" />
                ))}
              {Object.keys(revByRep).length === 0 && (
                <p className="text-sm text-gray-400">No data — assign sales reps to jobs</p>
              )}
            </div>
          </div>

          {/* Revenue by Crew */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-gray-400" /> Revenue by Crew
            </h2>
            <div className="space-y-2">
              {Object.entries(revByCrew)
                .sort(([, a], [, b]) => b - a)
                .map(([name, value]) => (
                  <Bar key={name} label={name} value={value} max={maxCrewRev} color="#f59e0b" />
                ))}
              {Object.keys(revByCrew).length === 0 && (
                <p className="text-sm text-gray-400">No data — assign crews to jobs</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
