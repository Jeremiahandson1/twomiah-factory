import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Send, Trophy, XCircle } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const bidTypes = ['lump_sum', 'unit_price', 'cost_plus', 'gmp', 'design_build'];

export default function BidsPage() {
  const toast = useToast();
  const [data, setData] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ projectName: '', client: '', bidType: 'lump_sum', dueDate: '', estimatedValue: '', bidAmount: '', bondRequired: false, scope: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, statsRes] = await Promise.all([api.bids.list({ page, limit: 25 }), api.bids.stats()]);
      setData(res.data); setPagination(res.pagination); setStats(statsRes);
    } catch (err) { toast.error('Failed to load bids'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.projectName) { toast.error('Project name required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : undefined, bidAmount: form.bidAmount ? Number(form.bidAmount) : undefined };
      if (editing) { await api.bids.update(editing.id, payload); toast.success('Updated'); }
      else { await api.bids.create(payload); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.bids.delete(toDelete.id); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error(err.message); } };
  const handleSubmit = async (bid) => { try { await api.bids.submit(bid.id); toast.success('Submitted'); load(); } catch (err) { toast.error(err.message); } };
  const handleWon = async (bid) => { try { await api.bids.won(bid.id); toast.success('Marked as won!'); load(); } catch (err) { toast.error(err.message); } };
  const handleLost = async (bid) => { try { await api.bids.lost(bid.id); toast.success('Marked as lost'); load(); } catch (err) { toast.error(err.message); } };

  const openCreate = () => { setEditing(null); setForm({ projectName: '', client: '', bidType: 'lump_sum', dueDate: '', estimatedValue: '', bidAmount: '', bondRequired: false, scope: '', notes: '' }); setModalOpen(true); };
  const openEdit = (item) => { setEditing(item); setForm({ projectName: item.projectName, client: item.client || '', bidType: item.bidType, dueDate: item.dueDate?.split('T')[0] || '', estimatedValue: item.estimatedValue?.toString() || '', bidAmount: item.bidAmount?.toString() || '', bondRequired: item.bondRequired, scope: item.scope || '', notes: item.notes || '' }); setModalOpen(true); };

  const columns = [
    { key: 'number', label: '#', render: (v) => <span className="font-mono text-sm">{v}</span> },
    { key: 'projectName', label: 'Project', render: (v, r) => <div><p className="font-medium">{v}</p>{r.client && <p className="text-sm text-gray-500">{r.client}</p>}</div> },
    { key: 'status', label: 'Status', render: (v) => <StatusBadge status={v} statusColors={{ draft: 'bg-gray-100 text-gray-700', submitted: 'bg-blue-100 text-blue-700', under_review: 'bg-yellow-100 text-yellow-700', won: 'bg-green-100 text-green-700', lost: 'bg-red-100 text-red-700' }} /> },
    { key: 'bidAmount', label: 'Bid Amount', render: (v) => v ? `$${Number(v).toLocaleString()}` : '-' },
    { key: 'dueDate', label: 'Due Date', render: (v) => v ? new Date(v).toLocaleDateString() : '-' },
    { key: 'bondRequired', label: 'Bond', render: (v) => v ? <span className="text-orange-600">Yes</span> : '-' },
  ];

  return (
    <div>
      <PageHeader title="Bids" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>New Bid</Button>} />
      
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow-sm"><p className="text-2xl font-bold">{stats.total}</p><p className="text-sm text-gray-500">Total Bids</p></div>
          <div className="bg-white p-4 rounded-lg shadow-sm"><p className="text-2xl font-bold text-blue-600">{stats.submitted || 0}</p><p className="text-sm text-gray-500">Submitted</p></div>
          <div className="bg-white p-4 rounded-lg shadow-sm"><p className="text-2xl font-bold text-green-600">{stats.won || 0}</p><p className="text-sm text-gray-500">Won</p></div>
          <div className="bg-white p-4 rounded-lg shadow-sm"><p className="text-2xl font-bold text-orange-600">${(stats.pipelineValue || 0).toLocaleString()}</p><p className="text-sm text-gray-500">Pipeline</p></div>
          <div className="bg-white p-4 rounded-lg shadow-sm"><p className="text-2xl font-bold">{stats.winRate || 0}%</p><p className="text-sm text-gray-500">Win Rate</p></div>
        </div>
      )}

      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[
        { label: 'Edit', icon: Edit, onClick: openEdit },
        { label: 'Submit', icon: Send, onClick: handleSubmit },
        { label: 'Won', icon: Trophy, onClick: handleWon },
        { label: 'Lost', icon: XCircle, onClick: handleLost },
        { label: 'Delete', icon: Trash2, onClick: (r) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
      ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Bid' : 'New Bid'} size="lg">
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Project Name *</label><input value={form.projectName} onChange={(e) => setForm({...form, projectName: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Client</label><input value={form.client} onChange={(e) => setForm({...form, client: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium mb-1">Bid Type</label><select value={form.bidType} onChange={(e) => setForm({...form, bidType: e.target.value})} className="w-full px-3 py-2 border rounded-lg">{bidTypes.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></div>
            <div><label className="block text-sm font-medium mb-1">Due Date</label><input type="date" value={form.dueDate} onChange={(e) => setForm({...form, dueDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div className="flex items-end"><label className="flex items-center gap-2"><input type="checkbox" checked={form.bondRequired} onChange={(e) => setForm({...form, bondRequired: e.target.checked})} className="rounded" /><span className="text-sm">Bond Required</span></label></div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Estimated Value</label><input type="number" value={form.estimatedValue} onChange={(e) => setForm({...form, estimatedValue: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Bid Amount</label><input type="number" value={form.bidAmount} onChange={(e) => setForm({...form, bidAmount: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Scope</label><textarea value={form.scope} onChange={(e) => setForm({...form, scope: e.target.value})} rows={3} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Notes</label><textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Bid" message={`Delete ${toDelete?.number}?`} confirmText="Delete" />
    </div>
  );
}
