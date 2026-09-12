// Contacts list — one page for every CRM. Stats cards double as type filters, search, paged table,
// create/edit modal (also opened by /crm/contacts?edit=<id> from detail pages), delete with the
// backend's "still has N invoices attached" guard surfaced, lead → client conversion, and the
// duplicate guard: a 409 offers "open the existing record" or "create anyway".
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Edit, Trash2, UserCheck, Search, Handshake } from 'lucide-react'
import { DataTable, StatusBadge, PageHeader, Button, Modal, ConfirmModal, Field, inputCls, errMsg } from '../invoicing/ui'
import type { Pagination } from '../invoicing/ui'
import { resolveContactsConfig, isValidPhone } from './types'
import type { ContactsPageProps, ContactRow } from './types'

interface ContactForm {
  type: string; name: string; company: string; email: string; phone: string; mobile: string
  address: string; city: string; state: string; zip: string; source: string; notes: string
}

const emptyForm = (type: string): ContactForm => ({ type, name: '', company: '', email: '', phone: '', mobile: '', address: '', city: '', state: '', zip: '', source: '', notes: '' })

export function ContactsPage({ api, toast, config }: ContactsPageProps) {
  const cfg = resolveContactsConfig(config)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [stats, setStats] = useState<Record<string, number> | null>(null)
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ContactRow | null>(null)
  const [form, setForm] = useState<ContactForm>(emptyForm(cfg.types[0].value))
  const [saving, setSaving] = useState(false)
  const [duplicate, setDuplicate] = useState<{ message: string; existingId?: string } | null>(null)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [toDelete, setToDelete] = useState<ContactRow | null>(null)

  const load = useCallback(async (retry = true) => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { page, limit: 25 }
      if (search) params.search = search
      if (typeFilter) params.type = typeFilter
      const [list, st] = await Promise.all([
        api.get('/api/contacts', params),
        api.get('/api/contacts/stats').catch(() => null),
      ])
      setContacts(list?.data || [])
      setPagination(list?.pagination || null)
      if (st) setStats(st)
    } catch (err) {
      // one retry on first load (cold-start race)
      if (retry) { setTimeout(() => load(false), 500); return }
      toast.error(errMsg(err, 'Failed to load contacts'))
    } finally {
      setLoading(false)
    }
  }, [page, search, typeFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, typeFilter])

  const openCreate = () => { setEditing(null); setForm(emptyForm(cfg.types[0].value)); setDuplicate(null); setModalOpen(true) }
  const openEdit = (row: ContactRow) => {
    setEditing(row)
    setForm({
      type: row.type || cfg.types[0].value, name: row.name || '', company: row.company || '', email: row.email || '',
      phone: row.phone || '', mobile: row.mobile || '', address: row.address || '', city: row.city || '', state: row.state || '',
      zip: row.zip || '', source: row.source || '', notes: row.notes || '',
    })
    setDuplicate(null)
    setModalOpen(true)
  }

  // Detail pages link here as ?edit=<id>. Fetch that record directly (it may not be on this page),
  // open the modal, then clear the param.
  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId) return
    let cancelled = false
    api.get(`/api/contacts/${editId}`).then((row: ContactRow) => {
      if (cancelled || !row) return
      openEdit(row)
      const next = new URLSearchParams(searchParams)
      next.delete('edit')
      setSearchParams(next, { replace: true })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (allowDuplicate = false) => {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    if (!isValidPhone(form.phone) || !isValidPhone(form.mobile)) { toast.error('Enter a valid phone number (at least 7 digits)'); return }
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/api/contacts/${editing.id}`, form)
        toast.success('Contact updated')
      } else {
        await api.post('/api/contacts', allowDuplicate ? { ...form, allowDuplicate: true } : form)
        toast.success('Contact created')
      }
      setModalOpen(false)
      setDuplicate(null)
      load()
    } catch (err: any) {
      if (err?.status === 409 && err?.data?.duplicate) {
        setDuplicate({ message: err.data.error, existingId: err.data.existingId })
        return
      }
      toast.error(errMsg(err, 'Failed to save contact'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!toDelete) return
    try {
      await api.delete('/api/contacts', toDelete.id)
      toast.success('Contact deleted')
      setDeleteOpen(false)
      setToDelete(null)
      load()
    } catch (err) {
      toast.error(errMsg(err, 'Failed to delete contact'))
    }
  }

  const convert = async (row: ContactRow) => {
    try {
      await api.post(`/api/contacts/${row.id}/convert`)
      toast.success(`Lead converted to ${cfg.convertLabel.toLowerCase()}`)
      load()
    } catch (err) {
      toast.error(errMsg(err, 'Failed to convert lead'))
    }
  }

  const typeLabel = (v: string) => cfg.types.find((t) => t.value === v)?.label || v

  const columns = [
    { key: 'name', label: 'Name', render: (val: unknown, row: ContactRow) => (
      <div>
        <p className="font-medium text-gray-900 dark:text-slate-100">{String(val || '')}</p>
        {!!row.company && <p className="text-sm text-gray-500 dark:text-slate-400">{row.company}</p>}
      </div>
    ) },
    { key: 'type', label: 'Type', render: (val: unknown) => <StatusBadge status={String(val || '')} /> },
    { key: 'email', label: 'Email', render: (val: unknown) => val ? <a href={`mailto:${val}`} onClick={(e) => e.stopPropagation()} className="text-orange-500 hover:underline">{String(val)}</a> : '-' },
    { key: 'phone', label: 'Phone', render: (val: unknown) => <span className="text-gray-700 dark:text-slate-200">{String(val || '-')}</span> },
    { key: 'city', label: 'Location', render: (_v: unknown, row: ContactRow) => <span className="text-gray-700 dark:text-slate-200">{row.city && row.state ? `${row.city}, ${row.state}` : row.city || row.state || '-'}</span> },
  ]

  const actions = [
    { label: 'Edit', icon: Edit, onClick: openEdit },
    { label: `Convert to ${cfg.convertLabel}`, icon: UserCheck, show: (row: ContactRow) => row.type === 'lead', onClick: convert },
    ...(cfg.vendorPortalInvite ? [{
      label: 'Invite to vendor portal', icon: Handshake, show: (row: ContactRow) => row.type === 'vendor',
      onClick: async (row: ContactRow) => {
        try {
          await api.post(`/api/vendor-portal/contacts/${row.id}/invite`)
          toast.success('Vendor portal invite sent — they can acknowledge POs and submit invoices')
        } catch (err) { toast.error(errMsg(err, 'Failed to send invite')) }
      },
    }] : []),
    { label: 'Delete', icon: Trash2, className: 'text-red-600', onClick: (row: ContactRow) => { setToDelete(row); setDeleteOpen(true) } },
  ]

  const set = (k: keyof ContactForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value })

  return (
    <div>
      <PageHeader
        title={cfg.title}
        subtitle={stats ? `${stats.total} total` : undefined}
        action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline" />Add Contact</Button>}
      />

      {stats && (
        <div className={`grid grid-cols-2 gap-4 mb-6 ${cfg.types.length >= 4 ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
          {cfg.types.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTypeFilter(typeFilter === t.value ? '' : t.value)}
              className={`p-4 rounded-lg border text-left transition-colors ${typeFilter === t.value ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'bg-white hover:border-gray-300 dark:bg-slate-900 dark:border-slate-800'}`}
            >
              <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{stats[t.value] || 0}</p>
              <p className="text-sm text-gray-500 dark:text-slate-400">{t.label}s</p>
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search contacts..." value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputCls} pl-10`} />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="">All Types</option>
          {cfg.types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <DataTable<ContactRow>
        data={contacts}
        columns={columns}
        loading={loading}
        pagination={pagination}
        onPageChange={setPage}
        onRowClick={(row) => navigate(`/crm/contacts/${row.id}`)}
        actions={actions}
        emptyMessage="No contacts found"
      />

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Contact' : 'New Contact'} size="lg">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Field label="Type">
              <select value={form.type} onChange={set('type')} className={inputCls}>
                {cfg.types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                {!cfg.types.some((t) => t.value === form.type) && <option value={form.type}>{typeLabel(form.type)}</option>}
              </select>
            </Field>
          </div>
          <Field label="Name *"><input type="text" required aria-required="true" value={form.name} onChange={set('name')} className={inputCls} placeholder="John Smith" /></Field>
          <Field label="Company"><input type="text" value={form.company} onChange={set('company')} className={inputCls} /></Field>
          <Field label="Email"><input type="email" value={form.email} onChange={set('email')} className={inputCls} /></Field>
          <Field label="Phone"><input type="tel" value={form.phone} onChange={set('phone')} className={inputCls} /></Field>
          <Field label="Mobile"><input type="tel" value={form.mobile} onChange={set('mobile')} className={inputCls} /></Field>
          <Field label="Source"><input type="text" value={form.source} onChange={set('source')} className={inputCls} placeholder="Referral, Website, etc." /></Field>
          <div className="md:col-span-2"><Field label="Address"><input type="text" value={form.address} onChange={set('address')} className={inputCls} /></Field></div>
          <Field label="City"><input type="text" value={form.city} onChange={set('city')} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State"><input type="text" value={form.state} onChange={set('state')} className={inputCls} /></Field>
            <Field label="ZIP"><input type="text" value={form.zip} onChange={set('zip')} className={inputCls} /></Field>
          </div>
          <div className="md:col-span-2"><Field label="Notes"><textarea value={form.notes} onChange={set('notes')} rows={3} className={inputCls} /></Field></div>
        </div>

        {duplicate && (
          <div role="alert" className="mt-4 p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-100 text-sm">
            <p className="font-medium">Possible duplicate</p>
            <p className="mt-1">{duplicate.message}</p>
            <div className="mt-3 flex gap-2">
              {duplicate.existingId && (
                <Button variant="secondary" onClick={() => { setModalOpen(false); navigate(`/crm/contacts/${duplicate.existingId}`) }}>Open existing</Button>
              )}
              <Button variant="secondary" onClick={() => save(true)} disabled={saving}>Create anyway</Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button onClick={() => save(false)} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</Button>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => { setDeleteOpen(false); setToDelete(null) }}
        onConfirm={remove}
        title="Delete Contact"
        message={`Are you sure you want to delete "${toDelete?.name || ''}"? This action cannot be undone.`}
        confirmText="Delete"
      />
    </div>
  )
}

export default ContactsPage
