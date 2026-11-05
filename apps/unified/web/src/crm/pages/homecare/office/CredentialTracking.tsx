// Credential tracking (care_cert_reminders): a search across every caregiver's credentials, the credentials kept for clients,
// and the agency's reminder settings — which lead times, whether to email, and whether an expired credential keeps a
// caregiver off a shift.
//   GET /api/credentials/search, GET|PUT /api/credentials/settings, GET|POST|DELETE /api/credentials/clients[/:id]
//   (server/crm/homecare/hr/credentials.ts), GET /api/caregivers, GET /api/clients
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../../../../shared'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { useMay } from '../lib/useMay'

interface Found { id: string; caregiverId: string; firstName: string; lastName: string; certificationType: string; expiryDate: string | null; daysLeft: number | null; state: 'expired' | 'expiring_soon' | 'ok' | 'no_expiry' }
interface Person { id: string; firstName: string; lastName: string }
interface ClientCred { id: string; clientId: string; clientFirstName: string; clientLastName: string; credentialType: string; expiryDate: string | null }
interface Settings { leadDays: number[]; email: boolean; blockExpired: boolean; leadChoices: number[] }

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const STATE_LABEL: Record<Found['state'], string> = { expired: 'Expired', expiring_soon: 'Expiring soon', ok: 'Current', no_expiry: 'No expiry date' }
const STATE_CLASS: Record<Found['state'], string> = { expired: 'hc-badge hc-badge-danger', expiring_soon: 'hc-badge hc-badge-warning', ok: 'hc-badge hc-badge-success', no_expiry: 'hc-badge hc-badge-info' }
const leadLabel = (n: number) => (n === 0 ? 'On the day it expires' : `${n} days before`)
const when = (r: Found) => (r.daysLeft == null ? '—' : r.daysLeft < 0 ? `${-r.daysLeft} day${r.daysLeft === -1 ? '' : 's'} ago` : r.daysLeft === 0 ? 'Today' : `In ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'}`)

type Tab = 'search' | 'clients' | 'settings'

export default function CredentialTracking() {
  const may = useMay('care-hr')
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('search')

  // ── Search ───────────────────────────────────────────────────────────────
  const [caregivers, setCaregivers] = useState<Person[]>([])
  const [type, setType] = useState('')
  const [caregiverId, setCaregiverId] = useState('')
  const [filter, setFilter] = useState<'all' | 'expired' | 'within'>('all')
  const [within, setWithin] = useState('30')
  const [found, setFound] = useState<Found[] | null>(null)
  const [total, setTotal] = useState(0)

  const search = useCallback(async () => {
    const q = new URLSearchParams()
    if (type.trim()) q.set('type', type.trim())
    if (caregiverId) q.set('caregiverId', caregiverId)
    if (filter === 'expired') q.set('expired', 'true')
    if (filter === 'within') q.set('withinDays', within || '30')
    try {
      const r: any = await api.get(`/api/credentials/search?${q.toString()}`)
      setFound(rows<Found>(r)); setTotal(r?.pagination?.total ?? 0)
    } catch (e) { toast.error(errorMessage(e, 'Could not search credentials')) }
  }, [type, caregiverId, filter, within, toast])

  useEffect(() => {
    listAll('/api/caregivers').then((r) => setCaregivers(rows<Person>(r))).catch(() => setCaregivers([]))
  }, [])
  useEffect(() => { if (tab === 'search') void search() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Clients' credentials ─────────────────────────────────────────────────
  const [clients, setClients] = useState<Person[]>([])
  const [cc, setCc] = useState<ClientCred[] | null>(null)
  const [form, setForm] = useState({ clientId: '', credentialType: '', expiryDate: '' })
  const loadClientCreds = useCallback(() => {
    api.get('/api/credentials/clients').then((r: any) => setCc(rows<ClientCred>(r))).catch((e) => toast.error(errorMessage(e, 'Could not load client credentials')))
  }, [toast])
  useEffect(() => {
    if (tab !== 'clients') return
    loadClientCreds()
    listAll('/api/clients').then((r) => setClients(rows<Person>(r))).catch(() => setClients([]))
  }, [tab, loadClientCreds])
  const addClientCred = async () => {
    try {
      await api.post('/api/credentials/clients', { clientId: form.clientId, credentialType: form.credentialType, expiryDate: form.expiryDate || undefined })
      setForm({ clientId: form.clientId, credentialType: '', expiryDate: '' }); loadClientCreds(); toast.success('Credential saved')
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const removeClientCred = async (id: string) => {
    try { await api.delete(`/api/credentials/clients/${id}`); loadClientCreds() } catch (e) { toast.error(errorMessage(e)) }
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    if (tab !== 'settings') return
    api.get('/api/credentials/settings').then((r: any) => setSettings(r)).catch((e) => toast.error(errorMessage(e, 'Could not load settings')))
  }, [tab, toast])
  const saveSettings = async (patch: Partial<Settings>) => {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    try { setSettings((await api.put('/api/credentials/settings', { leadDays: next.leadDays, email: next.email, blockExpired: next.blockExpired })) as Settings); toast.success('Saved') }
    catch (e) { toast.error(errorMessage(e)); setSettings(settings) }
  }
  const toggleLead = (n: number) => {
    if (!settings) return
    const has = settings.leadDays.includes(n)
    const leadDays = has ? settings.leadDays.filter((x) => x !== n) : [...settings.leadDays, n]
    if (!leadDays.length) { toast.error('Pick at least one reminder time'); return }
    void saveSettings({ leadDays })
  }

  const tabBtn = (t: Tab, label: string) => (
    <button type="button" role="tab" aria-selected={tab === t} className={`hc-btn hc-btn-sm ${tab === t ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setTab(t)}>{label}</button>
  )

  return (
    <div className="p-4 max-w-4xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Credentials</h1>
      <p className="text-sm mb-4 text-gray-600 dark:text-slate-400">Every caregiver&apos;s certifications and licences in one place, the credentials kept for clients, and when the agency is reminded.</p>
      <div role="tablist" className="flex gap-2 mb-4">{tabBtn('search', 'Caregivers')}{tabBtn('clients', 'Clients')}{tabBtn('settings', 'Reminders')}</div>

      {tab === 'search' && (
        <div>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <label className="text-sm">Type<br /><input className={inp} value={type} onChange={(e) => setType(e.target.value)} placeholder="e.g. CPR" aria-label="Credential type" /></label>
            <label className="text-sm">Caregiver<br />
              <select className={inp} value={caregiverId} onChange={(e) => setCaregiverId(e.target.value)} aria-label="Caregiver">
                <option value="">Everyone</option>
                {caregivers.map((c) => <option key={c.id} value={c.id}>{c.lastName}, {c.firstName}</option>)}
              </select>
            </label>
            <label className="text-sm">Show<br />
              <select className={inp} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Show">
                <option value="all">All current credentials</option>
                <option value="expired">Expired</option>
                <option value="within">Expiring within…</option>
              </select>
            </label>
            {filter === 'within' && (
              <label className="text-sm">Days<br /><input type="number" min="0" max="3650" className={`${inp} w-24`} value={within} onChange={(e) => setWithin(e.target.value)} aria-label="Days" /></label>
            )}
            <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" onClick={() => void search()}>Search</button>
          </div>
          {found === null ? <p className="text-sm">Loading…</p> : found.length === 0 ? <p className="text-sm text-gray-600 dark:text-slate-400">No credentials match.</p> : (
            <>
              <p className="text-xs mb-1 text-gray-500 dark:text-slate-400">{total} credential{total === 1 ? '' : 's'}, soonest expiry first</p>
              <table className="w-full text-sm" data-testid="credential-results">
                <thead><tr className="text-left border-b border-gray-200 dark:border-slate-700"><th className="py-1">Caregiver</th><th>Credential</th><th>Expires</th><th>When</th><th>Status</th></tr></thead>
                <tbody>
                  {found.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 dark:border-slate-800">
                      <td className="py-1">{r.lastName}, {r.firstName}</td>
                      <td>{r.certificationType}</td>
                      <td>{r.expiryDate || '—'}</td>
                      <td>{when(r)}</td>
                      <td><span className={STATE_CLASS[r.state]}>{STATE_LABEL[r.state]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {tab === 'clients' && (
        <div>
          {may.update && (
            <div className="flex flex-wrap items-end gap-2 mb-4">
              <label className="text-sm">Client<br />
                <select className={inp} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} aria-label="Client">
                  <option value="">Choose a client…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.lastName}, {c.firstName}</option>)}
                </select>
              </label>
              <label className="text-sm">Credential<br /><input className={inp} value={form.credentialType} onChange={(e) => setForm({ ...form, credentialType: e.target.value })} placeholder="e.g. Power of attorney" aria-label="Credential" /></label>
              <label className="text-sm">Expires<br /><input type="date" className={inp} value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} aria-label="Expiry date" /></label>
              <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" disabled={!form.clientId || !form.credentialType.trim()} onClick={() => void addClientCred()}>Add</button>
            </div>
          )}
          {cc === null ? <p className="text-sm">Loading…</p> : cc.length === 0 ? <p className="text-sm text-gray-600 dark:text-slate-400">No client credentials yet. The office is reminded as each one nears its expiry, the same way as for caregivers.</p> : (
            <ul className="space-y-1">
              {cc.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-sm rounded-lg border p-2 border-gray-200 dark:border-slate-700">
                  <span className="font-medium">{r.clientLastName}, {r.clientFirstName}</span>
                  <span>{r.credentialType}</span>
                  <span className="text-gray-500 dark:text-slate-400">{r.expiryDate ? `expires ${r.expiryDate}` : 'no expiry date'}</span>
                  {may.update && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm ml-auto" onClick={() => void removeClientCred(r.id)}>Remove</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'settings' && (settings === null ? <p className="text-sm">Loading…</p> : (
        <div className="space-y-4">
          <fieldset>
            <legend className="text-sm font-semibold mb-1">Remind the caregiver and the office</legend>
            {settings.leadChoices.map((n) => (
              <label key={n} className="flex items-center gap-2 text-sm py-0.5">
                <input type="checkbox" checked={settings.leadDays.includes(n)} disabled={!may.update} onChange={() => toggleLead(n)} /> {leadLabel(n)}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.email} disabled={!may.update} onChange={(e) => void saveSettings({ email: e.target.checked })} />
            Also send each reminder by email (to the caregiver and the office)
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={settings.blockExpired} disabled={!may.update} onChange={(e) => void saveSettings({ blockExpired: e.target.checked })} />
            <span>Do not put a caregiver with an expired credential on a shift<br /><span className="text-gray-500 dark:text-slate-400">Off: scheduling only warns. On: creating, reassigning or offering a shift to them is refused until the credential is renewed.</span></span>
          </label>
        </div>
      ))}
    </div>
  )
}
