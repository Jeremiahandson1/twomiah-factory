// Commission summary, line items and the payroll file (salon parity row 16; server crm/salon/commissionReports.ts,
// /api/salon-reports/commissions/*). Shown on Client reports to whoever may read the commission ledger; the payroll file and the ADP
// File #s only to whoever approves payouts (the server checks both).
import { useEffect, useState } from 'react'
import { api, money, useAuth, usePermissions, useToast } from '../../../shared'
import { inputCls } from '@twomiah/tenant-ui/src/invoicing/ui'

interface Summary {
  truncated: boolean
  stylists: Array<{ id: string; name: string; lines: number; sales: number; pending: number; approved: number; paid: number; disputed: number; total: number; setAside: number }>
  totals: { lines: number; sales: number; pending: number; approved: number; paid: number; disputed: number; total: number }
}
interface Line { id: string; date: string; bill: string | null; client: string | null; stylist: string; plan: string | null; kind: string; sales: number; rate: number | null; amount: number; status: string }
const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const hint = 'mt-1 text-sm text-gray-600 dark:text-slate-300'
const STATUS_WORDS: Record<string, string> = { pending: 'Waiting', approved: 'Approved', paid: 'Paid', disputed: 'Disputed', cancelled: 'Cancelled', void: 'Voided' }
const th = 'py-1 pr-4 text-right'

export function CommissionReportsSection({ from, to }: { from: string; to: string }) {
  const { hasFeature } = useAuth()
  const { can, known } = usePermissions()
  const toast = useToast()
  const on = hasFeature('salon_commissions') && known && can('commissions:read')
  const mayPay = known && can('commissions:update')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [lines, setLines] = useState<Line[] | null>(null)
  const [error, setError] = useState('')
  const [format, setFormat] = useState<'gusto' | 'adp'>('gusto')
  const [include, setInclude] = useState('approved')
  const [coCode, setCoCode] = useState('')
  const [earningCode, setEarningCode] = useState('COMM')
  const [numbers, setNumbers] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!on) return
    let live = true
    setError(''); setLines(null)
    api.get(`/api/salon-reports/commissions/summary?from=${from}&to=${to}`)
      .then((r: Summary) => { if (live) setSummary(r) })
      .catch((e: any) => { if (live) { setSummary(null); setError(e?.message || 'The commission summary could not be loaded.') } })
    return () => { live = false }
  }, [on, from, to])
  useEffect(() => { if (on && mayPay) api.get('/api/salon-reports/commissions/file-numbers').then((r: any) => setNumbers(r.fileNumbers || {})).catch(() => setNumbers({})) }, [on, mayPay])

  if (!on) return null
  const loadLines = () => api.get(`/api/salon-reports/commissions/lines?from=${from}&to=${to}`).then((r: { lines: Line[] }) => setLines(r.lines)).catch((e: Error) => toast.error(e.message || 'The line items could not be loaded.'))
  const saveNumbers = async () => {
    try { await api.put('/api/salon-reports/commissions/file-numbers', { fileNumbers: numbers }); toast.success('File numbers saved') }
    catch (e: any) { toast.error(e?.data?.fields?.fileNumbers || e?.message || 'The file numbers were not saved.') }
  }
  const download = async () => {
    setBusy(true)
    try {
      const qs = new URLSearchParams({ from, to, format, statuses: include })
      if (format === 'adp') { qs.set('coCode', coCode.trim()); qs.set('earningCode', earningCode.trim()) }
      const res = await api.raw(`/api/salon-reports/commissions/payroll.csv?${qs}`)
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { error?: string }).error || 'The file could not be made.') }
      const name = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '')?.[1] || `commission-${from}-to-${to}.csv`
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000)
      const warned = decodeURIComponent(res.headers.get('x-payroll-warnings') || '')
      if (warned) toast.error(warned.split(' | ').join(' ')); else toast.success(`${res.headers.get('x-payroll-people') || 0} people, ${money(Number(res.headers.get('x-payroll-total') || 0))}`)
    } catch (e: any) { toast.error(e?.message || 'The file could not be made.') } finally { setBusy(false) }
  }

  return (
    <section className={box} aria-label="Commissions">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Commissions earned in this period</h2>
      <p className={hint}>By the day each commission was earned. Cancelled and voided commissions are not added in; a commission taken back after a refund is taken off.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {summary && (summary.stylists.length === 0 ? <p className={hint}>No commissions were earned in this period.</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-gray-700 dark:text-slate-300"><tr><th className="py-1 pr-4">Stylist</th><th className={th}>Commissions</th><th className={th}>Sales</th><th className={th}>Waiting</th><th className={th}>Approved</th><th className={th}>Disputed</th><th className={th}>Paid</th><th className="py-1 text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-gray-100 text-gray-900 dark:divide-slate-800 dark:text-slate-100">
              {summary.stylists.map((s) => <tr key={s.id}><td className="py-1.5 pr-4">{s.name}</td><td className="py-1.5 pr-4 text-right">{s.lines}</td><td className="py-1.5 pr-4 text-right">{money(s.sales)}</td><td className="py-1.5 pr-4 text-right">{money(s.pending)}</td><td className="py-1.5 pr-4 text-right">{money(s.approved)}</td><td className="py-1.5 pr-4 text-right">{money(s.disputed)}</td><td className="py-1.5 pr-4 text-right">{money(s.paid)}</td><td className="py-1.5 text-right font-medium">{money(s.total)}</td></tr>)}
              <tr className="font-semibold"><td className="py-1.5 pr-4">Everyone</td><td className="py-1.5 pr-4 text-right">{summary.totals.lines}</td><td className="py-1.5 pr-4 text-right">{money(summary.totals.sales)}</td><td className="py-1.5 pr-4 text-right">{money(summary.totals.pending)}</td><td className="py-1.5 pr-4 text-right">{money(summary.totals.approved)}</td><td className="py-1.5 pr-4 text-right">{money(summary.totals.disputed)}</td><td className="py-1.5 pr-4 text-right">{money(summary.totals.paid)}</td><td className="py-1.5 text-right">{money(summary.totals.total)}</td></tr>
            </tbody>
          </table>
          {summary.truncated && <p role="alert" className="mt-2 text-sm text-amber-800 dark:text-amber-200">This period has more commissions than a report can read. Choose a shorter period.</p>}
        </div>
      ))}

      <div className="mt-4">
        {lines === null ? <button type="button" onClick={loadLines} className="text-sm font-medium text-teal-800 underline dark:text-teal-200">Show every commission, line by line</button> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <caption className="pb-1 text-left font-semibold text-gray-900 dark:text-slate-100">Line items</caption>
              <thead className="text-left text-gray-700 dark:text-slate-300"><tr><th className="py-1 pr-4">Date</th><th className="py-1 pr-4">Bill</th><th className="py-1 pr-4">Client</th><th className="py-1 pr-4">Stylist</th><th className="py-1 pr-4">Plan</th><th className="py-1 pr-4">Kind</th><th className={th}>Sales</th><th className={th}>Rate</th><th className={th}>Amount</th><th className="py-1">Status</th></tr></thead>
              <tbody className="divide-y divide-gray-100 text-gray-900 dark:divide-slate-800 dark:text-slate-100">
                {lines.map((l) => <tr key={l.id}><td className="py-1 pr-4">{l.date}</td><td className="py-1 pr-4">{l.bill ?? '—'}</td><td className="py-1 pr-4">{l.client ?? '—'}</td><td className="py-1 pr-4">{l.stylist}</td><td className="py-1 pr-4">{l.plan ?? '—'}</td><td className="py-1 pr-4">{l.kind}</td><td className="py-1 pr-4 text-right">{money(l.sales)}</td><td className="py-1 pr-4 text-right">{l.rate == null ? '—' : `${l.rate}%`}</td><td className="py-1 pr-4 text-right font-medium">{money(l.amount)}</td><td className="py-1">{STATUS_WORDS[l.status] || l.status}</td></tr>)}
              </tbody>
            </table>
            {lines.length === 0 && <p className={hint}>Nothing in this period.</p>}
          </div>
        )}
      </div>

      {mayPay && (
        <div className="mt-5 border-t border-gray-200 pt-4 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Payroll file</h3>
          <p className={hint}>What each stylist is owed for this period, to upload to your payroll. Marking commissions paid is still done on Commissions.</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium text-gray-900 dark:text-slate-100">For<select value={format} onChange={(e) => setFormat(e.target.value as 'gusto' | 'adp')} className={inputCls + ' mt-1'}><option value="gusto">Gusto</option><option value="adp">ADP</option></select></label>
            <label className="text-sm font-medium text-gray-900 dark:text-slate-100">Include<select value={include} onChange={(e) => setInclude(e.target.value)} className={inputCls + ' mt-1'}><option value="approved">Approved commissions</option><option value="approved,pending">Approved and waiting</option><option value="approved,pending,disputed">Approved, waiting and disputed</option><option value="paid">Already paid (a copy)</option></select></label>
            {format === 'adp' && (
              <>
                <label className="text-sm font-medium text-gray-900 dark:text-slate-100">ADP company code<input value={coCode} onChange={(e) => setCoCode(e.target.value)} className={inputCls + ' mt-1 w-32'} /></label>
                <label className="text-sm font-medium text-gray-900 dark:text-slate-100">Earnings code<input value={earningCode} onChange={(e) => setEarningCode(e.target.value)} className={inputCls + ' mt-1 w-28'} /></label>
              </>
            )}
            <button type="button" onClick={download} disabled={busy || (format === 'adp' && !coCode.trim())} className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-50">{busy ? 'Making the file…' : 'Download the file'}</button>
          </div>
          {format === 'adp' && summary && (
            <div className="mt-3">
              <p className={hint}>ADP matches people by File #. Enter each stylist&rsquo;s number from ADP.</p>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {summary.stylists.map((s) => (
                  <label key={s.id} className="text-sm text-gray-900 dark:text-slate-100">{s.name}
                    <input value={numbers[s.id] ?? ''} maxLength={20} onChange={(e) => setNumbers({ ...numbers, [s.id]: e.target.value })} className={inputCls + ' mt-1 w-full'} />
                  </label>
                ))}
              </div>
              <button type="button" onClick={saveNumbers} className="mt-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-slate-800">Save file numbers</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
