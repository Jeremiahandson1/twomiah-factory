import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, ChevronLeft, ChevronRight, Briefcase } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

const JOB_TYPES = ['insurance', 'retail', 'commercial', 'new_construction', 'emergency'];
const STATUSES = [
  'lead', 'inspection_scheduled', 'inspected', 'measurement_ordered', 'proposal_sent',
  'signed', 'material_ordered', 'in_production', 'final_inspection', 'invoiced', 'collected',
];

const STATUS_COLORS: Record<string, string> = {
  lead: 'bg-gray-100 text-gray-700',
  inspection_scheduled: 'bg-blue-100 text-blue-700',
  inspected: 'bg-indigo-100 text-indigo-700',
  measurement_ordered: 'bg-purple-100 text-purple-700',
  proposal_sent: 'bg-yellow-100 text-yellow-700',
  signed: 'bg-green-100 text-green-700',
  material_ordered: 'bg-orange-100 text-orange-700',
  in_production: 'bg-cyan-100 text-cyan-700',
  final_inspection: 'bg-teal-100 text-teal-700',
  invoiced: 'bg-pink-100 text-pink-700',
  collected: 'bg-emerald-100 text-emerald-700',
};

const TYPE_COLORS: Record<string, string> = {
  insurance: 'bg-orange-100 text-orange-700',
  retail: 'bg-blue-100 text-blue-700',
  commercial: 'bg-gray-100 text-gray-700',
  new_construction: 'bg-green-100 text-green-700',
  emergency: 'bg-red-100 text-red-700',
};

function formatStatus(s: string) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function JobsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [crews, setCrews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [crewFilter, setCrewFilter] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    contactId: '',
    jobType: 'retail',
    address: '',
    city: '',
    state: '',
    zip: '',
    roofType: '',
    stories: '',
    notes: '',
  });
  const [contacts, setContacts] = useState<any[]>([]);

  const limit = 25;
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('jobType', typeFilter);
      if (crewFilter) params.set('crewId', crewFilter);
      if (repFilter) params.set('salesRepId', repFilter);

      const [jobsRes, usersRes, crewsRes] = await Promise.all([
        fetch(`/api/jobs?${params}`, { headers }),
        fetch('/api/users', { headers }),
        fetch('/api/crews', { headers }),
      ]);
      const jobsData = await jobsRes.json();
      const usersData = await usersRes.json();
      const crewsData = await crewsRes.json();

      setJobs(Array.isArray(jobsData) ? jobsData : jobsData.data || []);
      setTotal(jobsData.pagination?.total || jobsData.total || (Array.isArray(jobsData) ? jobsData.length : 0));
      setUsers(Array.isArray(usersData) ? usersData : usersData.data || []);
      setCrews(Array.isArray(crewsData) ? crewsData : crewsData.data || []);
    } catch {
      toast.error('Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, typeFilter, crewFilter, repFilter, token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, statusFilter, typeFilter, crewFilter, repFilter]);

  const openCreate = async () => {
    setForm({ contactId: '', jobType: 'retail', address: '', city: '', state: '', zip: '', roofType: '', stories: '', notes: '' });
    try {
      const res = await fetch('/api/contacts?limit=200', { headers });
      const data = await res.json();
      setContacts(Array.isArray(data) ? data : data.data || []);
    } catch { setContacts([]); }
    setModalOpen(true);
  };

  const handleCreate = async () => {
    if (!form.contactId) { toast.error('Select a contact'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      const job = await res.json();
      toast.success('Job created');
      setModalOpen(false);
      navigate(`/crm/jobs/${job.id}`);
    } catch {
      toast.error('Failed to create job');
    } finally {
      setSaving(false);
    }
  };

  const crewMap: Record<string, string> = {};
  crews.forEach((c: any) => (crewMap[c.id] = c.name));

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
            <p className="text-sm text-gray-500 mt-0.5">{total} total jobs</p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> New Job
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search jobs..."
              className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg"
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-sm border rounded-lg px-3 py-2">
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{formatStatus(s)}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="text-sm border rounded-lg px-3 py-2">
            <option value="">All Types</option>
            {JOB_TYPES.map((t) => <option key={t} value={t}>{formatStatus(t)}</option>)}
          </select>
          <select value={crewFilter} onChange={(e) => setCrewFilter(e.target.value)} className="text-sm border rounded-lg px-3 py-2">
            <option value="">All Crews</option>
            {crews.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className="text-sm border rounded-lg px-3 py-2">
            <option value="">All Sales Reps</option>
            {users.map((u: any) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Job #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Contact</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Address</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Crew</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Squares</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Revenue</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="text-center py-12 text-gray-400">Loading...</td></tr>
                ) : jobs.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-gray-400">No jobs found</td></tr>
                ) : jobs.map((job) => (
                  <tr
                    key={job.id}
                    onClick={() => navigate(`/crm/jobs/${job.id}`)}
                    className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-700">
                      {job.jobNumber || `ROOF-${String(job.id).padStart(4, '0')}`}
                    </td>
                    <td className="px-4 py-3 text-gray-900">{job.contactName || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate">{job.address || job.propertyAddress || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${TYPE_COLORS[job.jobType] || 'bg-gray-100 text-gray-600'}`}>
                        {(job.jobType || 'retail').replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_COLORS[job.status] || 'bg-gray-100 text-gray-600'}`}>
                        {formatStatus(job.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{crewMap[job.crewId] || '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{job.totalSquares || '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">
                      {job.revenue != null || job.total != null
                        ? `$${Number(job.revenue || job.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {job.createdAt ? new Date(job.createdAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <p className="text-xs text-gray-500">Page {page} of {totalPages}</p>
              <div className="flex gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-blue-600" /> New Job
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Contact *</label>
                <select value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2">
                  <option value="">Select contact...</option>
                  {contacts.map((c: any) => <option key={c.id} value={c.id}>{c.name || `${c.firstName} ${c.lastName}`}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Job Type</label>
                <select value={form.jobType} onChange={(e) => setForm({ ...form, jobType: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2">
                  {JOB_TYPES.map((t) => <option key={t} value={t}>{formatStatus(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Address</label>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">City</label>
                  <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">State</label>
                  <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Zip</label>
                  <input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Roof Type</label>
                  <input value={form.roofType} onChange={(e) => setForm({ ...form, roofType: e.target.value })} placeholder="e.g. Asphalt Shingle" className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Stories</label>
                  <input type="number" value={form.stories} onChange={(e) => setForm({ ...form, stories: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create Job'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
