import { useEffect, useState } from 'react'
import { Shield } from 'lucide-react'
import { api } from '../api/client'

interface Entry {
  id: string
  userEmail: string | null
  action: string
  target: string | null
  ip: string | null
  userAgent: string | null
  meta: any
  createdAt: string
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<{ entries: Entry[] }>('/api/admin/audit?limit=200')
      .then(({ entries }) => setEntries(entries))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center gap-3">
        <Shield className="w-6 h-6 text-ink-soft" />
        <div>
          <h1 className="text-3xl text-ink">Activity log</h1>
          <p className="text-muted text-sm mt-1">Every sign-in, edit, and admin action — most recent first.</p>
        </div>
      </div>

      {loading && <div className="text-muted text-sm">Loading…</div>}
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

      {!loading && entries.length === 0 && (
        <div className="card card-padding text-center text-muted">No activity yet.</div>
      )}

      {!loading && entries.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper border-b border-line">
              <tr className="text-left text-ink-soft text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">When</th>
                <th className="px-5 py-3 font-semibold">Who</th>
                <th className="px-5 py-3 font-semibold">Action</th>
                <th className="px-5 py-3 font-semibold">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-paper/50">
                  <td className="px-5 py-3 text-muted text-xs whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td className="px-5 py-3 text-ink text-xs font-mono">{e.userEmail || '—'}</td>
                  <td className="px-5 py-3 text-ink">
                    <span className="font-mono text-xs">{e.action}</span>
                    {e.target && <span className="text-muted text-xs ml-2">{e.target}</span>}
                  </td>
                  <td className="px-5 py-3 text-muted text-xs font-mono">{e.ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
