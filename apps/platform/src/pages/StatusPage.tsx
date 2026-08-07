// Staff side of the public status page (item 17).
//
// Shows exactly what customers see at <API_URL>/status — the same measured
// component states — plus the controls to post and resolve incidents. An open
// incident forces its component's public state down, so this page is how a
// known problem gets told to customers instead of sitting in a Slack thread.

import { useEffect, useState } from 'react'
import { supabase, API_URL } from '../supabase'
import { Activity, AlertTriangle, CheckCircle2, ExternalLink, Plus, X } from 'lucide-react'

type ComponentState = 'operational' | 'degraded' | 'down' | 'unknown'

type StatusComponent = {
  key: string
  name: string
  state: ComponentState
  detail: string
  // Operator-only; deliberately absent from the public page's rendering.
  operatorNote?: string
}

type Incident = {
  id: string
  component: string
  impact: string
  title: string
  body: string | null
  started_at: string
  resolved_at: string | null
  created_by: string | null
}

type StatusPayload = {
  overall: ComponentState
  summary: string
  checkedAt: string
  components: StatusComponent[]
  incidents: { open: Incident[]; recent: Incident[] }
}

const COMPONENTS = ['api', 'database', 'tenants', 'provisioning', 'email', 'payments', 'other']
const IMPACTS = ['degraded', 'down', 'maintenance']

const STATE_STYLE: Record<ComponentState, string> = {
  operational: 'text-green-400',
  degraded: 'text-amber-400',
  down: 'text-red-400',
  unknown: 'text-gray-400',
}

const STATE_LABEL: Record<ComponentState, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'Not reporting',
}

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(API_URL + '/api/v1/factory' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session?.access_token, ...(opts?.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || 'Request failed')
  return body
}

export default function StatusPage() {
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tableMissing, setTableMissing] = useState<string | null>(null)

  const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [component, setComponent] = useState('tenants')
  const [impact, setImpact] = useState('degraded')
  const [saving, setSaving] = useState(false)

  const loadStatus = async () => {
    try {
      // Public endpoint on purpose — this is the exact payload customers get.
      const res = await fetch(API_URL + '/api/v1/factory/public/status', { cache: 'no-store' })
      setStatus(await res.json())
      setError(null)
    } catch {
      setError('Could not reach the status service')
    }
  }

  const loadIncidents = async () => {
    try {
      const res = await apiFetch('/status/incidents')
      setIncidents(res.data || [])
      setTableMissing(res.error || null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load incidents')
    }
  }

  useEffect(() => {
    Promise.all([loadStatus(), loadIncidents()]).finally(() => setLoading(false))
    const timer = setInterval(loadStatus, 60000)
    return () => clearInterval(timer)
  }, [])

  const createIncident = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      await apiFetch('/status/incidents', {
        method: 'POST',
        body: JSON.stringify({ title, body, component, impact }),
      })
      setTitle(''); setBody(''); setComposing(false)
      await Promise.all([loadIncidents(), loadStatus()])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not post that incident')
    } finally {
      setSaving(false)
    }
  }

  const setResolved = async (id: string, resolved: boolean) => {
    try {
      await apiFetch('/status/incidents/' + id, { method: 'PATCH', body: JSON.stringify({ resolved }) })
      await Promise.all([loadIncidents(), loadStatus()])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update that incident')
    }
  }

  const open = incidents.filter(i => !i.resolved_at)
  const resolved = incidents.filter(i => i.resolved_at).slice(0, 15)

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6" /> Status
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            What customers see, measured live. Post an incident and it appears on the public page immediately.
          </p>
        </div>
        <a
          href={API_URL + '/status'}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300"
        >
          Public page <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}
      {tableMissing && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          {tableMissing}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : (
        <>
          <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <span className={'font-semibold ' + (status ? STATE_STYLE[status.overall] : 'text-gray-400')}>
                {status?.summary || 'Unknown'}
              </span>
              <span className="text-xs text-gray-500">
                {status ? 'Checked ' + new Date(status.checkedAt).toLocaleTimeString() : ''}
              </span>
            </div>
            {(status?.components || []).map(comp => (
              <div key={comp.key} className="px-5 py-3 border-b border-white/5 last:border-0 flex items-center justify-between gap-4">
                <div>
                  <p className="text-white font-medium">{comp.name}</p>
                  <p className="text-xs text-gray-500">{comp.detail}</p>
                  {comp.operatorNote && (
                    <p className="text-xs text-amber-400/80 mt-0.5">{comp.operatorNote}</p>
                  )}
                </div>
                <span className={'text-sm font-semibold whitespace-nowrap ' + STATE_STYLE[comp.state]}>
                  {STATE_LABEL[comp.state]}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-white">Incidents</h2>
            <button
              onClick={() => setComposing(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
            >
              {composing ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {composing ? 'Cancel' : 'Post incident'}
            </button>
          </div>

          {composing && (
            <form onSubmit={createIncident} className="rounded-xl border border-white/10 bg-white/5 p-4 mb-5 space-y-3">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                placeholder="What customers should know, in one line"
                className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white"
              />
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={3}
                placeholder="What is affected, what we are doing, when we will update next."
                className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white"
              />
              <div className="flex gap-3">
                <select value={component} onChange={e => setComponent(e.target.value)}
                  className="px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white">
                  {COMPONENTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={impact} onChange={e => setImpact(e.target.value)}
                  className="px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white">
                  {IMPACTS.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
                <button type="submit" disabled={saving || !title.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm">
                  {saving ? 'Posting…' : 'Post'}
                </button>
              </div>
            </form>
          )}

          {open.length === 0 && resolved.length === 0 && !tableMissing && (
            <p className="text-gray-500 text-sm">No incidents have ever been posted.</p>
          )}

          {open.map(inc => (
            <div key={inc.id} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 mb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-white font-medium flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" /> {inc.title}
                  </p>
                  {inc.body && <p className="text-sm text-gray-300 mt-1 whitespace-pre-wrap">{inc.body}</p>}
                  <p className="text-xs text-gray-500 mt-2">
                    {inc.component} · {inc.impact} · started {new Date(inc.started_at).toLocaleString()}
                    {inc.created_by ? ' · ' + inc.created_by : ''}
                  </p>
                </div>
                <button onClick={() => setResolved(inc.id, true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg whitespace-nowrap">
                  <CheckCircle2 className="w-4 h-4" /> Resolve
                </button>
              </div>
            </div>
          ))}

          {resolved.map(inc => (
            <div key={inc.id} className="rounded-xl border border-white/10 bg-white/5 p-4 mb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-gray-200 font-medium">{inc.title}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {inc.component} · resolved {inc.resolved_at ? new Date(inc.resolved_at).toLocaleString() : ''}
                  </p>
                </div>
                <button onClick={() => setResolved(inc.id, false)}
                  className="px-3 py-1.5 text-sm text-gray-300 hover:text-white border border-white/10 rounded-lg whitespace-nowrap">
                  Reopen
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
