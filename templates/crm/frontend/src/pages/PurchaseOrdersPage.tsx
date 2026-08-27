import { useState, useEffect, useCallback } from 'react';
import { formatDate } from '../utils/date';
import { Plus, Edit, Trash2, Send, PackageCheck, Ban, RotateCcw } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

interface Line { description: string; quantity: string; unitCost: string }
interface PoForm {
  vendorId: string;
  jobId: string;
  expectedDate: string;
  shipTo: string;
  taxRate: string;
  notes: string;
  lines: Line[];
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  acknowledged: 'bg-teal-100 text-teal-700',
  declined: 'bg-red-100 text-red-700',
  received: 'bg-amber-100 text-amber-700',
  billed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-400 line-through',
};

const EMPTY_LINE: Line = { description: '', quantity: '1', unitCost: '' };
const EMPTY_FORM: PoForm = { vendorId: '', jobId: '', expectedDate: '', shipTo: '', taxRate: '0', notes: '', lines: [{ ...EMPTY_LINE }] };

export default function PurchaseOrdersPage() {
  const toast = useToast();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [contacts, setContacts] = useState<Record<string, unknown>[]>([]);
  const [jobs, setJobs] = useState<Record<string, unknown>[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<Record<string, unknown> | null>(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<PoForm>({ ...EMPTY_FORM, lines: [{ ...EMPTY_LINE }] });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [resRaw, cRaw, jRaw, sRaw] = await Promise.all([
        api.purchaseOrders.list({ page, limit: 25 }),
        api.contacts.list({ limit: 200 }),
        api.jobs.list({ limit: 100 }),
        api.purchaseOrders.summary(),
      ]);
      const res = resRaw as Record<string, unknown>;
      setData(res.data as Record<string, unknown>[]);
      setPagination(res.pagination as Record<string, unknown> | null);
      setContacts(((cRaw as Record<string, unknown>).data as Record<string, unknown>[]) || []);
      setJobs(((jRaw as Record<string, unknown>).data as Record<string, unknown>[]) || []);
      setSummary(sRaw as Record<string, unknown>);
    } catch { toast.error('Failed to load purchase orders'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const contactName = (c: Record<string, unknown>) =>
    (c.name as string) || (c.company as string) || (c.email as string) || 'Unnamed';

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_FORM, lines: [{ ...EMPTY_LINE }] }); setModalOpen(true); };
  const openEdit = async (item: Record<string, unknown>) => {
    try {
      const full = await api.purchaseOrders.get(item.id as string) as Record<string, unknown>;
      setEditing(full);
      setForm({
        vendorId: (full.vendorId as string) || '',
        jobId: (full.jobId as string) || '',
        expectedDate: (full.expectedDate as string)?.split('T')[0] || '',
        shipTo: (full.shipTo as string) || '',
        taxRate: String(full.taxRate ?? '0'),
        notes: (full.notes as string) || '',
        lines: ((full.lines as Record<string, unknown>[]) || []).map(l => ({
          description: l.description as string,
          quantity: String(l.quantity),
          unitCost: String(l.unitCost),
        })),
      });
      setModalOpen(true);
    } catch (err) { toast.error((err as Error).message); }
  };

  const setLine = (i: number, patch: Partial<Line>) =>
    setForm(f => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) }));

  const formTotal = form.lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0) * (1 + (Number(form.taxRate) || 0) / 100);

  const handleSave = async () => {
    const lines = form.lines.filter(l => l.description.trim());
    if (!form.vendorId) { toast.error('Pick a vendor'); return; }
    if (!lines.length) { toast.error('At least one line item is required'); return; }
    setSaving(true);
    try {
      const payload = {
        vendorId: form.vendorId,
        jobId: form.jobId || undefined,
        expectedDate: form.expectedDate || undefined,
        shipTo: form.shipTo || undefined,
        taxRate: Number(form.taxRate) || 0,
        notes: form.notes || undefined,
        lines: lines.map(l => ({ description: l.description, quantity: Number(l.quantity) || 1, unitCost: Number(l.unitCost) || 0 })),
      };
      if (editing) { await api.purchaseOrders.update(editing.id as string, payload); toast.success('Updated'); }
      else { await api.purchaseOrders.create(payload); toast.success('Purchase order created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const transition = async (fn: (id: string) => Promise<unknown>, id: string, done: string) => {
    try { await fn(id); toast.success(done); load(); } catch (err) { toast.error((err as Error).message); }
  };

  const handleDelete = async () => {
    try { await api.purchaseOrders.delete((toDelete as Record<string, unknown>).id as string); toast.success('Deleted'); setDeleteOpen(false); load(); }
    catch (err) { toast.error((err as Error).message); }
  };

  const columns = [
    { key: 'number', label: 'PO #' },
    { key: 'vendor', label: 'Vendor', render: (v: unknown) => v ? contactName(v as Record<string, unknown>) : '-' },
    { key: 'job', label: 'Job', render: (v: unknown) => ((v as Record<string, unknown>)?.title as string) || '-' },
    { key: 'status', label: 'Status', render: (v: unknown) => <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[v as string] || 'bg-gray-100 text-gray-600'}`}>{v as string}</span> },
    { key: 'total', label: 'Total', render: (v: unknown) => `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
    { key: 'expectedDate', label: 'Expected', render: (v: unknown) => v ? formatDate(v as string) : '-' },
  ];

  const rowActions = [
    { label: 'Edit', icon: Edit, onClick: openEdit },
    { label: 'Send to vendor', icon: Send, onClick: (r: Record<string, unknown>) => transition(api.purchaseOrders.send, r.id as string, 'Sent — the vendor can now see it in their portal') },
    { label: 'Mark received', icon: PackageCheck, onClick: (r: Record<string, unknown>) => transition(api.purchaseOrders.receive, r.id as string, 'Marked received') },
    { label: 'Cancel', icon: Ban, onClick: (r: Record<string, unknown>) => transition(api.purchaseOrders.cancel, r.id as string, 'Cancelled') },
    { label: 'Reopen', icon: RotateCcw, onClick: (r: Record<string, unknown>) => transition(api.purchaseOrders.reopen, r.id as string, 'Back to draft') },
    { label: 'Delete', icon: Trash2, onClick: (r: Record<string, unknown>) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
  ];

  return (
    <div>
      <PageHeader title="Purchase Orders" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>New PO</Button>} />
      {summary && (
        <div className="mb-4 flex gap-4 flex-wrap text-sm">
          <div className="bg-white border rounded-lg px-4 py-2 dark:bg-slate-900">Open committed: <span className="font-semibold">${Number(summary.openCommitted || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
          {(summary.byStatus as Record<string, { count: number }> | undefined) && Object.entries(summary.byStatus as Record<string, { count: number }>).map(([s, v]) => (
            <div key={s} className="bg-white border rounded-lg px-4 py-2 capitalize dark:bg-slate-900">{s}: <span className="font-semibold">{v.count}</span></div>
          ))}
        </div>
      )}
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination as never} onPageChange={setPage} actions={rowActions} />

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.number}` : 'New Purchase Order'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Vendor *</label>
              <select value={form.vendorId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, vendorId: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
                <option value="">Select...</option>
                {contacts.map((c: Record<string, unknown>) => <option key={c.id as string} value={c.id as string}>{contactName(c)}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Job</label>
              <select value={form.jobId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, jobId: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
                <option value="">None</option>
                {jobs.map((j: Record<string, unknown>) => <option key={j.id as string} value={j.id as string}>{j.title as string}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Expected date</label>
              <input type="date" value={form.expectedDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, expectedDate: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Tax rate %</label>
              <input type="number" value={form.taxRate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, taxRate: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Ship to</label>
            <input value={form.shipTo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, shipTo: e.target.value })} placeholder="Job site address" className="w-full px-3 py-2 border rounded-lg" /></div>

          <div>
            <label className="block text-sm font-medium mb-1">Line items *</label>
            <div className="space-y-2">
              {form.lines.map((l, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <input value={l.description} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLine(i, { description: e.target.value })} placeholder="Description" className="flex-1 px-3 py-2 border rounded-lg" />
                  <input type="number" value={l.quantity} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLine(i, { quantity: e.target.value })} placeholder="Qty" className="w-20 px-3 py-2 border rounded-lg" />
                  <input type="number" value={l.unitCost} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLine(i, { unitCost: e.target.value })} placeholder="Unit $" className="w-28 px-3 py-2 border rounded-lg" />
                  <button onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }))} disabled={form.lines.length === 1} className="p-2 text-gray-400 hover:text-red-600 disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
            <button onClick={() => setForm(f => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] }))} className="mt-2 text-sm text-blue-600 hover:underline">+ Add line</button>
          </div>

          <div><label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="text-right text-sm text-gray-600 dark:text-slate-400">Total with tax: <span className="font-semibold text-gray-900 dark:text-slate-100">${formTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Purchase Order" message="Delete this draft purchase order?" confirmText="Delete" />
    </div>
  );
}
