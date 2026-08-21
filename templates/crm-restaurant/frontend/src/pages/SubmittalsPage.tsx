/**
 * Submittals Page — Construction tier
 *
 * Shop drawings, product data, samples, mockups. The contractor submits
 * these to the architect/owner for approval before ordering materials.
 */
import { useState, useEffect } from 'react';
import { FileText, Plus, Check, X, RotateCcw, Loader2 } from 'lucide-react';
import api from '../services/api';

interface Submittal {
  id: string;
  number: string;
  subject: string;
  specSection?: string;
  submittalType: string;
  priority: string;
  status: string;
  dueDate?: string;
  assignedTo?: string;
  reviewNotes?: string;
  createdAt: string;
  project?: { id: string; name: string };
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  revise_resubmit: 'bg-yellow-100 text-yellow-700',
  rejected: 'bg-red-100 text-red-700',
};

const TYPE_LABELS: Record<string, string> = {
  shop_drawing: 'Shop Drawing',
  product_data: 'Product Data',
  sample: 'Sample',
  mockup: 'Mockup',
  other: 'Other',
};

export default function SubmittalsPage() {
  const [submittals, setSubmittals] = useState<Submittal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);

  const [form, setForm] = useState({
    projectId: '',
    subject: '',
    specSection: '',
    description: '',
    submittalType: 'product_data',
    priority: 'normal',
    dueDate: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [{ data }, projRes] = await Promise.all([
        api.get('/api/submittals'),
        api.get('/api/projects'),
      ]);
      setSubmittals(data || []);
      setProjects(projRes.data || projRes || []);
    } catch (e) {
      console.error('Failed to load submittals', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/api/submittals', form);
    setShowCreate(false);
    setForm({ projectId: '', subject: '', specSection: '', description: '', submittalType: 'product_data', priority: 'normal', dueDate: '' });
    loadData();
  };

  const runAction = async (id: string, action: string) => {
    const notes = action === 'approve' ? undefined : prompt(`Notes for ${action}:`) || undefined;
    await api.post(`/api/submittals/${id}/${action}`, { notes });
    loadData();
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileText className="w-6 h-6 text-orange-500" />Submittals</h1>
          <p className="text-sm text-gray-500 mt-1">Shop drawings, product data, samples, mockups</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2"><Plus className="w-4 h-4" />New Submittal</button>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3">Number</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Spec §</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {submittals.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">No submittals yet. Click "New Submittal" to create one.</td></tr>
            ) : submittals.map((s) => (
              <tr key={s.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-sm">{s.number}</td>
                <td className="px-4 py-3 font-medium">{s.subject}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{s.project?.name || '—'}</td>
                <td className="px-4 py-3 text-sm">{TYPE_LABELS[s.submittalType] || s.submittalType}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{s.specSection || '—'}</td>
                <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[s.status] || 'bg-gray-100'}`}>{s.status.replace('_', ' ')}</span></td>
                <td className="px-4 py-3 text-sm text-gray-500">{s.dueDate ? new Date(s.dueDate).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {s.status === 'draft' && <button onClick={() => runAction(s.id, 'submit')} className="text-blue-600 hover:bg-blue-50 p-1 rounded" title="Submit for review"><Plus className="w-4 h-4 rotate-45" /></button>}
                    {s.status === 'submitted' && (<>
                      <button onClick={() => runAction(s.id, 'approve')} className="text-green-600 hover:bg-green-50 p-1 rounded" title="Approve"><Check className="w-4 h-4" /></button>
                      <button onClick={() => runAction(s.id, 'revise')} className="text-yellow-600 hover:bg-yellow-50 p-1 rounded" title="Revise and resubmit"><RotateCcw className="w-4 h-4" /></button>
                      <button onClick={() => runAction(s.id, 'reject')} className="text-red-600 hover:bg-red-50 p-1 rounded" title="Reject"><X className="w-4 h-4" /></button>
                    </>)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">New Submittal</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Project</label>
                <select required value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className="w-full border rounded-lg px-3 py-2">
                  <option value="">Select project...</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Subject</label>
                <input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="w-full border rounded-lg px-3 py-2" placeholder="e.g., HVAC shop drawings" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Spec Section</label>
                  <input value={form.specSection} onChange={(e) => setForm({ ...form, specSection: e.target.value })} className="w-full border rounded-lg px-3 py-2" placeholder="23 05 00" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Type</label>
                  <select value={form.submittalType} onChange={(e) => setForm({ ...form, submittalType: e.target.value })} className="w-full border rounded-lg px-3 py-2">
                    {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Priority</label>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full border rounded-lg px-3 py-2">
                    <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Due Date</label>
                  <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
