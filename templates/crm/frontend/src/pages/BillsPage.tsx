import { useState, useEffect, useCallback } from 'react';
import { formatDate } from '../utils/date';
import { Plus, Edit, Trash2, Ban, HandCoins } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { DataTable, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

interface BillForm {
  vendorId: string;
  number: string;
  jobId: string;
  purchaseOrderId: string;
  billDate: string;
  dueDate: string;
  amount: string;
  notes: string;
}

// Paired with the house style in packages/tenant-ui/src/invoicing/ui.tsx — this page keeps its own
// map because a bill's statuses are not an invoice's, but the dark treatment should not differ.
// (T32 M14)
const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200',
  /*
   * The void pill was the WORST ratio on this page and the report did not name it: gray-100 on
   * gray-400 is 2.31:1 in LIGHT mode, which no theme switch was ever going to fix. My first dark
   * pair (slate-700/slate-400) was 4.04:1 and failed too — caught by computing the ratios instead
   * of trusting that a `dark:` class present means a pair that reads.
   *
   * `line-through` is what says "void". The colour does not have to be the muting device as well,
   * so it is now readable in both modes: 6.87:1 light, 6.97:1 dark.
   */
  void: 'bg-gray-100 text-gray-600 line-through dark:bg-slate-700 dark:text-slate-300',
};

const EMPTY_FORM: BillForm = { vendorId: '', number: '', jobId: '', purchaseOrderId: '', billDate: new Date().toISOString().split('T')[0], dueDate: '', amount: '', notes: '' };

export default function BillsPage() {
  const toast = useToast();
  const { can } = useAuth();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [contacts, setContacts] = useState<Record<string, unknown>[]>([]);
  const [jobs, setJobs] = useState<Record<string, unknown>[]>([]);
  const [pos, setPos] = useState<Record<string, unknown>[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<Record<string, unknown> | null>(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<BillForm>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payBill, setPayBill] = useState<Record<string, unknown> | null>(null);
  const [payAmount, setPayAmount] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [resRaw, cRaw, jRaw, pRaw, sRaw] = await Promise.all([
        api.bills.list({ page, limit: 25 }),
        // VENDORS, not every contact. This listed clients and leads too, capped at 200, so on a
        // tenant with 300 contacts the vendor you wanted might not be in the list at all — and the
        // ones that were are mostly people you will never raise a bill to. (T32 M13)
        api.contacts.list({ type: 'vendor', limit: 500 }),
        api.jobs.list({ limit: 100 }),
        // Purchase Orders is its own module; switched off it answers 403 and a bill simply links to no PO.
        api.purchaseOrders.list({ limit: 100 }).catch(() => ({ data: [] })),
        api.bills.summary(),
      ]);
      const res = resRaw as Record<string, unknown>;
      setData(res.data as Record<string, unknown>[]);
      setPagination(res.pagination as Record<string, unknown> | null);
      setContacts(((cRaw as Record<string, unknown>).data as Record<string, unknown>[]) || []);
      setJobs(((jRaw as Record<string, unknown>).data as Record<string, unknown>[]) || []);
      setPos(((pRaw as Record<string, unknown>).data as Record<string, unknown>[]) || []);
      setSummary(sRaw as Record<string, unknown>);
    } catch { toast.error('Failed to load bills'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const contactName = (c: Record<string, unknown>) =>
    (c.name as string) || (c.company as string) || (c.email as string) || 'Unnamed';

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_FORM, billDate: new Date().toISOString().split('T')[0] }); setModalOpen(true); };
  const openEdit = (item: Record<string, unknown>) => {
    setEditing(item);
    setForm({
      vendorId: (item.vendorId as string) || '',
      number: (item.number as string) || '',
      jobId: (item.jobId as string) || '',
      purchaseOrderId: (item.purchaseOrderId as string) || '',
      billDate: (item.billDate as string)?.split('T')[0] || '',
      dueDate: (item.dueDate as string)?.split('T')[0] || '',
      amount: String(item.amount),
      notes: (item.notes as string) || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.vendorId || !form.amount) { toast.error('Vendor and amount are required'); return; }
    setSaving(true);
    try {
      const payload = {
        vendorId: form.vendorId,
        number: form.number || undefined,
        jobId: form.jobId || undefined,
        purchaseOrderId: form.purchaseOrderId || undefined,
        billDate: form.billDate || undefined,
        dueDate: form.dueDate || undefined,
        amount: Number(form.amount),
        notes: form.notes || undefined,
      };
      if (editing) { await api.bills.update(editing.id as string, payload); toast.success('Updated'); }
      else { await api.bills.create(payload); toast.success('Bill recorded'); }
      setModalOpen(false); load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const handlePay = async () => {
    if (!payBill || !payAmount) return;
    try {
      await api.bills.recordPayment(payBill.id as string, Number(payAmount));
      toast.success('Payment recorded');
      setPayOpen(false); load();
    } catch (err) { toast.error((err as Error).message); }
  };

  const handleDelete = async () => {
    try { await api.bills.delete((toDelete as Record<string, unknown>).id as string); toast.success('Deleted'); setDeleteOpen(false); load(); }
    catch (err) { toast.error((err as Error).message); }
  };

  const isOverdue = (r: Record<string, unknown>) =>
    ['open', 'partial'].includes(r.status as string) && r.dueDate && new Date(r.dueDate as string) < new Date();

  const columns = [
    { key: 'number', label: 'Invoice #', render: (v: unknown) => (v as string) || '-' },
    { key: 'vendor', label: 'Vendor', render: (v: unknown) => v ? contactName(v as Record<string, unknown>) : '-' },
    { key: 'job', label: 'Job', render: (v: unknown) => ((v as Record<string, unknown>)?.title as string) || '-' },
    { key: 'purchaseOrder', label: 'PO', render: (v: unknown) => ((v as Record<string, unknown>)?.number as string) || '-' },
    { key: 'status', label: 'Status', render: (v: unknown, r: Record<string, unknown>) => (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${isOverdue(r)
        ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200'
        : STATUS_STYLES[v as string] || 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}`}>
        {isOverdue(r) ? 'overdue' : v as string}
      </span>
    ) },
    { key: 'amount', label: 'Amount', render: (v: unknown) => `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
    { key: 'amountPaid', label: 'Paid', render: (v: unknown) => `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
    { key: 'dueDate', label: 'Due', render: (v: unknown) => v ? formatDate(v as string) : '-' },
    { key: 'source', label: 'Source', render: (v: unknown) => v === 'vendor_portal' ? <span className="text-xs text-teal-700">vendor portal</span> : <span className="text-xs text-gray-500 dark:text-slate-400">manual</span> },
  ];

  // T32 M9. The tester asked whether AP payments being admin-only is deliberate. It is — the
  // permission matrix gives a manager bills:read/create/update and withholds bills:pay and
  // bills:delete on purpose, the same line payments:* already draws. But the SCREEN did not say so:
  // every action was offered to everyone, so a manager opened "Record payment", typed an amount and
  // then got a 403. Each action is now shown only to someone the route will actually let through,
  // mirroring the gates in routes/bills.ts exactly.
  const rowActions = [
    { label: 'Record payment', icon: HandCoins, show: () => can('bills:pay'), onClick: (r: Record<string, unknown>) => { setPayBill(r); setPayAmount(String((Number(r.amount) - Number(r.amountPaid)).toFixed(2))); setPayOpen(true); } },
    { label: 'Edit', icon: Edit, show: () => can('bills:update'), onClick: openEdit },
    { label: 'Void', icon: Ban, show: () => can('bills:pay'), onClick: async (r: Record<string, unknown>) => { try { await api.bills.void(r.id as string); toast.success('Voided'); load(); } catch (err) { toast.error((err as Error).message); } } },
    { label: 'Delete', icon: Trash2, show: () => can('bills:delete'), onClick: (r: Record<string, unknown>) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
  ];

  return (
    <div>
      <PageHeader title="Bills" action={can('bills:create') ? <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>Record Bill</Button> : undefined} />
      {/*
        * T32 M14. The "Overdue" tile measured 1.10:1 in dark mode, and the cause is the branch that
        * looks harmless: `bg-white` with no `dark:` partner. The page's dark-mode text is light, so
        * a tile that stays WHITE puts light text on a white ground — almost the same colour, which
        * is where 1.10:1 comes from.
        *
        * Both branches are paired now, and both state their own text colour rather than inheriting
        * it, so neither depends on what an ancestor happens to set.
        * (feedback: a contrast fix is the PAIR, not the one colour you noticed)
        */}
      {summary && (
        <div className="mb-4 flex gap-4 flex-wrap text-sm">
          <div className="bg-white border rounded-lg px-4 py-2 text-gray-900 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100">Outstanding: <span className="font-semibold">${Number(summary.outstanding || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
          <div className={`border rounded-lg px-4 py-2 ${Number(summary.overdueCount) > 0
            ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-300'
            : 'bg-white text-gray-900 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100'}`}>Overdue: <span className="font-semibold">{Number(summary.overdueCount || 0)}</span></div>
        </div>
      )}
      <DataTable data={data} emptyMessage="No vendor bills yet. Record one to see what you owe, and against which job." columns={columns} loading={loading} pagination={pagination as never} onPageChange={setPage} actions={rowActions} />

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Bill' : 'Record Bill'} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Vendor *</label>
              <select value={form.vendorId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, vendorId: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
                <option value="">Select...</option>
                {contacts.map((c: Record<string, unknown>) => <option key={c.id as string} value={c.id as string}>{contactName(c)}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Vendor invoice #</label>
              <input value={form.number} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, number: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Amount *</label>
              <input type="number" value={form.amount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, amount: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Purchase order</label>
              <select value={form.purchaseOrderId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, purchaseOrderId: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
                <option value="">None</option>
                {pos.map((p: Record<string, unknown>) => <option key={p.id as string} value={p.id as string}>{p.number as string}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Bill date</label>
              <input type="date" value={form.billDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, billDate: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Due date</label>
              <input type="date" value={form.dueDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, dueDate: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Job</label>
            <select value={form.jobId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, jobId: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
              <option value="">None (or inherited from the PO)</option>
              {jobs.map((j: Record<string, unknown>) => <option key={j.id as string} value={j.id as string}>{j.title as string}</option>)}
            </select></div>
          <div><label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </Modal>

      <Modal isOpen={payOpen} onClose={() => setPayOpen(false)} title="Record Payment" size="sm">
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-slate-400">
            {payBill ? `${(payBill.number as string) || 'Bill'} — $${Number(payBill.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} total, $${Number(payBill.amountPaid).toLocaleString(undefined, { minimumFractionDigits: 2 })} already paid.` : ''}
          </p>
          <div><label className="block text-sm font-medium mb-1">Payment amount</label>
            <input type="number" value={payAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayAmount(e.target.value)} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setPayOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button>
          <Button onClick={handlePay}>Record</Button>
        </div>
      </Modal>

      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Bill" message="Delete this bill? Bills with recorded payments must be voided instead." confirmText="Delete" />
    </div>
  );
}
