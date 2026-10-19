// Moved from templates/crm-landscaping/frontend/src/pages/landscaping/SitePicker.tsx.
import { useState, useEffect, useCallback } from 'react'
import { Plus } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useMayWrite } from '../../../shared'

/** A row of GET /api/sites (server/crm/landscaping/sites.ts): the property and its customer's name. */
export interface SiteOption { id: string; name: string; address?: string | null; contactName?: string | null }

/** A row of GET /api/contacts — the picker reads the id and the name. */
interface ContactOption { id: string; name: string }

/** The server's own words when it refused (the API client puts its `error` on `.message`), else the fallback. */
const serverMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

/** Loads this company's properties once and keeps them; callers re-use the same list. */
export function useSites() {
  const [sites, setSites] = useState<SiteOption[]>([])
  const load = useCallback(async () => {
    try {
      // A list reply ({ data, pagination }) with every property in it.
      const res = await api.get('/api/sites')
      setSites(Array.isArray(res?.data) ? (res.data as SiteOption[]) : [])
    } catch { /* an empty list is handled by the picker's own message */ }
  }, [])
  useEffect(() => { load() }, [load])
  return { sites, reloadSites: load }
}

/**
 * Pick the property (site) a price, a snow contract or a route stop is for — the pages used to ask the operator to type
 * a 24-character internal id, and nothing in the app could create or list one. (Landscaping T14 M7)
 * "+ Add" saves a new one (name, address, customer) and selects it, without leaving the page.
 */
export function SitePicker({ id, value, sites, onChange, onAdded, allowAdd = true }: {
  id: string; value: string; sites: SiteOption[]; onChange: (siteId: string) => void; onAdded?: () => void; allowAdd?: boolean;
}) {
  const toast = useToast()
  // "+ Add" is POST /api/sites — contacts:create. In the picker, so every page that uses it holds the rule. (T43, T68)
  const mayAddSite = useMayWrite('contacts:create')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [form, setForm] = useState({ name: '', address: '', contactId: '' })

  const openAdd = async () => {
    setAdding(true)
    try {
      const res = await api.get('/api/contacts', { limit: 200 })
      setContacts(Array.isArray(res?.data) ? (res.data as ContactOption[]) : [])
    } catch (error) { toast.error(serverMessage(error, 'Could not load customers')) }
  }
  const save = async () => {
    setSaving(true)
    try {
      const created = await api.post('/api/sites', form) as SiteOption
      toast.success(`Property "${created.name}" added`)
      setAdding(false); setForm({ name: '', address: '', contactId: '' })
      onAdded?.(); onChange(created.id)
    } catch (error) { toast.error(serverMessage(error, 'Could not add the property')) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex gap-2">
        <select id={id} className="input w-full" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{sites.length ? 'Select a property…' : 'No properties yet — add one'}</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.address ? ` — ${s.address}` : ''}</option>)}
        </select>
        {allowAdd && mayAddSite && !adding && (
          <button type="button" onClick={openAdd} className="shrink-0 text-xs border dark:border-slate-700 rounded px-2 py-1.5 flex items-center gap-1 hover:bg-gray-50 dark:hover:bg-slate-800">
            <Plus className="w-3 h-3" /> Add
          </button>
        )}
      </div>
      {adding && (
        <div className="mt-2 border dark:border-slate-700 rounded p-2 space-y-2 bg-gray-50 dark:bg-slate-800">
          <div>
            <label htmlFor={`${id}-new-name`} className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-400">Property name</label>
            <input id={`${id}-new-name`} className="input w-full" placeholder="Maple Plaza — parking lot" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${id}-new-address`} className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-400">Address</label>
            <input id={`${id}-new-address`} className="input w-full" placeholder="120 Maple St" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${id}-new-contact`} className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-400">Customer</label>
            <select id={`${id}-new-contact`} className="input w-full" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}>
              <option value="">Select a customer…</option>
              {contacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving} className="btn-primary btn-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save property'}</button>
            <button type="button" onClick={() => setAdding(false)} className="btn-secondary btn-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
