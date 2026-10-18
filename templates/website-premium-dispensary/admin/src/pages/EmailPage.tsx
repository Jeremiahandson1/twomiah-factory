import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Loader2, Trash2, RefreshCw, AlertCircle, Plus, ArrowUpRight, Send } from 'lucide-react'
import { api } from '../api/client'

interface Alias {
  id: string
  localPart: string
  forwardTo: string | null
  enabled: boolean
  lastSyncedAt: string | null
  syncError: string | null
}

// Where each address stands on the domain — the Factory's answer (GET /api/admin/email-aliases/status,
// which also sets the addresses up on the way). The same report the CRM's address page reads.
type AliasState = 'live' | 'confirm_destination' | 'waiting_for_domain' | 'waiting_for_nameservers' | 'off' | 'error'
interface StatusReport {
  state: 'live' | 'action_needed' | 'waiting_for_domain' | 'waiting_for_nameservers' | 'crm_needs_update' | 'error'
  domain: string | null
  nameservers?: string[]
  detail?: string
  aliases: Array<{ localPart: string; address: string | null; state: AliasState; destination?: string | null; detail?: string }>
}

const CHIP: Record<AliasState, { label: string; cls: string }> = {
  live: { label: 'Receiving mail', cls: 'bg-green-100 text-green-800' },
  confirm_destination: { label: 'Confirm the inbox', cls: 'bg-amber-100 text-amber-900' },
  waiting_for_domain: { label: 'Waiting for your domain', cls: 'bg-gray-100 text-gray-700' },
  waiting_for_nameservers: { label: 'Waiting for nameservers', cls: 'bg-gray-100 text-gray-700' },
  off: { label: 'Paused', cls: 'bg-gray-100 text-gray-700' },
  error: { label: 'Not set up', cls: 'bg-red-100 text-red-800' },
}

/**
 * Branded email — support@, jim@ — on the business's own domain. ONE place per business:
 *   - a site paired with a CRM: the CRM keeps the addresses (the Factory reads only the CRM's list and
 *     removes rules for anything else), so this page sends the owner to the CRM's address page;
 *   - a website-only tenant: the addresses live here, forward to an inbox the owner already reads, and the
 *     Factory sets each one up on the domain — including any saved before the domain was connected.
 */
export function EmailPage() {
  const [loading, setLoading] = useState(true)
  const [aliases, setAliases] = useState<Alias[]>([])
  const [crmEmailUrl, setCrmEmailUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusReport | null>(null)
  const [localPart, setLocalPart] = useState('')
  const [forwardTo, setForwardTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // The status is the Factory's (and it reconciles Cloudflare on the way), so it loads after the list
  // and never holds the list up.
  const loadStatus = async () => {
    try {
      setStatus(await api.get<StatusReport>('/api/admin/email-aliases/status'))
    } catch { /* the rows simply show no state */ }
  }

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.get<{ data: Alias[]; crmEmailUrl: string | null }>('/api/admin/email-aliases')
      setAliases(data.data || [])
      setCrmEmailUrl(data.crmEmailUrl || null)
      if (!data.crmEmailUrl) void loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your email addresses')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null); setNotice(null)
    try {
      const res = await api.post<{ synced: boolean; syncError: string | null }>('/api/admin/email-aliases', { localPart, forwardTo })
      if (!res.synced) setError(res.syncError || 'Saved, but mail routing has not updated yet — use Retry.')
      setLocalPart('')
      setForwardTo('')
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that address')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (a: Alias) => {
    setBusyId(a.id); setError(null); setNotice(null)
    try {
      await api.patch(`/api/admin/email-aliases/${a.id}`, { enabled: !a.enabled, forwardTo: a.forwardTo })
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that address')
    } finally {
      setBusyId(null)
    }
  }

  const resync = async (a: Alias) => {
    setBusyId(a.id); setError(null); setNotice(null)
    try {
      const res = await api.post<{ synced: boolean; syncError: string | null }>(`/api/admin/email-aliases/${a.id}/resync`, {})
      if (!res.synced) setError(res.syncError || 'Still could not update mail routing.')
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (a: Alias) => {
    if (!confirm(`Delete ${a.localPart}@${status?.domain || 'your domain'}? Mail to it will stop being delivered.`)) return
    setBusyId(a.id); setError(null); setNotice(null)
    try {
      await api.delete(`/api/admin/email-aliases/${a.id}`)
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that address')
    } finally {
      setBusyId(null)
    }
  }

  const resend = async (destination: string) => {
    setError(null); setNotice(null)
    try {
      const res = await api.post<{ ok: boolean; alreadyConfirmed?: boolean }>('/api/admin/email-aliases/resend-confirmation', { destination })
      setNotice(res.alreadyConfirmed ? `${destination} is already confirmed.` : `Sent again — check ${destination} for an email from Cloudflare.`)
      void loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send it again')
    }
  }

  const header = (
    <div className="mb-8">
      <h1 className="text-3xl text-ink flex items-center gap-2"><Mail className="w-6 h-6" /> Email addresses</h1>
      <p className="text-muted text-sm mt-1">Addresses on your own domain — support@, you@ — forwarded to an inbox you already read.</p>
    </div>
  )

  if (loading && aliases.length === 0 && !crmEmailUrl) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        {header}
        <div className="p-10 text-center"><Loader2 className="w-5 h-5 animate-spin text-muted mx-auto" /></div>
      </div>
    )
  }

  // A site paired with a CRM: the CRM is the one place.
  if (crmEmailUrl) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        {header}
        <section className="card card-padding">
          <h2 className="text-lg text-ink mb-1">Your email addresses are managed in your CRM</h2>
          <p className="text-sm text-ink-soft mb-5">
            Your CRM keeps your business's addresses and sets them up on your domain, so there is one list to look after.
            Add, change or pause them there.
          </p>
          <a href={crmEmailUrl} className="btn-primary btn-md inline-flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4" /> Open email settings in your CRM
          </a>
        </section>
        {aliases.length > 0 && (
          <section className="card card-padding mt-6">
            <div className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>These addresses were set up here before you had a CRM. Add any you still want in your CRM — an address your CRM doesn't list stops forwarding.</span>
            </div>
            <ul className="divide-y divide-line">
              {aliases.map((a) => (
                <li key={a.id} className="py-3 text-sm">
                  <span className="font-medium text-ink">{a.localPart}@</span>
                  <span className="text-ink-soft"> → {a.forwardTo}</span>
                  {!a.enabled && <span className="ml-2 text-xs text-muted">paused</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    )
  }

  const domain = status?.domain || null
  const stateOf = (lp: string) => status?.aliases.find((s) => s.localPart === lp)

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {header}

      {status && !domain && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You can add addresses now — they start working once your domain is connected on the{' '}
          <Link to="/domain" className="underline font-semibold">Domain</Link> page.
        </div>
      )}
      {status?.state === 'waiting_for_nameservers' && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Waiting for {domain}'s nameservers to point at us{status.nameservers?.length ? ` (${status.nameservers.join(', ')})` : ''}. Your addresses switch on by themselves once they do.
        </div>
      )}
      {status && (status.state === 'error' || status.state === 'crm_needs_update') && status.detail && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{status.detail}</div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>
      )}

      <form onSubmit={add} className="card card-padding space-y-4">
        <h2 className="text-lg text-ink">Add an address</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="alias-local" className="block text-sm font-medium text-ink-soft mb-1">Address</label>
            <div className="flex items-center">
              <input
                id="alias-local"
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value)}
                placeholder="support"
                className="input rounded-r-none"
                required
              />
              <span className="rounded-r-lg border border-l-0 border-line bg-paper px-3 py-2.5 text-sm text-ink-soft whitespace-nowrap">
                @{domain || 'your domain'}
              </span>
            </div>
          </div>
          <div>
            <label htmlFor="alias-forward" className="block text-sm font-medium text-ink-soft mb-1">Forward to</label>
            <input
              id="alias-forward"
              type="email"
              value={forwardTo}
              onChange={(e) => setForwardTo(e.target.value)}
              placeholder="you@gmail.com"
              className="input"
              required
            />
          </div>
        </div>
        <button type="submit" disabled={saving} className="btn-primary btn-md inline-flex items-center gap-2 disabled:opacity-40">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {saving ? 'Creating…' : 'Create address'}
        </button>
        <p className="text-xs text-muted">
          The first time an inbox is used, Cloudflare (who carries the mail) emails it a confirmation link — click it, or nothing forwards there.
        </p>
      </form>

      <section className="card mt-6">
        <div className="border-b border-line px-6 py-3 font-semibold text-ink">Your addresses</div>
        {aliases.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">No addresses yet. support@ is the usual first one.</div>
        ) : (
          <ul className="divide-y divide-line">
            {aliases.map((a) => {
              const st = stateOf(a.localPart)
              const chip = st ? CHIP[st.state] : null
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                  <div className="min-w-0">
                    <p className="font-medium text-ink flex flex-wrap items-center gap-2">
                      <span className="break-all">{a.localPart}@{domain || 'your domain'}</span>
                      {chip && <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${chip.cls}`}>{chip.label}</span>}
                    </p>
                    <p className="text-sm text-ink-soft break-all">forwards to {a.forwardTo}</p>
                    {st?.detail && <p className="text-xs text-ink-soft mt-0.5">{st.detail}</p>}
                    {a.syncError && (
                      <p className="text-xs text-red-700 mt-0.5 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Mail routing not updated: {a.syncError}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {st?.state === 'confirm_destination' && st.destination && (
                      <button onClick={() => resend(st.destination!)} className="btn-secondary btn-sm inline-flex items-center gap-1" title="Send Cloudflare's confirmation email again">
                        <Send className="w-3.5 h-3.5" /> Resend
                      </button>
                    )}
                    {a.syncError && (
                      <button onClick={() => resync(a)} disabled={busyId === a.id} title="Retry" aria-label="Retry"
                        className="rounded-lg p-2 text-ink-soft hover:bg-paper">
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => toggle(a)} disabled={busyId === a.id} className="btn-secondary btn-sm">
                      {a.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button onClick={() => remove(a)} disabled={busyId === a.id} title="Delete" aria-label="Delete"
                      className="rounded-lg p-2 text-red-700 hover:bg-red-50">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
