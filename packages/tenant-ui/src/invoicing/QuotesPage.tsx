import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Edit, Trash2, Send, Check, X, FileText, Briefcase, Search } from 'lucide-react'
import type { InvoicingPageProps, LineItemInput } from './types'
import { resolveConfig } from './types'
import { Button, ConfirmModal, DataTable, Field, LineItemsEditor, Modal, PageHeader, StatusBadge, TotalsBox, calcTotals, dateOnly, errMsg, inputCls, money } from './ui'

type Row = Record<string, any> & { id: string }
interface QuoteForm { name: string; contactId: string; projectId: string; siteId: string; equipmentId: string; expiryDate: string; taxRate: number; discount: number; notes: string; customerMessage: string; terms: string; lineItems: LineItemInput[] }
const blankLine = (): LineItemInput => ({ description: '', quantity: 1, unitPrice: 0 })
const EDITABLE = ['draft', 'sent']

export function QuotesPage({ api, toast, settings, config }: InvoicingPageProps) {
  const cfg = resolveConfig(config)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const defaultTaxRate = Number(settings?.defaultTaxRate) || 0
  const statuses = ['draft', 'sent', 'approved', cfg.quoteDecline ? 'declined' : 'rejected', 'expired']
  const emptyForm = (): QuoteForm => ({ name: '', contactId: '', projectId: '', siteId: '', equipmentId: '', expiryDate: '', taxRate: defaultTaxRate, discount: 0, notes: '', customerMessage: '', terms: '', lineItems: [blankLine()] })

  const [data, setData] = useState<Row[]>([])
  const [contacts, setContacts] = useState<Row[]>([])
  const [projects, setProjects] = useState<Row[]>([])
  const [sites, setSites] = useState<Row[]>([])
  const [equipment, setEquipment] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<any>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [form, setForm] = useState<QuoteForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, any> = { page, limit: 25 }
      if (statusFilter) params.status = statusFilter
      if (search.trim()) params.search = search.trim()
      const res = await api.get('/api/quotes', params)
      setData(res?.data || []); setPagination(res?.pagination || null)
    } catch (e) { toast.error(errMsg(e, 'Failed to load quotes')) }
    finally { setLoading(false) }
    api.get('/api/contacts', { limit: 200 }).then((r: any) => setContacts(r?.data || [])).catch(() => setContacts([]))
    if (cfg.projects) api.get('/api/projects', { limit: 100 }).then((r: any) => setProjects(r?.data || [])).catch(() => setProjects([]))
  }, [page, statusFilter, search]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const loadCustomerExtras = (contactId: string) => {
    if (cfg.quoteEquipment) { if (contactId) api.get('/api/equipment', { contactId, limit: 100 }).then((r: any) => setEquipment(r?.data || [])).catch(() => setEquipment([])); else setEquipment([]) }
    if (cfg.quoteSites) { if (contactId) api.get(`/api/contacts/${contactId}/sites`).then((r: any) => setSites(Array.isArray(r) ? r : r?.data || [])).catch(() => setSites([])); else setSites([]) }
  }
  const openCreate = () => { setEditing(null); setForm(emptyForm()); setSites([]); setEquipment([]); setModalOpen(true) }
  const openEdit = useCallback((item: Row) => {
    setEditing(item)
    setForm({ name: item.name || '', contactId: item.contactId || '', projectId: item.projectId || '', siteId: item.siteId || '', equipmentId: item.equipmentId || '', expiryDate: item.expiryDate ? String(item.expiryDate).slice(0, 10) : '', taxRate: Number(item.taxRate), discount: Number(item.discount), notes: item.notes || '', customerMessage: item.customerMessage || '', terms: item.terms || '', lineItems: item.lineItems?.length ? item.lineItems.map((li: any) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) })) : [blankLine()] })
    loadCustomerExtras(item.contactId || '')
    setModalOpen(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId) return
    let cancelled = false
    api.get(`/api/quotes/${editId}`).then((item: any) => { if (cancelled || !item) return; openEdit(item); searchParams.delete('edit'); setSearchParams(searchParams, { replace: true }) }).catch(() => {})
    return () => { cancelled = true }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const totals = calcTotals(form.lineItems, form.taxRate, form.discount)
  const linesForSave = form.lineItems.filter(li => li.description.trim())

  const save = async (sendAfter = false) => {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    if (totals.discountTooBig) { toast.error('Discount cannot exceed the subtotal'); return }
    setSaving(true)
    try {
      const payload: any = { name: form.name.trim(), contactId: form.contactId, expiryDate: form.expiryDate || null, taxRate: form.taxRate, discount: form.discount, notes: form.notes, terms: form.terms, lineItems: linesForSave }
      if (cfg.projects) payload.projectId = form.projectId
      if (cfg.quoteSites) payload.siteId = form.siteId
      if (cfg.quoteEquipment) payload.equipmentId = form.equipmentId
      if (cfg.quoteCustomerMessage) payload.customerMessage = form.customerMessage
      let saved: any
      if (editing) { saved = await api.put(`/api/quotes/${editing.id}`, payload); toast.success('Quote updated') }
      else { saved = await api.post('/api/quotes', payload); toast.success('Quote created') }
      if (sendAfter && saved?.id) { await api.post(`/api/quotes/${saved.id}/send`, {}); toast.success('Quote sent') }
      setModalOpen(false); load()
    } catch (e) { toast.error(errMsg(e, 'Could not save the quote')) }
    finally { setSaving(false) }
  }
  const act = async (path: string, ok: string) => { try { const r = await api.post(path, {}); toast.success(ok); load(); return r } catch (e) { toast.error(errMsg(e, 'That did not work')) } }
  const handleDelete = async () => { if (!deleteTarget) return; try { await api.delete('/api/quotes', deleteTarget.id); toast.success('Quote deleted'); setDeleteTarget(null); load() } catch (e) { toast.error(errMsg(e, 'Could not delete')) } }

  const columns = [
    { key: 'number', label: 'Number', render: (v: any) => <span className="font-mono text-xs">{v}</span> },
    { key: 'name', label: 'Name', render: (v: any, r: Row) => <div><p className="font-medium">{v}</p>{r.contact && <p className="text-xs text-gray-500 dark:text-slate-400">{r.contact.name}</p>}</div> },
    { key: 'status', label: 'Status', render: (v: any) => <StatusBadge status={v} /> },
    { key: 'total', label: 'Total', className: 'text-right', render: (v: any) => money(v) },
    { key: 'expiryDate', label: 'Expires', render: (v: any) => dateOnly(v) },
  ]

  return (
    <div>
      <PageHeader title="Quotes" action={<Button onClick={openCreate}><Plus className="w-4 h-4" /> New Quote</Button>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} className={`${inputCls} w-auto`}>
          <option value="">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <div className="relative"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search number or name" className={`${inputCls} pl-9 w-64`} /></div>
      </div>
      <DataTable<Row> data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} onRowClick={row => navigate(`/crm/quotes/${row.id}`)} emptyMessage="No quotes yet." actions={[
        { label: 'Edit', icon: Edit, onClick: openEdit, show: r => EDITABLE.includes(r.status) },
        { label: 'Send', icon: Send, onClick: r => act(`/api/quotes/${r.id}/send`, 'Quote sent'), show: r => EDITABLE.includes(r.status) },
        { label: 'Mark approved', icon: Check, onClick: r => act(`/api/quotes/${r.id}/approve`, 'Quote approved'), show: r => EDITABLE.includes(r.status) },
        { label: cfg.quoteDecline ? 'Mark declined' : 'Mark rejected', icon: X, onClick: r => act(`/api/quotes/${r.id}/${cfg.quoteDecline ? 'decline' : 'reject'}`, cfg.quoteDecline ? 'Quote declined' : 'Quote rejected'), show: r => EDITABLE.includes(r.status) },
        { label: 'Convert to Invoice', icon: FileText, onClick: async r => { const inv = await act(`/api/quotes/${r.id}/convert-to-invoice`, 'Invoice created'); if (inv?.id) navigate(`/crm/invoices/${inv.id}`) }, show: r => r.status === 'approved' },
        ...(cfg.jobs ? [{ label: 'Convert to Job', icon: Briefcase, onClick: async (r: Row) => { const job = await act(`/api/quotes/${r.id}/convert-to-job`, 'Job created from quote'); if (job?.id) navigate(cfg.jobPath(job.id)) }, show: (r: Row) => r.status === 'approved' && !r.convertedToJobId }] : []),
        { label: 'Delete', icon: Trash2, onClick: r => setDeleteTarget(r), className: 'text-red-600', show: r => r.status === 'draft' },
      ]} />

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.number}` : 'New Quote'} size="xl">
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="md:col-span-2"><Field label="Name *"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder={cfg.quoteNamePlaceholder} /></Field></div>
            <Field label={cfg.clientLabel}><select value={form.contactId} onChange={e => { setForm({ ...form, contactId: e.target.value, siteId: '', equipmentId: '' }); loadCustomerExtras(e.target.value) }} className={inputCls}><option value="">Select…</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            {cfg.projects && <Field label="Project"><select value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })} className={inputCls}><option value="">None</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
            {cfg.quoteSites && sites.length > 0 && <Field label="Location"><select value={form.siteId} onChange={e => setForm({ ...form, siteId: e.target.value })} className={inputCls}><option value="">No specific location</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}{s.address ? ` — ${s.address}` : ''}</option>)}</select></Field>}
            {cfg.quoteEquipment && equipment.length > 0 && <Field label="Equipment"><select value={form.equipmentId} onChange={e => setForm({ ...form, equipmentId: e.target.value })} className={inputCls}><option value="">No specific unit</option>{equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.name}{eq.manufacturer ? ` — ${eq.manufacturer}` : ''}{eq.model ? ` ${eq.model}` : ''}</option>)}</select></Field>}
          </div>
          <Field label="Line Items"><LineItemsEditor items={form.lineItems} onChange={items => setForm({ ...form, lineItems: items })} /></Field>
          <div className="grid md:grid-cols-3 gap-4">
            <Field label="Tax Rate (%)"><input type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={e => setForm({ ...form, taxRate: Number(e.target.value) })} className={inputCls} /></Field>
            <Field label="Discount ($)"><input type="number" min="0" step="0.01" value={form.discount} onChange={e => setForm({ ...form, discount: Number(e.target.value) })} className={inputCls} /></Field>
            <Field label="Expiry Date"><input type="date" value={form.expiryDate} onChange={e => setForm({ ...form, expiryDate: e.target.value })} className={inputCls} /></Field>
          </div>
          <TotalsBox subtotal={totals.subtotal} discount={totals.effectiveDiscount} taxRate={form.taxRate} taxAmount={totals.taxAmount} total={totals.total} warning={totals.discountTooBig ? `Discount cannot exceed the subtotal (${money(totals.subtotal)})` : undefined} />
          {cfg.quoteCustomerMessage && <Field label={<>Customer Message <span className="text-gray-400 font-normal">(shown on the quote)</span></>}><textarea value={form.customerMessage} onChange={e => setForm({ ...form, customerMessage: e.target.value })} rows={2} className={inputCls} placeholder="Thank you for choosing us…" /></Field>}
          <Field label={<>Notes <span className="text-gray-400 font-normal">(internal)</span></>}><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className={inputCls} /></Field>
          <Field label="Terms"><textarea value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} rows={2} className={inputCls} /></Field>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button onClick={() => save(false)} disabled={saving || totals.discountTooBig}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save as draft'}</Button>
          {!editing && <Button variant="success" onClick={() => save(true)} disabled={saving || totals.discountTooBig || !form.contactId}>{saving ? 'Saving…' : 'Save & send'}</Button>}
        </div>
      </Modal>
      <ConfirmModal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete quote" message={`Delete "${deleteTarget?.name}"? This cannot be undone.`} confirmText="Delete" />
    </div>
  )
}
