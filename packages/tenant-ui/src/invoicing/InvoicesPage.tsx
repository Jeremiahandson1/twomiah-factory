import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Edit, Trash2, Send, DollarSign, Ban, RotateCcw } from 'lucide-react'
import type { InvoicingPageProps, LineItemInput } from './types'
import { resolveConfig } from './types'
import { Button, ConfirmModal, DataTable, Field, LineItemsEditor, Modal, PAYMENT_METHODS, PageHeader, StatusBadge, TotalsBox, calcTotals, dateOnly, errMsg, inputCls, money } from './ui'

type Row = Record<string, any> & { id: string }
interface InvoiceForm { contactId: string; projectId: string; dueDate: string; taxRate: number; discount: number; notes: string; lineItems: LineItemInput[] }
const BASE_STATUSES = ['draft', 'sent', 'partial', 'paid', 'overdue', 'refunded', 'void']
const blankLine = (): LineItemInput => ({ description: '', quantity: 1, unitPrice: 0 })

const netPaid = (r: Row) => Number(r.amountPaid || 0) - Number(r.amountRefunded || 0)
const balanceOf = (r: Row) => (['void', 'refunded'].includes(r.status) ? 0 : Math.max(0, Number(r.total) - Number(r.amountPaid || 0)))

export function InvoicesPage({ api, toast, settings, config }: InvoicingPageProps) {
  const cfg = resolveConfig(config)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const defaultTaxRate = Number(settings?.defaultTaxRate) || 0
  const termsRaw = Number(settings?.paymentTermsDays)
  const termsDays = Number.isFinite(termsRaw) && termsRaw >= 0 ? Math.floor(termsRaw) : 30
  const defaultDueDate = () => { const d = new Date(); d.setDate(d.getDate() + termsDays); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  const statuses = cfg.extraInvoiceStatuses.length ? [BASE_STATUSES[0], ...cfg.extraInvoiceStatuses, ...BASE_STATUSES.slice(1)] : BASE_STATUSES

  const [data, setData] = useState<Row[]>([])
  const [contacts, setContacts] = useState<Row[]>([])
  const [projects, setProjects] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<any>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [form, setForm] = useState<InvoiceForm>({ contactId: '', projectId: '', dueDate: '', taxRate: defaultTaxRate, discount: 0, notes: '', lineItems: [blankLine()] })
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null)
  const [voidTarget, setVoidTarget] = useState<Row | null>(null)
  const [paymentTarget, setPaymentTarget] = useState<Row | null>(null)
  const [payment, setPayment] = useState({ amount: '', method: 'card', reference: '', notes: '', tipAmount: '' })
  const [refundTarget, setRefundTarget] = useState<Row | null>(null)
  const [refund, setRefund] = useState({ amount: '', method: '', reference: '', notes: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, any> = { page, limit: 25 }
      if (statusFilter) params.status = statusFilter
      const res = await api.get('/api/invoices', params)
      setData(res?.data || [])
      setPagination(res?.pagination || null)
    } catch (e) { toast.error(errMsg(e, 'Failed to load invoices')) }
    finally { setLoading(false) }
    // pickers load on their own so a failure there never blanks the list
    api.get('/api/contacts', { limit: 200 }).then((r: any) => setContacts(r?.data || [])).catch(() => setContacts([]))
    if (cfg.projects) api.get('/api/projects', { limit: 100 }).then((r: any) => setProjects(r?.data || [])).catch(() => setProjects([]))
  }, [page, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const openCreate = () => { setEditing(null); setForm({ contactId: '', projectId: '', dueDate: defaultDueDate(), taxRate: defaultTaxRate, discount: 0, notes: '', lineItems: [blankLine()] }); setModalOpen(true) }
  const openEdit = useCallback((item: Row) => {
    setEditing(item)
    setForm({ contactId: item.contactId || '', projectId: item.projectId || '', dueDate: item.dueDate ? String(item.dueDate).slice(0, 10) : '', taxRate: Number(item.taxRate), discount: Number(item.discount), notes: item.notes || '', lineItems: item.lineItems?.length ? item.lineItems.map((li: any) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) })) : [blankLine()] })
    setModalOpen(true)
  }, [])

  // /crm/invoices?edit=<id> deep link (the detail page's Edit button)
  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId) return
    let cancelled = false
    api.get(`/api/invoices/${editId}`).then((item: any) => { if (cancelled || !item) return; openEdit(item); searchParams.delete('edit'); setSearchParams(searchParams, { replace: true }) }).catch(() => {})
    return () => { cancelled = true }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const totals = calcTotals(form.lineItems, form.taxRate, form.discount)
  const linesForSave = form.lineItems.filter(li => li.description.trim())

  const handleSave = async () => {
    if (!form.contactId) { toast.error(`Select a ${cfg.clientLabel.toLowerCase()} for this invoice`); return }
    if (linesForSave.length === 0) { toast.error('Add at least one line item'); return }
    if (totals.discountTooBig) { toast.error('Discount cannot exceed the subtotal'); return }
    setSaving(true)
    try {
      const payload: any = { contactId: form.contactId, dueDate: form.dueDate || null, taxRate: form.taxRate, discount: form.discount, notes: form.notes, lineItems: linesForSave }
      if (cfg.projects) payload.projectId = form.projectId
      if (editing) { await api.put(`/api/invoices/${editing.id}`, payload); toast.success('Invoice updated') }
      else { await api.post('/api/invoices', payload); toast.success('Invoice created') }
      setModalOpen(false); load()
    } catch (e) { toast.error(errMsg(e, 'Could not save the invoice')) }
    finally { setSaving(false) }
  }
  const handleDelete = async () => { if (!deleteTarget) return; try { await api.delete('/api/invoices', deleteTarget.id); toast.success('Invoice deleted'); setDeleteTarget(null); load() } catch (e) { toast.error(errMsg(e, 'Could not delete')) } }
  const handleSend = async (inv: Row) => { try { await api.post(`/api/invoices/${inv.id}/send`, {}); toast.success('Invoice sent'); load() } catch (e) { toast.error(errMsg(e, 'Could not send')) } }
  const handleVoid = async () => { if (!voidTarget) return; try { await api.post(`/api/invoices/${voidTarget.id}/void`, {}); toast.success('Invoice voided'); setVoidTarget(null); load() } catch (e) { toast.error(errMsg(e, 'Could not void')) } }
  const openPayment = (inv: Row) => { setPaymentTarget(inv); setPayment({ amount: balanceOf(inv).toFixed(2), method: 'card', reference: '', notes: '', tipAmount: '' }) }
  const handlePayment = async () => {
    if (!paymentTarget || !(Number(payment.amount) > 0)) { toast.error('Enter a valid amount'); return }
    try {
      const body: any = { amount: Number(payment.amount), method: payment.method, reference: payment.reference || undefined, notes: payment.notes || undefined }
      if (cfg.tips && Number(payment.tipAmount) > 0) body.tipAmount = Number(payment.tipAmount)
      await api.post(`/api/invoices/${paymentTarget.id}/payments`, body); toast.success('Payment recorded'); setPaymentTarget(null); load()
    } catch (e) { toast.error(errMsg(e, 'Could not record the payment')) }
  }
  const openRefund = (inv: Row) => { setRefundTarget(inv); setRefund({ amount: netPaid(inv).toFixed(2), method: '', reference: '', notes: '' }) }
  const handleRefund = async () => {
    if (!refundTarget || !(Number(refund.amount) > 0)) { toast.error('Enter a valid amount'); return }
    try {
      const body: any = { amount: Number(refund.amount), reference: refund.reference || undefined, notes: refund.notes || undefined }
      if (refund.method) body.method = refund.method
      await api.post(`/api/invoices/${refundTarget.id}/refund`, body); toast.success('Refund recorded'); setRefundTarget(null); load()
    } catch (e) { toast.error(errMsg(e, 'Could not record the refund')) }
  }

  const columns = [
    { key: 'number', label: 'Number', render: (v: any) => <span className="font-mono text-xs">{v}</span> },
    { key: 'contact', label: cfg.clientLabel, render: (v: any) => v?.name || '-' },
    { key: 'status', label: 'Status', render: (v: any) => <StatusBadge status={v} /> },
    { key: 'total', label: 'Total', className: 'text-right', render: (v: any) => money(v) },
    { key: 'amountPaid', label: 'Balance', className: 'text-right', render: (_v: any, r: Row) => {
      if (r.status === 'void') return <span className="text-gray-400">Void</span>
      if (r.status === 'refunded') return <span className="text-amber-700 dark:text-amber-300">Refunded</span>
      const bal = balanceOf(r)
      if (bal > 0.005) return <span className="text-orange-600 dark:text-orange-300 font-medium">{money(bal)}</span>
      return Number(r.amountPaid || 0) > 0 ? <span className="text-green-600 dark:text-green-300">Paid</span> : <span className="text-gray-400">-</span>
    } },
    { key: 'dueDate', label: 'Due', render: (v: any) => dateOnly(v) },
  ]

  return (
    <div>
      <PageHeader title="Invoices" action={<Button onClick={openCreate}><Plus className="w-4 h-4" /> New Invoice</Button>} />
      <div className="mb-4">
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} className={`${inputCls} w-auto`}>
          <option value="">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>
      <DataTable<Row> data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} onRowClick={row => navigate(`/crm/invoices/${row.id}`)} emptyMessage="No invoices yet." actions={[
        { label: 'Edit', icon: Edit, onClick: openEdit, show: r => !['void', 'refunded'].includes(r.status) },
        { label: 'Send', icon: Send, onClick: handleSend, show: r => !['void', 'refunded'].includes(r.status) },
        { label: 'Record Payment', icon: DollarSign, onClick: openPayment, show: r => !['void', 'refunded'].includes(r.status) && balanceOf(r) > 0.005 },
        { label: 'Refund', icon: RotateCcw, onClick: openRefund, show: r => r.status !== 'void' && netPaid(r) > 0.005 },
        { label: 'Void', icon: Ban, onClick: r => setVoidTarget(r), show: r => r.status !== 'void' && netPaid(r) <= 0.005 },
        { label: 'Delete', icon: Trash2, onClick: r => setDeleteTarget(r), className: 'text-red-600', show: r => Number(r.amountPaid || 0) <= 0 && r.status !== 'paid' },
      ]} />

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.number}` : 'New Invoice'} size="xl">
        <div className="space-y-4">
          <div className={`grid gap-4 ${cfg.projects ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
            <Field label={`${cfg.clientLabel} *`}><select value={form.contactId} onChange={e => setForm({ ...form, contactId: e.target.value })} className={inputCls}><option value="">Select…</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            {cfg.projects && <Field label="Project"><select value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })} className={inputCls}><option value="">None</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
            <Field label="Due Date" hint={`Defaults to ${termsDays === 0 ? 'the day it is created' : `${termsDays} days out`} from Settings → Company`}><input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} className={inputCls} /></Field>
          </div>
          <Field label="Line Items"><LineItemsEditor items={form.lineItems} onChange={items => setForm({ ...form, lineItems: items })} /></Field>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Tax Rate (%)"><input type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={e => setForm({ ...form, taxRate: Number(e.target.value) })} className={inputCls} /></Field>
            <Field label="Discount ($)"><input type="number" min="0" step="0.01" value={form.discount} onChange={e => setForm({ ...form, discount: Number(e.target.value) })} className={inputCls} /></Field>
          </div>
          <TotalsBox subtotal={totals.subtotal} discount={totals.effectiveDiscount} taxRate={form.taxRate} taxAmount={totals.taxAmount} total={totals.total} warning={totals.discountTooBig ? `Discount cannot exceed the subtotal (${money(totals.subtotal)})` : undefined} />
          <Field label="Notes"><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className={inputCls} /></Field>
        </div>
        <div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={saving || totals.discountTooBig}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create invoice'}</Button></div>
      </Modal>

      <Modal isOpen={!!paymentTarget} onClose={() => setPaymentTarget(null)} title={`Record Payment · ${paymentTarget?.number || ''}`} size="sm">
        <div className="space-y-4">
          <Field label="Amount *" hint={paymentTarget ? `${money(balanceOf(paymentTarget))} remaining` : undefined}><input type="number" step="0.01" min="0.01" value={payment.amount} onChange={e => setPayment({ ...payment, amount: e.target.value })} className={inputCls} /></Field>
          {cfg.tips && <Field label="Tip (optional)" hint="Gratuity for the stylist. Recorded with the payment, never counted toward the invoice."><input type="number" step="0.01" min="0" value={payment.tipAmount} onChange={e => setPayment({ ...payment, tipAmount: e.target.value })} className={inputCls} placeholder="0.00" /></Field>}
          <Field label="Method"><select value={payment.method} onChange={e => setPayment({ ...payment, method: e.target.value })} className={inputCls}>{PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
          <Field label="Reference"><input value={payment.reference} onChange={e => setPayment({ ...payment, reference: e.target.value })} className={inputCls} placeholder="Check # or transaction ID" /></Field>
          <Field label="Notes"><input value={payment.notes} onChange={e => setPayment({ ...payment, notes: e.target.value })} className={inputCls} /></Field>
        </div>
        <div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={() => setPaymentTarget(null)}>Cancel</Button><Button variant="success" onClick={handlePayment}>Record Payment</Button></div>
      </Modal>

      <Modal isOpen={!!refundTarget} onClose={() => setRefundTarget(null)} title={`Record Refund · ${refundTarget?.number || ''}`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-slate-400">The sale stays paid; the refund is recorded on its own line. Card refunds are issued in your payment processor.</p>
          <Field label="Amount *" hint={refundTarget ? `${money(netPaid(refundTarget))} refundable` : undefined}><input type="number" step="0.01" min="0.01" value={refund.amount} onChange={e => setRefund({ ...refund, amount: e.target.value })} className={inputCls} /></Field>
          <Field label="Method" hint="Leave as-is to refund the way the money came in."><select value={refund.method} onChange={e => setRefund({ ...refund, method: e.target.value })} className={inputCls}><option value="">Same as payment</option>{PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
          <Field label="Reference"><input value={refund.reference} onChange={e => setRefund({ ...refund, reference: e.target.value })} className={inputCls} /></Field>
          <Field label="Reason"><input value={refund.notes} onChange={e => setRefund({ ...refund, notes: e.target.value })} className={inputCls} placeholder="Why the money went back" /></Field>
        </div>
        <div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={() => setRefundTarget(null)}>Cancel</Button><Button variant="warn" onClick={handleRefund}>Record Refund</Button></div>
      </Modal>

      <ConfirmModal isOpen={!!voidTarget} onClose={() => setVoidTarget(null)} onConfirm={handleVoid} title="Void invoice" message={`Void ${voidTarget?.number}? It stays on record but no longer counts as owed.`} confirmText="Void" />
      <ConfirmModal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete invoice" message={`Delete ${deleteTarget?.number}? This cannot be undone.`} confirmText="Delete" />
    </div>
  )
}
