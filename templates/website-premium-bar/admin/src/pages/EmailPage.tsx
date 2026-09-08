import { useEffect, useState } from 'react'
import { Mail, Loader2, Trash2, RefreshCw, AlertCircle, CheckCircle2, Plus } from 'lucide-react'
import { api } from '../api/client'

interface Alias {
  id: string
  localPart: string
  forwardTo: string | null
  enabled: boolean
  lastSyncedAt: string | null
  syncError: string | null
}

/**
 * Branded email for a website-only tenant. They own the domain; this is how
 * they get support@ and jim@ on it. Mail forwards to an inbox they already
 * read — there is no CRM here to deliver into.
 */
export function EmailPage() {
  const [loading, setLoading] = useState(true)
  const [aliases, setAliases] = useState<Alias[]>([])
  const [domain, setDomain] = useState<string | null>(null)
  const [localPart, setLocalPart] = useState('')
  const [forwardTo, setForwardTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.get<{ data: Alias[]; domain: string | null }>('/api/admin/email-aliases')
      setAliases(data.data || [])
      setDomain(data.domain)
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
    setError(null)
    try {
      const res = await api.post<{ synced: boolean; syncError: string | null }>('/api/admin/email-aliases', {
        localPart, forwardTo,
      })
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
    setBusyId(a.id)
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
    setBusyId(a.id)
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
    if (!confirm(`Delete ${a.localPart}@${domain || 'your domain'}? Mail to it will stop being delivered.`)) return
    setBusyId(a.id)
    try {
      await api.delete(`/api/admin/email-aliases/${a.id}`)
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that address')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Mail className="h-6 w-6" /> Email addresses
        </h1>
        <p className="text-gray-500 mt-1">
          Create addresses on your own domain. Mail forwards to an inbox you already read.
        </p>
      </div>

      {!domain && !loading && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Connect your domain first — email addresses need a domain to live on.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      <form onSubmit={add} className="rounded-xl border bg-white p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">Add an address</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <div className="flex items-center">
              <input
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value)}
                placeholder="support"
                className="w-full rounded-l-lg border px-3 py-2"
                required
              />
              <span className="rounded-r-lg border border-l-0 bg-gray-50 px-3 py-2 text-gray-500 whitespace-nowrap">
                @{domain || 'yourdomain.com'}
              </span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Forward to</label>
            <input
              type="email"
              value={forwardTo}
              onChange={(e) => setForwardTo(e.target.value)}
              placeholder="you@gmail.com"
              className="w-full rounded-lg border px-3 py-2"
              required
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={saving || !domain}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {saving ? 'Creating…' : 'Create address'}
        </button>
      </form>

      <div className="rounded-xl border bg-white">
        <div className="border-b px-5 py-3 font-semibold text-gray-900">Your addresses</div>
        {loading ? (
          <div className="p-10 text-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400 mx-auto" /></div>
        ) : aliases.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No addresses yet. support@ is the usual first one.
          </div>
        ) : (
          <ul className="divide-y">
            {aliases.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {a.localPart}@{domain || 'yourdomain.com'}
                    {!a.enabled && <span className="ml-2 text-xs text-gray-400">paused</span>}
                  </p>
                  <p className="text-sm text-gray-500 truncate">forwards to {a.forwardTo}</p>
                  {a.syncError ? (
                    <p className="text-xs text-red-600 mt-0.5 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> Mail routing not updated: {a.syncError}
                    </p>
                  ) : a.lastSyncedAt ? (
                    <p className="text-xs text-green-700 mt-0.5 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Delivering
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {a.syncError && (
                    <button onClick={() => resync(a)} disabled={busyId === a.id} title="Retry"
                      className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => toggle(a)} disabled={busyId === a.id}
                    className="rounded-lg border px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                    {a.enabled ? 'Pause' : 'Resume'}
                  </button>
                  <button onClick={() => remove(a)} disabled={busyId === a.id} title="Delete"
                    className="rounded-lg p-2 text-red-600 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
