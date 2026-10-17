import React, { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useMayWrite, usePermissions } from '../auth/PermissionsContext'
import { useAuth } from '../auth/AuthContext'

// Call Tracking › Settings — where the owner pastes the CallRail webhook signing key.
//
// Every CallRail webhook is now verified against that key (Base64 HMAC-SHA1 of the raw body); without
// one, production refuses CallRail's calls with a 403 that says the key is missing. The key is
// WRITE-ONLY: the server answers only whether one is set, never the key, so this screen shows
// "Set" / "Not set" and offers Replace / Remove. Owner and admins only (integrations:update) — the
// server refuses everyone else, and the page hides the tab from them. (10/15)

interface CallTrackingSettingsData {
  callrailSigningKeySet: boolean
  callrailWebhookUrl?: string
}

/**
 * The panel as a section of another page (Settings › Integrations, for a template with no Call Tracking page):
 * rendered only where the API would answer — Call Tracking switched on (the router's requireEnabledFeature) and
 * integrations:update held (the route's own right), with the permission list KNOWN, so nobody is offered a
 * control the server refuses. Nothing at all otherwise, header included.
 */
export function CallTrackingSection({ header }: { header?: React.ReactNode }): React.ReactElement | null {
  const { hasFeature } = useAuth()
  const { known, can } = usePermissions()
  if (!(hasFeature('call_tracking') && known && can('integrations:update'))) return null
  return <>{header}<CallTrackingSettings /></>
}

export function CallTrackingSettings(): React.ReactElement {
  // PUT /api/calltracking/settings asks integrations:update (homecare: requireAdmin, and it mounts no provider → yes).
  const mayWrite = useMayWrite('integrations:update')
  const [data, setData] = useState<CallTrackingSettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refused, setRefused] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const load = async () => {
    try {
      const r = await api.raw('/api/calltracking/settings')
      if (r.status === 403) { setRefused(true); return }
      const d = await r.json().catch(() => null)
      if (!r.ok) { setError((d && d.error) || 'Could not load call tracking settings'); return }
      setData(d)
    } catch { setError('Could not load call tracking settings') } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const save = async (value: string | null) => {
    setBusy(true); setError(''); setSaved('')
    try {
      const r = await api.raw('/api/calltracking/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callrailSigningKey: value }) })
      const d = await r.json().catch(() => null)
      if (!r.ok) { setError((d && d.error) || 'Could not save the signing key'); return }
      setData((prev) => ({ ...(prev || {}), callrailSigningKeySet: !!(d && d.callrailSigningKeySet) }))
      setKey('')
      setSaved(value ? 'Signing key saved.' : 'Signing key removed.')
    } catch { setError('Could not save the signing key') } finally { setBusy(false) }
  }

  if (loading) return <div className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">Loading…</div>
  if (refused || !mayWrite) return <div className="p-6 text-sm text-gray-600 dark:text-slate-300">Only the owner and admins can change call tracking settings.</div>

  const isSet = !!data?.callrailSigningKeySet
  return (
    <div className="bg-white rounded-xl border overflow-hidden dark:bg-slate-900 dark:border-slate-700">
      <div className="p-4 border-b dark:border-slate-700">
        <h3 className="font-medium text-gray-900 dark:text-slate-100">CallRail</h3>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          CallRail signs every webhook it sends. Paste your CallRail signing key here and calls from any other sender are refused.
        </p>
      </div>
      <div className="p-4 space-y-4">
        {data?.callrailWebhookUrl && (
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-slate-200">Webhook URL to enter in CallRail</div>
            <code className="mt-1 block break-all rounded bg-gray-100 px-2 py-1 text-sm text-gray-800 dark:bg-slate-800 dark:text-slate-100">{data.callrailWebhookUrl}</code>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-gray-700 dark:text-slate-200">Signing key:</span>
          {isSet
            ? <span className="rounded px-2 py-0.5 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">Set</span>
            : <span className="rounded px-2 py-0.5 bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100">Not set — CallRail webhooks are refused</span>}
        </div>
        <div>
          <label htmlFor="callrail-signing-key" className="block text-sm font-medium text-gray-700 dark:text-slate-200">{isSet ? 'Replace signing key' : 'Signing key'}</label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input
              id="callrail-signing-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste the key from CallRail"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600"
            />
            <button
              type="button"
              disabled={busy || !key.trim()}
              onClick={() => save(key.trim())}
              className="px-4 py-2 bg-orange-700 hover:bg-orange-900 disabled:bg-gray-300 disabled:text-gray-700 text-white rounded-md text-sm font-semibold"
            >
              {busy ? 'Saving…' : 'Save key'}
            </button>
            {isSet && (
              <button
                type="button"
                disabled={busy}
                onClick={() => save(null)}
                className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-md text-sm dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Remove
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">The key is stored and never shown again — not to you, not to anyone.</p>
        </div>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        {saved && <p role="status" className="text-sm text-green-700 dark:text-green-300">{saved}</p>}
      </div>
    </div>
  )
}
