import { useState, useEffect, useCallback } from 'react';
import { formatDate } from '../utils/date';
import { Plus, Edit, Trash2, Send, Check, X as XIcon, FileText } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

/**
 * Money, with the sign in FRONT of the currency and always two decimals. (T32 L2)
 *
 * Change-order totals printed as "$-615": `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` puts the minus inside the
 * amount, and on a credit line — which is now a routine thing to enter (T32 H5) — that reads as a
 * typo rather than as money coming back off. It also dropped the cents, so $615.50 showed as $615.5.
 */
const asMoney = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// While a row is being typed, quantity and unitPrice hold TEXT; they become numbers once, in
// handleSave. Coercing on every keystroke drops a minus sign in silence — a lone "-" reads back as ""
// from a number input, Number("") is 0, React writes that 0 into the field and the digits that follow
// land beside it, so -15 is stored as 15. The same shape is allowed here for rows read back from the
// API, which really are numbers. (roof T18 L7, same defect)
const num0 = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

interface LineItem {
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  [key: string]: unknown;
}

interface ChangeOrderForm {
  title: string;
  description: string;
  projectId: string;
  reason: string;
  daysAdded: number | string;
  lineItems: LineItem[];
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * WHICH STATUS EACH ACTION IS ACTUALLY ALLOWED FROM. (T41 contractor)
 *
 *   "Signed or approved COs still show Edit, Submit, Approve, Reject and Delete for owner and
 *    manager (the server refuses each with 400)."
 *
 * The permission was already asked — `can('change-orders:update')` — and that is the wrong question
 * on its own: an owner holds the permission for an approved change order too, and the server still
 * refuses, correctly, because an approved change order is a signed agreement. So five menu items sat
 * on every row for a row where none of them could work, and the only feedback was a toast.
 *
 * These four lists are COPIES of backend/src/routes/changeOrders.ts lines 45-48, which is the
 * authority — and `scripts/check-change-order-status-lists.ts` fails the build if the two ever
 * disagree, so the copy cannot rot. Delete uses EDITABLE, the same list the server's delete checks.
 *
 * The lists are the server's, including `pending` as a synonym for `submitted` (what the selections
 * flow used to stamp) — the file over there explains why.
 */
const EDITABLE = ['draft', 'submitted', 'rejected', 'pending'];
const SUBMITTABLE = ['draft', 'rejected'];
const APPROVABLE = ['submitted', 'pending'];
const REJECTABLE = ['draft', 'submitted', 'pending'];
const statusOf = (row: Record<string, unknown>) => String(row.status ?? '');

export default function ChangeOrdersPage() {
  const toast = useToast();
  const { can } = useAuth();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [projects, setProjects] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  /** The same modal, opened to READ a change order no longer open to editing. (T41) */
  const [readOnly, setReadOnly] = useState(false);
  const [form, setForm] = useState<ChangeOrderForm>({ title: '', description: '', projectId: '', reason: '', daysAdded: '0', lineItems: [{ description: '', quantity: '1', unitPrice: '' }] });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Projects is its own module; switched off it answers 403 and the page simply offers no project.
      const [resRaw, projResRaw] = await Promise.all([api.changeOrders.list({ page, limit: 25 }), api.projects.list({ limit: 100 }).catch(() => ({ data: [] }))]);
      const res = resRaw as Record<string, unknown>; const projRes = projResRaw as Record<string, unknown>;
      setData(res.data as Record<string, unknown>[]); setPagination(res.pagination as PaginationData | null); setProjects(projRes.data as Record<string, unknown>[]);
    } catch (err) { toast.error('Failed to load change orders'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const calcTotal = () => form.lineItems.reduce((s: number, li: LineItem) => s + (num0(li.quantity) * num0(li.unitPrice)), 0);

  const handleSave = async () => {
    if (!form.title || !form.projectId) { toast.error('Title and project required'); return; }
    // Text becomes numbers here, once. daysAdded is deliberately allowed to be negative — a change
    // order can shorten a schedule as well as extend it, which is precisely the sign the old
    // on-keystroke Number() threw away.
    const lineItems = form.lineItems
      .filter((li: LineItem) => String(li.description || '').trim())
      .map((li: LineItem) => ({ ...li, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) }));
    /**
     * A CREDIT IS A NEGATIVE LINE, AND IT IS ROUTINE. (T32 H5)
     *
     * This refused `unitPrice < 0` with "Quantity and price must be zero or more", so a deductive
     * change order — "Credit: laminate counter, −$615", the client dropping something out of the
     * scope — could not be typed in at all. The API has always accepted it (the report entered
     * CO-002 at −$615.00 straight through), so the screen was the only thing stopping normal
     * paperwork. `daysAdded` was already allowed to go negative for exactly this reason, two lines
     * above.
     *
     * What is still refused is a line that is not a number, and a NEGATIVE QUANTITY: "−2 counters at
     * $615" and "2 counters at −$615" are the same money, and allowing both ways to write it makes
     * two rows that look different and net the same. The price carries the sign.
     */
    if (lineItems.some((li) => !Number.isFinite(li.quantity) || !Number.isFinite(li.unitPrice))) {
      toast.error('Quantity and price must be numbers'); return;
    }
    if (lineItems.some((li) => li.quantity < 0)) {
      toast.error('Quantity cannot be negative — for a credit, put the minus sign on the price'); return;
    }
    const daysAdded = Number(form.daysAdded);
    if (!Number.isFinite(daysAdded)) { toast.error('Days added must be a number'); return; }
    setSaving(true);
    try {
      const payload = { ...form, daysAdded, lineItems };
      if (editing) { await api.changeOrders.update(editing.id as string, payload); toast.success('Updated'); }
      else { await api.changeOrders.create(payload); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.changeOrders.delete((toDelete as Record<string, unknown>).id as string); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error((err as Error).message); } };
  const handleSubmit = async (co: Record<string, unknown>) => { try { await api.changeOrders.submit(co.id as string); toast.success('Submitted'); load(); } catch (err) { toast.error((err as Error).message); } };
  // No `approvedBy` in the body any more: the server records the signed-in user. Sending the literal
  // string "Current User" is what made that field useless on every change order ever approved. (T32 H2)
  const handleApprove = async (co: Record<string, unknown>) => { try { await api.changeOrders.approve(co.id as string, {}); toast.success('Approved'); load(); } catch (err) { toast.error((err as Error).message); } };
  const handleReject = async (co: Record<string, unknown>) => { try { await api.changeOrders.reject(co.id as string); toast.success('Rejected'); load(); } catch (err) { toast.error((err as Error).message); } };

  const addLineItem = () => setForm({ ...form, lineItems: [...form.lineItems, { description: '', quantity: '1', unitPrice: '' }] });
  const updateLineItem = (idx: number, field: string, val: string | number) => { const items = [...form.lineItems]; (items[idx] as Record<string, unknown>)[field] = val; setForm({ ...form, lineItems: items }); };
  const removeLineItem = (idx: number) => setForm({ ...form, lineItems: form.lineItems.filter((_: LineItem, i: number) => i !== idx) });

  const fill = (item: Record<string, unknown>) => setForm({ title: item.title as string, description: (item.description as string) || '', projectId: item.projectId as string, reason: (item.reason as string) || '', daysAdded: String((item.daysAdded as number) ?? 0), lineItems: (item.lineItems as LineItem[])?.length ? (item.lineItems as LineItem[]).map((li: LineItem) => ({ description: li.description, quantity: String(li.quantity ?? ''), unitPrice: String(li.unitPrice ?? '') })) : [{ description: '', quantity: '1', unitPrice: '' }] });
  const openCreate = () => { setEditing(null); setReadOnly(false); setForm({ title: '', description: '', projectId: '', reason: '', daysAdded: '0', lineItems: [{ description: '', quantity: '1', unitPrice: '' }] }); setModalOpen(true); };
  const openEdit = (item: Record<string, unknown>) => { setEditing(item); setReadOnly(false); fill(item); setModalOpen(true); };

  /**
   * AN APPROVED CHANGE ORDER COULD NOT BE OPENED AT ALL. (T41 contractor: "no CO detail route")
   *
   * This page's only view of a change order's contents is the Edit modal, and Edit is correctly
   * limited to the statuses the server will accept an edit for. So the moment a CO was approved or
   * signed — the moment it became the agreement that matters — its line items, its reason and its
   * signature were unreachable from the screen. The list carries the total and nothing else.
   *
   * That is worse now, not better, than before this round: the list no longer ships the signature
   * image, IP and user-agent to every seat, so the detail is the only place that evidence can be
   * read, and there was no detail.
   *
   * A read-only open of the same modal rather than a new route, because this page has never had
   * one and a modal is what the rest of it uses. Everything is disabled, Save is gone, and the
   * signature block below is shown — so the person approving can read what they are signing off.
   */
  const openView = (item: Record<string, unknown>) => { setEditing(item); setReadOnly(true); fill(item); setModalOpen(true); };

  const columns = [
    { key: 'number', label: '#', render: (v: unknown) => <span className="font-mono text-sm">{v as string}</span> },
    { key: 'title', label: 'Title', render: (v: unknown) => <span className="font-medium">{v as string}</span> },
    { key: 'project', label: 'Project', render: (v: unknown) => (v as Record<string, unknown>)?.name as string || '-' },
    { key: 'status', label: 'Status', render: (v: unknown) => <StatusBadge status={v as string} /> },
    { key: 'amount', label: 'Amount', render: (v: unknown) => asMoney(Number(v)) },
    { key: 'daysAdded', label: 'Days', render: (v: unknown) => v ? `+${v}` : '-' },
    { key: 'signedBy', label: 'Signed', render: (v: unknown, row: Record<string, unknown>) => v ? <span className="text-green-700 text-sm dark:text-green-300">{v as string}{row.signedAt ? ` \u00b7 ${formatDate(row.signedAt as string)}` : ''}</span> : <span className="text-gray-500 dark:text-slate-400">-</span> },
  ];

  return (
    <div>
      <PageHeader title="Change Orders" action={can('change-orders:create') ? <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>New CO</Button> : undefined} />
      <DataTable data={data} emptyMessage="No change orders yet. Raise one when the scope changes — including a credit, if work is coming out." columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[
        // Mirrors routes/changeOrders.ts: edit, submit, approve and reject are all
        // change-orders:update; the delete is its own verb. (T32 M9)
        // Open to everyone who can read the page, at every status — this is the only way to see a
        // change order's line items, its reason and its signature once it is no longer editable. (T41)
        { label: 'View', icon: FileText, show: () => true, onClick: openView },
        { label: 'Edit', icon: Edit, show: (r: Record<string, unknown>) => can('change-orders:update') && EDITABLE.includes(statusOf(r)), onClick: openEdit },
        { label: 'Submit', icon: Send, show: (r: Record<string, unknown>) => can('change-orders:update') && SUBMITTABLE.includes(statusOf(r)), onClick: handleSubmit },
        { label: 'Approve', icon: Check, show: (r: Record<string, unknown>) => can('change-orders:update') && APPROVABLE.includes(statusOf(r)), onClick: handleApprove },
        { label: 'Reject', icon: XIcon, show: (r: Record<string, unknown>) => can('change-orders:update') && REJECTABLE.includes(statusOf(r)), onClick: handleReject },
        { label: 'Delete', icon: Trash2, show: (r: Record<string, unknown>) => can('change-orders:delete') && EDITABLE.includes(statusOf(r)), onClick: (r: Record<string, unknown>) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
      ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={readOnly ? `Change Order ${(editing?.number as string) || ''}`.trim() : editing ? 'Edit Change Order' : 'New Change Order'} size="lg">
        <div className="space-y-4">
          {readOnly && (
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-slate-800 dark:text-slate-300">
              {`This change order is ${statusOf(editing || {}) || 'closed'}`}
              {EDITABLE.includes(statusOf(editing || {})) ? ' — use Edit to change it.' : ', so it can no longer be changed. This is the record as agreed.'}
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Title *</label><input value={form.title} disabled={readOnly} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, title: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50 disabled:text-gray-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-300" /></div>
            <div><label className="block text-sm font-medium mb-1">Project *</label><select value={form.projectId} disabled={readOnly} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50 disabled:text-gray-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-300"><option value="">Select...</option>{projects.map((p: Record<string, unknown>) => <option key={p.id as string} value={p.id as string}>{p.name as string}</option>)}</select></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Description</label><textarea value={form.description} disabled={readOnly} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({...form, description: e.target.value})} rows={2} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50 disabled:text-gray-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-300" /></div>
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Reason</label><input value={form.reason} disabled={readOnly} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, reason: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50 disabled:text-gray-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-300" placeholder="Owner request, unforeseen conditions..." /></div>
            <div><label className="block text-sm font-medium mb-1">Days Added</label><input type="number" value={form.daysAdded} disabled={readOnly} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, daysAdded: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50 disabled:text-gray-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-300" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-2">Line Items</label>
            <div className="border rounded-lg">
              <table className="w-full"><thead className="bg-gray-50 dark:bg-slate-900"><tr><th className="px-4 py-2 text-left text-xs">Description</th><th className="px-4 py-2 w-20">Qty</th><th className="px-4 py-2 w-28">Price</th><th className="px-4 py-2 text-right w-28">Total</th><th className="w-10"></th></tr></thead>
                <tbody className="divide-y">{form.lineItems.map((li: LineItem, idx: number) => (
                  <tr key={idx}><td className="px-4 py-2"><input value={li.description} disabled={readOnly} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLineItem(idx, 'description', e.target.value)} className="w-full px-2 py-1 border rounded disabled:bg-gray-50 disabled:text-gray-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-300" /></td>
                    <td className="px-4 py-2"><input type="number" value={li.quantity} disabled={readOnly} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLineItem(idx, 'quantity', e.target.value)} className="w-full px-2 py-1 border rounded disabled:bg-gray-50 disabled:text-gray-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-300" /></td>
                    <td className="px-4 py-2"><input type="number" value={li.unitPrice} disabled={readOnly} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLineItem(idx, 'unitPrice', e.target.value)} className="w-full px-2 py-1 border rounded disabled:bg-gray-50 disabled:text-gray-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-300" /></td>
                    <td className="px-4 py-2 text-right">{asMoney(num0(li.quantity) * num0(li.unitPrice))}</td>
                    <td>{!readOnly && <button onClick={() => removeLineItem(idx)} className="p-1 text-red-500"><Trash2 className="w-4 h-4" /></button>}</td></tr>
                ))}</tbody>
              </table>
              <div className="p-2 border-t flex justify-between items-center">{readOnly ? <span /> : <button onClick={addLineItem} className="text-sm text-orange-500">+ Add Line</button>}<span className="font-bold">Total: {asMoney(calcTotal())}</span></div>
            </div>
          </div>
          {/*
            WHO SIGNED IT, AND WHEN. Only on the read-only open, because the signature is evidence
            about a closed agreement and not a field anybody edits. The list no longer carries the
            signature image or the IP to every seat (routes/changeOrders.ts strips them), so this
            is where a manager reads it. (T41)
          */}
          {readOnly && (editing?.signedBy || editing?.approvedAt || editing?.status === 'approved') && (
            <div className="rounded-lg border p-3 text-sm space-y-1 dark:border-slate-800">
              <p className="font-medium text-gray-900 dark:text-slate-100">Signature</p>
              <p className="text-gray-600 dark:text-slate-300">
                {editing?.signedBy ? `Signed by ${editing.signedBy as string}` : 'No client signature recorded'}
                {editing?.signedAt ? ` on ${formatDate(editing.signedAt as string)}` : ''}
              </p>
              {editing?.approvedAt ? <p className="text-gray-600 dark:text-slate-300">Approved {formatDate(editing.approvedAt as string)}{editing?.approvedBy ? ` by ${editing.approvedBy as string}` : ''}</p> : null}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">{readOnly ? 'Close' : 'Cancel'}</button>
          {!readOnly && <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>}
        </div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete CO" message={`Delete ${toDelete?.number as string}?`} confirmText="Delete" />
    </div>
  );
}
