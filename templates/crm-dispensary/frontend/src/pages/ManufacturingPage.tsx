import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Factory, Play, CheckCircle, XCircle, Clock, FlaskConical, BarChart3 } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const jobTypes = [
  { value: '', label: 'All Types' },
  { value: 'extraction', label: 'Extraction' },
  { value: 'infusion', label: 'Infusion' },
  { value: 'distillation', label: 'Distillation' },
  { value: 'pressing', label: 'Pressing' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'other', label: 'Other' },
];

const jobStatuses = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

const typeColors: Record<string, string> = {
  extraction: 'bg-blue-100 text-blue-700',
  infusion: 'bg-purple-100 text-purple-700',
  distillation: 'bg-indigo-100 text-indigo-700',
  pressing: 'bg-amber-100 text-amber-700',
  packaging: 'bg-green-100 text-green-700',
  other: 'bg-gray-100 text-gray-700',
};

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export default function ManufacturingPage() {
  const toast = useToast();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<any>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    type: 'extraction', inputBatches: '', method: '', equipment: '', operator: '', notes: '',
  });
  const [completeData, setCompleteData] = useState({
    outputBatch: '', outputWeight: '', outputNotes: '',
  });

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (search) params.search = search;
      if (typeFilter) params.type = typeFilter;
      if (statusFilter) params.status = statusFilter;
      const data = await api.get('/api/manufacturing/jobs', params);
      setJobs(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch {
      toast.error('Failed to load manufacturing jobs');
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter, statusFilter]);

  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => { setPage(1); }, [search, typeFilter, statusFilter]);
  useEffect(() => {
    api.get('/api/manufacturing/stats').then(setStats).catch(() => {});
  }, []);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const batches = formData.inputBatches.split(',').map(b => b.trim()).filter(Boolean);
      await api.post('/api/manufacturing/jobs', {
        type: formData.type,
        inputBatches: batches,
        method: formData.method || undefined,
        equipment: formData.equipment || undefined,
        operator: formData.operator || undefined,
        notes: formData.notes || undefined,
      });
      toast.success('Manufacturing job created');
      setCreateModalOpen(false);
      setFormData({ type: 'extraction', inputBatches: '', method: '', equipment: '', operator: '', notes: '' });
      loadJobs();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create job');
    } finally {
      setSaving(false);
    }
  };

  const handleStartJob = async (job: any) => {
    try {
      await api.post(`/api/manufacturing/jobs/${job.id}/start`);
      toast.success('Job started');
      loadJobs();
    } catch (err: any) {
      toast.error(err.message || 'Failed to start job');
    }
  };

  const openCompleteModal = (job: any) => {
    setSelectedJob(job);
    setCompleteData({ outputBatch: '', outputWeight: '', outputNotes: '' });
    setCompleteModalOpen(true);
  };

  const handleComplete = async () => {
    if (!selectedJob) return;
    setSaving(true);
    try {
      await api.post(`/api/manufacturing/jobs/${selectedJob.id}/complete`, {
        outputBatch: completeData.outputBatch || undefined,
        outputWeight: completeData.outputWeight ? parseFloat(completeData.outputWeight) : undefined,
        notes: completeData.outputNotes || undefined,
      });
      toast.success('Job completed');
      setCompleteModalOpen(false);
      loadJobs();
    } catch (err: any) {
      toast.error(err.message || 'Failed to complete job');
    } finally {
      setSaving(false);
    }
  };

  const handleFail = async (job: any) => {
    try {
      await api.post(`/api/manufacturing/jobs/${job.id}/fail`);
      toast.success('Job marked as failed');
      loadJobs();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update job');
    }
  };

  const openDetail = (job: any) => {
    setSelectedJob(job);
    setDetailModalOpen(true);
  };

  const columns = [
    { key: 'jobNumber', label: 'Job #', render: (val: string) => <span className="font-mono font-medium text-gray-900">{val || '--'}</span> },
    { key: 'type', label: 'Type', render: (val: string) => <span className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${typeColors[val] || 'bg-gray-100 text-gray-700'}`}>{val}</span> },
    { key: 'status', label: 'Status', render: (val: string) => <StatusBadge status={val} statusColors={statusColors} /> },
    { key: 'inputBatches', label: 'Input Batches', render: (val: any) => {
      const batches = Array.isArray(val) ? val : [];
      return batches.length > 0 ? <span className="text-sm text-gray-700">{batches.join(', ')}</span> : <span className="text-gray-400">--</span>;
    }},
    { key: 'method', label: 'Method', render: (val: string) => val || <span className="text-gray-400">--</span> },
    { key: 'operator', label: 'Operator', render: (val: string) => val || <span className="text-gray-400">--</span> },
    { key: 'startedAt', label: 'Started', render: (val: string) => val ? new Date(val).toLocaleDateString() : <span className="text-gray-400">--</span> },
    { key: 'yield', label: 'Yield', render: (val: number, row: any) => {
      if (row.outputWeight && row.inputWeight) {
        const yieldPct = ((row.outputWeight / row.inputWeight) * 100).toFixed(1);
        return <span className="font-medium text-gray-900">{yieldPct}%</span>;
      }
      return <span className="text-gray-400">--</span>;
    }},
  ];

  const actions = [
    { label: 'View Details', icon: FlaskConical, onClick: openDetail },
    { label: 'Start Job', icon: Play, onClick: handleStartJob },
    { label: 'Complete', icon: CheckCircle, onClick: openCompleteModal },
    { label: 'Mark Failed', icon: XCircle, onClick: handleFail, className: 'text-red-600' },
  ];

  return (
    <div>
      <PageHeader
        title="Manufacturing"
        subtitle="Processing and extraction jobs"
        action={
          <Button onClick={() => { setFormData({ type: 'extraction', inputBatches: '', method: '', equipment: '', operator: '', notes: '' }); setCreateModalOpen(true); }}>
            <Plus className="w-4 h-4 mr-2 inline" />Create Job
          </Button>
        }
      />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-500">In Progress</p>
            <p className="text-2xl font-bold text-blue-600">{stats.inProgress || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-500">Avg Yield</p>
            <p className="text-2xl font-bold text-green-600">{stats.avgYield ? `${stats.avgYield}%` : '--'}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-500">Completed This Week</p>
            <p className="text-2xl font-bold text-gray-900">{stats.completedThisWeek || 0}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search jobs..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500">
          {jobTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500">
          {jobStatuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <DataTable data={jobs} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={actions} onRowClick={openDetail} emptyMessage="No manufacturing jobs found" />

      {/* Create Job Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Create Manufacturing Job" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Job Type *</label>
            <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500">
              {jobTypes.filter(t => t.value).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Input Batches (comma-separated)</label>
            <input type="text" value={formData.inputBatches} onChange={(e) => setFormData({ ...formData, inputBatches: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="BATCH-001, BATCH-002" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Method</label>
              <input type="text" value={formData.method} onChange={(e) => setFormData({ ...formData, method: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="CO2 Extraction" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Equipment</label>
              <input type="text" value={formData.equipment} onChange={(e) => setFormData({ ...formData, equipment: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Apeks Supercritical" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Operator</label>
            <input type="text" value={formData.operator} onChange={(e) => setFormData({ ...formData, operator: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
            <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setCreateModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? 'Creating...' : 'Create Job'}</Button>
        </div>
      </Modal>

      {/* Job Detail Modal */}
      <Modal isOpen={detailModalOpen} onClose={() => setDetailModalOpen(false)} title={`Job ${selectedJob?.jobNumber || ''}`} size="lg">
        {selectedJob && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-400">Type</p>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${typeColors[selectedJob.type] || 'bg-gray-100 text-gray-700'}`}>{selectedJob.type}</span>
              </div>
              <div>
                <p className="text-sm text-slate-400">Status</p>
                <StatusBadge status={selectedJob.status} statusColors={statusColors} />
              </div>
              <div>
                <p className="text-sm text-slate-400">Method</p>
                <p className="text-white">{selectedJob.method || '--'}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Equipment</p>
                <p className="text-white">{selectedJob.equipment || '--'}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Operator</p>
                <p className="text-white">{selectedJob.operator || '--'}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Yield</p>
                <p className="text-white">{selectedJob.outputWeight && selectedJob.inputWeight ? `${((selectedJob.outputWeight / selectedJob.inputWeight) * 100).toFixed(1)}%` : '--'}</p>
              </div>
            </div>

            <div>
              <p className="text-sm text-slate-400 mb-2">Input Batches</p>
              <div className="flex flex-wrap gap-2">
                {(Array.isArray(selectedJob.inputBatches) ? selectedJob.inputBatches : []).map((b: string, i: number) => (
                  <span key={i} className="px-2 py-1 bg-slate-800 rounded text-sm text-slate-300 font-mono">{b}</span>
                ))}
                {(!selectedJob.inputBatches || selectedJob.inputBatches.length === 0) && <span className="text-slate-500">No input batches</span>}
              </div>
            </div>

            {selectedJob.outputBatch && (
              <div>
                <p className="text-sm text-slate-400 mb-1">Output Batch</p>
                <span className="px-2 py-1 bg-green-900/30 text-green-400 rounded text-sm font-mono">{selectedJob.outputBatch}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-400">Input Weight</p>
                <p className="text-white">{selectedJob.inputWeight ? `${selectedJob.inputWeight}g` : '--'}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Output Weight</p>
                <p className="text-white">{selectedJob.outputWeight ? `${selectedJob.outputWeight}g` : '--'}</p>
              </div>
            </div>

            {selectedJob.notes && (
              <div>
                <p className="text-sm text-slate-400 mb-1">Quality Notes</p>
                <p className="text-slate-300 text-sm">{selectedJob.notes}</p>
              </div>
            )}

            {/* Timeline */}
            <div>
              <p className="text-sm text-slate-400 mb-2">Timeline</p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-slate-300">
                  <Clock className="w-4 h-4 text-slate-500" />
                  <span>Created: {selectedJob.createdAt ? new Date(selectedJob.createdAt).toLocaleString() : '--'}</span>
                </div>
                {selectedJob.startedAt && (
                  <div className="flex items-center gap-2 text-slate-300">
                    <Play className="w-4 h-4 text-blue-500" />
                    <span>Started: {new Date(selectedJob.startedAt).toLocaleString()}</span>
                  </div>
                )}
                {selectedJob.completedAt && (
                  <div className="flex items-center gap-2 text-slate-300">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span>Completed: {new Date(selectedJob.completedAt).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Complete Job Modal */}
      <Modal isOpen={completeModalOpen} onClose={() => setCompleteModalOpen(false)} title="Complete Job" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Output Batch ID</label>
            <input type="text" value={completeData.outputBatch} onChange={(e) => setCompleteData({ ...completeData, outputBatch: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="OUT-BATCH-001" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Output Weight (g)</label>
            <input type="number" step="0.01" value={completeData.outputWeight} onChange={(e) => setCompleteData({ ...completeData, outputWeight: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="250" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
            <textarea value={completeData.outputNotes} onChange={(e) => setCompleteData({ ...completeData, outputNotes: e.target.value })} rows={3} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setCompleteModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleComplete} disabled={saving}>{saving ? 'Completing...' : 'Complete Job'}</Button>
        </div>
      </Modal>
    </div>
  );
}
