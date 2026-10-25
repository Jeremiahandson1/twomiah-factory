// Billing a quote in parts, beside the quote and beside its job (server crm/billing/quoteBilling.ts): what is billed
// against what is left, the deposit and progress invoices, and — on an approved quote — billing a percent or chosen
// lines now. The quote's own "Create Invoice" is the final invoice: it bills what is left, crediting these.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Receipt, Loader2 } from 'lucide-react'
import { api } from '../api'
import { useAuth, useToast } from '../shared'
import { money } from '@twomiah/tenant-ui/src/money'
import { NumberInput } from '@twomiah/tenant-ui/src/invoicing/ui'

const client = api as any
const errMsg = (e: unknown, fallback: string) => (e as Error)?.message || fallback

interface Billed { id: string; number: string; status: string; billKind: string | null; total: string; balance: number; isFinal: boolean }
interface Summary {
  quoteId: string | null; number: string; status: string; total: string; billed: string; remaining: string; depositAsked: string
  invoicedInFull: boolean; invoices: Billed[]; lines: Array<{ id: string; description: string; share: string; billed: boolean }>
}

/** What each invoice is, in words. */
const KIND_WORDS: Record<string, string> = { deposit: 'Deposit', progress: 'Progress', final: 'Final' }
const kindWords = (b: Billed) => (b.billKind ? KIND_WORDS[b.billKind] || 'Invoice' : b.isFinal ? 'Final' : 'Invoice')

function BillingPanel({ path, title, quoteLink }: { path: string; title: string; quoteLink?: boolean }) {
  const { hasFeature, can } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const show = hasFeature('invoices') && can('invoices:read')
  const [data, setData] = useState<Summary | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'percent' | 'lines'>('percent')
  const [percent, setPercent] = useState(0)
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { setData(await client.get(path)); setError(''); setMissing(false) }
    catch (e: any) { if (e?.status === 404) setMissing(true); else setError(errMsg(e, 'Could not load the billing')) }
  }, [path])
  useEffect(() => { if (show) load() }, [show, load])
  if (!show || missing || (data && !data.quoteId)) return null
  const open = !!data && data.status === 'approved' && !data.invoicedInFull && Number(data.remaining) > 0
  const mayBill = can('invoices:create')
  const bill = async () => {
    setBusy(true)
    try {
      const inv = await client.post(`${path}/progress`, mode === 'percent' ? { percent } : { lineItemIds: chosen })
      toast.success(`Progress invoice ${inv.number} created`)
      setChosen([]); setPercent(0)
      if (inv?.id) navigate(`/crm/invoices/${inv.id}`)
    } catch (e) { toast.error(errMsg(e, 'Could not bill that')) } finally { setBusy(false) }
  }
  const chosenTotal = (data?.lines || []).filter((l) => chosen.includes(l.id)).reduce((s, l) => s + Number(l.share), 0)
  const percentTotal = data ? Number(data.total) * Math.min(100, Math.max(0, percent)) / 100 : 0
  return (
    <section aria-label={title} data-testid="quote-billing-panel" className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 text-sm text-gray-900 dark:text-slate-100">
      <h2 className="font-semibold mb-3 flex items-center gap-2"><Receipt className="w-4 h-4" aria-hidden="true" />{title}</h2>
      {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
      {!data && !error && <p className="text-gray-600 dark:text-slate-300">Loading…</p>}
      {data && (
        <>
          {quoteLink && <p className="mb-2 text-gray-700 dark:text-slate-300">Against quote <Link to={`/crm/quotes/${data.quoteId}`} className="font-medium text-orange-700 underline dark:text-orange-200">{data.number}</Link></p>}
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-gray-50 p-2 dark:bg-slate-800"><dt className="text-xs text-gray-600 dark:text-slate-300">Quote</dt><dd className="font-semibold">{money(data.total)}</dd></div>
            <div className="rounded-lg bg-gray-50 p-2 dark:bg-slate-800"><dt className="text-xs text-gray-600 dark:text-slate-300">Billed</dt><dd className="font-semibold" data-testid="billed-amount">{money(data.billed)}</dd></div>
            <div className="rounded-lg bg-gray-50 p-2 dark:bg-slate-800"><dt className="text-xs text-gray-600 dark:text-slate-300">Remaining</dt><dd className="font-semibold" data-testid="remaining-amount">{money(data.remaining)}</dd></div>
          </dl>
          {Number(data.depositAsked) > 0 && <p className="mt-3 text-gray-700 dark:text-slate-300">Deposit on approval: {money(data.depositAsked)}{data.status !== 'approved' ? ' — invoiced when the quote is approved.' : '.'}</p>}
          {data.invoices.length > 0 && (
            <ul className="mt-3 divide-y divide-gray-100 dark:divide-slate-800">
              {data.invoices.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span><span className="text-gray-600 dark:text-slate-300">{kindWords(b)} </span>{can('invoices:read') ? <Link to={`/crm/invoices/${b.id}`} className="font-medium text-orange-700 underline dark:text-orange-200">{b.number}</Link> : b.number}</span>
                  <span className="text-right">{money(b.total)}{Number(b.balance) > 0 ? <span className="block text-xs text-gray-600 dark:text-slate-300">{money(b.balance)} owed</span> : <span className="block text-xs text-green-700 dark:text-green-300">paid</span>}</span>
                </li>
              ))}
            </ul>
          )}
          {open && mayBill && (
            <div className="mt-4 border-t border-gray-200 pt-3 dark:border-slate-800">
              <p className="font-medium">Bill part of it now</p>
              <div className="mt-2 flex gap-4" role="radiogroup" aria-label="How to bill">
                <label className="flex items-center gap-1.5"><input type="radio" name={`${path}-mode`} checked={mode === 'percent'} onChange={() => setMode('percent')} /> A percent</label>
                <label className="flex items-center gap-1.5"><input type="radio" name={`${path}-mode`} checked={mode === 'lines'} onChange={() => setMode('lines')} /> Chosen lines</label>
              </div>
              {mode === 'percent' ? (
                <div className="mt-2 flex items-center gap-2">
                  <NumberInput min="0" max="100" step="1" value={percent} onValue={setPercent} aria-label="Percent of the quote to bill" className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800" />
                  <span>% = {money(percentTotal)}</span>
                </div>
              ) : (
                <ul className="mt-2 space-y-1">
                  {data.lines.map((l) => (
                    <li key={l.id}><label className={`flex items-start gap-2 ${l.billed ? 'text-gray-500 dark:text-slate-400' : ''}`}>
                      <input type="checkbox" className="mt-1" disabled={l.billed} checked={chosen.includes(l.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, l.id] : c.filter((x) => x !== l.id)))} />
                      <span className="flex-1">{l.description}{l.billed ? ' (billed)' : ''}</span><span>{money(l.share)}</span>
                    </label></li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={bill} disabled={busy || (mode === 'percent' ? !(percent > 0) : !chosen.length)} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-orange-700 px-4 py-2 font-medium text-white hover:bg-orange-800 disabled:opacity-50">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}Create progress invoice{mode === 'lines' && chosen.length ? ` (${money(chosenTotal)})` : ''}
              </button>
              <p className="mt-2 text-xs text-gray-600 dark:text-slate-300">The quote's Create Invoice bills the remaining {money(data.remaining)} as the final invoice, crediting what was billed.</p>
            </div>
          )}
          {data.invoicedInFull && <p className="mt-3 text-green-800 dark:text-green-300">Billed in full.</p>}
        </>
      )}
    </section>
  )
}

/** Beside a quote: once it has a deposit asked, or once it is approved. */
export function QuoteBillingPanel({ record }: { record: Record<string, any> }) {
  if (!record?.id || (record.status !== 'approved' && !record.depositType)) return null
  return <BillingPanel path={`/api/quote-billing/quotes/${record.id}`} title="Billing" />
}

/** Beside a job: the billing of its approved quote; nothing for a job without one. */
export function JobBillingPanel({ job }: { job: Record<string, any> }) {
  if (!job?.id) return null
  return <BillingPanel path={`/api/quote-billing/jobs/${job.id}`} title="Billing" quoteLink />
}
