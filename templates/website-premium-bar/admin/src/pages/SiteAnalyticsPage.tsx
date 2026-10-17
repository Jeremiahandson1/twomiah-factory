import { useEffect, useState } from 'react'
import { api } from '../api/client'

// First-party traffic + leads — the owner's "is my site working" page.
// Counted server-side per render (no cookies, no consent banner needed).

interface Analytics {
  viewsLast30: number
  viewsPrev30: number
  leadsLast30: number
  leadsPrev30: number
  topPages: Array<{ path: string; count: number }>
}

function Delta({ now, prev }: { now: number; prev: number }) {
  if (prev === 0) return null
  const pct = Math.round(((now - prev) / prev) * 100)
  return <span className={'text-xs ml-2 ' + (pct >= 0 ? 'text-green-600' : 'text-red-600')}>{pct >= 0 ? '+' : ''}{pct}% vs prior 30 days</span>
}

export function SiteAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<Analytics>('/api/admin/analytics').then(setData).catch((e: any) => setError(e?.message || 'Could not load analytics'))
  }, [])

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>
  if (!data) return <div className="p-6 text-sm text-slate-500">Loading…</div>

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl text-ink mb-1">Traffic</h1>
      <p className="text-sm text-slate-500 mb-6">Counted on your own site — no Google account needed. Add tracking IDs in Settings for deeper tools.</p>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="card card-padding">
          <div className="text-sm text-slate-500 mb-1">Page views · last 30 days</div>
          <div className="text-3xl text-ink font-semibold">{data.viewsLast30.toLocaleString()}<Delta now={data.viewsLast30} prev={data.viewsPrev30} /></div>
        </div>
        <div className="card card-padding">
          <div className="text-sm text-slate-500 mb-1">Leads · last 30 days</div>
          <div className="text-3xl text-ink font-semibold">{data.leadsLast30.toLocaleString()}<Delta now={data.leadsLast30} prev={data.leadsPrev30} /></div>
        </div>
      </div>
      <div className="card card-padding">
        <div className="text-sm text-slate-500 mb-3">Most-viewed pages · last 30 days</div>
        {data.topPages.length === 0 && <p className="text-sm text-slate-400">No views recorded yet.</p>}
        {data.topPages.map(p => (
          <div key={p.path} className="flex justify-between text-sm py-1 border-b border-line last:border-0">
            <span className="font-mono">{p.path}</span><span>{p.count.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
