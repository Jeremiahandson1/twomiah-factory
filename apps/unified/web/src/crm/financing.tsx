// Consumer financing's screens (server/crm/financing): the lender card in Settings › Integrations, the panel on a quote
// and an invoice, and the Financing page. Each shows only with consumer_financing on — a not-ready feature, on for
// nobody until a real lender sandbox run passes — and asks the permission its door asks (routes.ts).
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Landmark, Loader2, Copy, MessageSquare, Mail, ExternalLink, Check, RefreshCw } from 'lucide-react'
import { api } from '../api'
import { useAuth, useToast, useConfirm } from '../shared'
import { money } from '@twomiah/tenant-ui/src/money'
import { dateTime } from '@twomiah/tenant-ui/src/invoicing/ui'

const client = api as any
const errMsg = (e: unknown, fallback: string) => (e as Error)?.message || fallback

export interface Offer { lender: string; amount: number; asLowAs: number; apr: number; termMonths: number; disclosure: string }
export interface Application {
  id: string; status: string; lenderStatus: string | null; amount: number; fundedAmount: number | null; fundedAt: string | null; paymentId: string | null
  applyUrl: string | null; sentAt: string | null; sentVia: string | null; createdAt: string; updatedAt: string; reportsBack: boolean
  contact: { id: string; name: string } | null; quote: { id: string; number: string } | null; invoice: { id: string; number: string } | null; job: { id: string; number: string; title: string } | null
}

export const STATUS: Record<string, { label: string; tone: string }> = {
  not_started: { label: 'Not started', tone: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200' },
  pending: { label: 'In progress', tone: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200' },
  prequalified: { label: 'Prequalified', tone: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200' },
  action_required: { label: 'Action required', tone: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' },
  approved: { label: 'Approved', tone: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' },
  confirmed: { label: 'Confirmed', tone: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' },
  funded: { label: 'Paid out', tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' },
  declined: { label: 'Declined', tone: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' },
  expired: { label: 'Expired', tone: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200' },
  canceled: { label: 'Canceled', tone: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200' },
}
const FINAL = ['funded', 'declined', 'expired', 'canceled']
export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] || { label: status, tone: STATUS.not_started.tone }
  return <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${s.tone}`} data-testid="financing-status">{s.label}</span>
}

/** The lender's footnote: what the estimate is, and the disclosure every mention of a payment needs. */
export function OfferFootnote({ offer }: { offer: Offer }) {
  return <p className="text-xs text-gray-600 dark:text-slate-400 mt-2">*Estimate on {money(offer.amount)}: {money(offer.asLowAs)}/mo for {offer.termMonths} months at {offer.apr}% APR. {offer.disclosure}</p>
}

const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-60'
const primary = `${btn} bg-emerald-700 text-white hover:bg-emerald-800`
const secondary = `${btn} bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600`

/** Text, email or copy one application's link (the panel and the Financing page). */
function SendLink({ app, onSent }: { app: Application; onSent: () => void }) {
  const toast = useToast()
  const { can } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)
  if (FINAL.includes(app.status) || !app.applyUrl) return null
  const send = async (channel: 'sms' | 'email') => {
    setBusy(channel)
    try { await client.post(`/api/financing/applications/${app.id}/send`, { channel }); toast.success(channel === 'sms' ? 'Application link texted' : 'Application link emailed'); onSent() }
    catch (e) { toast.error(errMsg(e, 'The link was not sent')) } finally { setBusy(null) }
  }
  const copy = async () => { try { await navigator.clipboard.writeText(app.applyUrl || ''); toast.success('Link copied') } catch { toast.error('Could not copy — the link is shown above') } }
  return (
    <div className="flex flex-wrap gap-2">
      {can('financing:create') && <button type="button" className={secondary} onClick={() => send('sms')} disabled={!!busy}>{busy === 'sms' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}Text link</button>}
      {can('financing:create') && <button type="button" className={secondary} onClick={() => send('email')} disabled={!!busy}>{busy === 'email' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}Email link</button>}
      <button type="button" className={secondary} onClick={copy}><Copy className="w-4 h-4" />Copy link</button>
    </div>
  )
}

// ── The panel on a quote or an invoice ───────────────────────────────────────────────────────────────────────────────
export function FinancingPanel({ kind, record }: { kind: 'quote' | 'invoice'; record: Record<string, any> }) {
  const { hasFeature, can } = useAuth()
  const toast = useToast()
  const [data, setData] = useState<{ offer: Offer | null; reason: string | null; connected: boolean; applications: Application[] } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const show = hasFeature('consumer_financing') && can('financing:read')
  const path = `/api/financing/${kind === 'quote' ? 'quotes' : 'invoices'}/${record.id}`
  const load = useCallback(async () => {
    try { setData(await client.get(path)); setError('') } catch (e) { setError(errMsg(e, 'Could not load financing')) }
  }, [path])
  // Again when the money on the document changes (a payment taken on the invoice changes what is owed).
  useEffect(() => { if (show) load() }, [show, load, record.total, record.amountPaid, record.status])
  if (!show) return null
  const open = async () => {
    setBusy(true)
    try { await client.post(`${path}/applications`, {}); toast.success('Application link ready'); await load() } catch (e) { toast.error(errMsg(e, 'Could not start the application')) } finally { setBusy(false) }
  }
  const live = data?.applications.filter((a) => !FINAL.includes(a.status)) || []
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 text-sm text-gray-900 dark:text-slate-100" data-testid="financing-panel">
      <h2 className="font-semibold mb-3 flex items-center gap-2"><Landmark className="w-4 h-4" />Customer financing</h2>
      {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
      {!data && !error && <p className="text-gray-600 dark:text-slate-400">Loading…</p>}
      {data && !data.offer && (
        <p className="text-gray-700 dark:text-slate-300">{data.reason}{!data.connected && can('integrations:update') && <> <Link to="/crm/settings/integrations" className="text-emerald-800 dark:text-emerald-300 underline">Settings › Integrations</Link></>}</p>
      )}
      {data?.offer && (
        <>
          <p className="text-2xl font-bold" data-testid="financing-as-low-as">As low as {money(data.offer.asLowAs)}/mo*</p>
          <p className="text-gray-600 dark:text-slate-400">Your customer applies with {data.offer.lender}; checking their options won't affect their credit score.</p>
          {can('financing:create') && live.length === 0 && (
            <button type="button" className={`${primary} mt-3`} onClick={open} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}Create application link</button>
          )}
        </>
      )}
      {data && data.applications.length > 0 && (
        <ul className="mt-4 space-y-3">
          {data.applications.map((a) => (
            <li key={a.id} className="border border-gray-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{money(a.amount)}</span><StatusPill status={a.status} /></div>
              {a.applyUrl && !FINAL.includes(a.status) && <p className="text-xs text-gray-600 dark:text-slate-400 break-all">{a.applyUrl}</p>}
              {a.sentAt && <p className="text-xs text-gray-600 dark:text-slate-400">Sent by {a.sentVia === 'sms' ? 'text' : 'email'} {dateTime(a.sentAt)}</p>}
              {a.status === 'funded' && <p className="text-xs text-emerald-800 dark:text-emerald-300">{a.paymentId ? 'Recorded as a payment on the invoice.' : 'Paid out — record it from the Financing page once the invoice exists.'}</p>}
              <SendLink app={a} onSent={load} />
            </li>
          ))}
        </ul>
      )}
      {data?.offer && <OfferFootnote offer={data.offer} />}
    </div>
  )
}

// ── Settings › Integrations: the lender account ──────────────────────────────────────────────────────────────────────
interface Status { lender: string; connected: boolean; merchantId: string | null; prequalUrl: string | null; connectedAt: string | null; partnerApi: boolean; webhooks: boolean; minAmount: number; maxAmount: number; signupUrl: string }

export function FinancingIntegrationCard() {
  const { hasFeature, can } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [st, setSt] = useState<Status | null>(null)
  const [form, setForm] = useState({ merchantId: '', prequalUrl: '' })
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const show = hasFeature('consumer_financing')
  useEffect(() => { if (show) client.get('/api/financing/status').then(setSt).catch((e: unknown) => toast.error(errMsg(e, 'Could not load the lender account'))) }, [show]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!show) return null
  const connect = async () => {
    setBusy(true); setFields({})
    try { setSt(await client.put('/api/financing/connection', form)); toast.success('Wisetack connected') }
    catch (e: any) { setFields(e?.fields || e?.data?.fields || {}); toast.error(errMsg(e, 'Could not connect')) } finally { setBusy(false) }
  }
  const disconnect = async () => {
    if (!(await confirm('Disconnect Wisetack? Quotes and invoices stop offering financing; applications already made stay listed.', { title: 'Disconnect Wisetack', confirmText: 'Disconnect' }))) return
    setBusy(true)
    try { setSt(await client.delete('/api/financing/connection')); toast.success('Wisetack disconnected') } catch (e) { toast.error(errMsg(e, 'Could not disconnect')) } finally { setBusy(false) }
  }
  const box = 'w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white border-gray-300 dark:border-slate-600'
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6" data-testid="financing-integration">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-500/20 rounded-xl flex items-center justify-center flex-shrink-0"><Landmark className="w-6 h-6 text-emerald-800 dark:text-emerald-300" /></div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-white">Customer financing — Wisetack</h3>
          <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">Customers apply for a loan from your quote or invoice; Wisetack pays you. Wisetack charges you a fee on each financed job (3.9% at the time of writing); your customer is never charged it.</p>
          {!st && <p className="text-sm text-gray-600 dark:text-slate-400 mt-3">Loading…</p>}
          {st?.connected && (
            <div className="mt-3 space-y-1 text-sm">
              <p className="text-green-800 dark:text-green-300 font-medium flex items-center gap-1"><Check className="w-4 h-4" />Connected — merchant {st.merchantId}</p>
              <p className="text-gray-600 dark:text-slate-400 break-all">Application link: {st.prequalUrl}</p>
              <p className="text-gray-600 dark:text-slate-400">{st.partnerApi && st.webhooks ? 'Each quote and invoice gets its own application, and Wisetack reports its progress here.' : 'Applications use your Wisetack link. Wisetack does not report their progress here yet — check your Wisetack portal and update them on the Financing page.'}</p>
              {can('integrations:update') && <button type="button" onClick={disconnect} disabled={busy} className="mt-2 px-3 py-2 text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg">Disconnect</button>}
            </div>
          )}
          {st && !st.connected && (
            <div className="mt-4 space-y-3">
              <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-700 dark:text-slate-300">
                <li>Apply for a Wisetack merchant account: <a href={st.signupUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-800 dark:text-emerald-300 underline">wisetack.com</a>. Wisetack reviews the business and links your bank account.</li>
                <li>Once approved, sign in to your Wisetack merchant portal and open Account settings › Merchant information.</li>
                <li>Copy your merchant ID and your prequalification link, paste them below, and press Connect.</li>
                <li>Wisetack asks to see how its offer appears on your quotes before you send them — open a quote here and send Wisetack a screenshot of the Customer financing panel.</li>
              </ol>
              {can('integrations:update') ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label htmlFor="fin-merchant" className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Merchant ID</label>
                      <input id="fin-merchant" value={form.merchantId} onChange={(e) => setForm((f) => ({ ...f, merchantId: e.target.value }))} aria-invalid={!!fields.merchantId} className={box} />
                      {fields.merchantId && <p className="text-xs text-red-700 dark:text-red-300 mt-1">{fields.merchantId}</p>}</div>
                    <div><label htmlFor="fin-link" className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Prequalification link</label>
                      <input id="fin-link" type="url" value={form.prequalUrl} onChange={(e) => setForm((f) => ({ ...f, prequalUrl: e.target.value }))} placeholder="https://…" aria-invalid={!!fields.prequalUrl} className={box} />
                      {fields.prequalUrl && <p className="text-xs text-red-700 dark:text-red-300 mt-1">{fields.prequalUrl}</p>}</div>
                  </div>
                  <button type="button" onClick={connect} disabled={busy} className={primary}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Connect</button>
                </>
              ) : <p className="text-sm text-gray-600 dark:text-slate-400">An owner or admin connects the account.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── The Financing page ───────────────────────────────────────────────────────────────────────────────────────────────
const FILTERS: Array<[string, string]> = [['', 'All'], ['pending', 'In progress'], ['approved', 'Approved'], ['funded', 'Paid out'], ['declined', 'Declined']]
const OFFICE_STATUSES = ['pending', 'approved', 'declined', 'expired', 'canceled']

export default function FinancingPage() {
  const { can } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState<Application[] | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { const r = await client.get('/api/financing/applications', filter ? { status: filter } : {}); setRows(r?.data || []); setError('') } catch (e) { setError(errMsg(e, 'Could not load applications')) }
  }, [filter])
  useEffect(() => { load() }, [load])
  const act = async (id: string, path: string, body: unknown, ok: string) => {
    setBusy(id)
    try { await client.post(`/api/financing/applications/${id}/${path}`, body); toast.success(ok); await load() } catch (e) { toast.error(errMsg(e, 'That did not work')) } finally { setBusy(null) }
  }
  const sum = (rows || []).filter((r) => r.status === 'funded').reduce((s, r) => s + Number(r.fundedAmount ?? r.amount), 0)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Financing</h1>
          <p className="text-gray-600 dark:text-slate-400">Customers' loan applications from your quotes and invoices. Paid out so far: <span className="font-semibold text-gray-900 dark:text-white">{money(sum)}</span></p>
        </div>
        <button type="button" onClick={load} className={secondary}><RefreshCw className="w-4 h-4" />Refresh</button>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {FILTERS.map(([v, label]) => <button key={v || 'all'} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)} className={`px-3 py-1.5 rounded-full text-sm border ${filter === v ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-gray-800 border-gray-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600'}`}>{label}</button>)}
      </div>
      {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
      {rows && rows.length === 0 && <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-8 text-center text-gray-600 dark:text-slate-400">No applications yet. Open a quote or an invoice and use Customer financing to make one.</div>}
      <ul className="space-y-3" data-testid="financing-list">
        {(rows || []).map((a) => (
          <li key={a.id} className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4 space-y-3 text-sm text-gray-900 dark:text-slate-100">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{a.contact ? <Link to={`/crm/contacts/${a.contact.id}`} className="hover:underline">{a.contact.name}</Link> : 'Customer'}</p>
                <p className="text-gray-600 dark:text-slate-400">
                  {a.quote && <Link to={`/crm/quotes/${a.quote.id}`} className="underline">Quote {a.quote.number}</Link>}
                  {a.quote && a.invoice && ' · '}
                  {a.invoice && <Link to={`/crm/invoices/${a.invoice.id}`} className="underline">Invoice {a.invoice.number}</Link>}
                  {a.job && <> · Job {a.job.number}</>}
                </p>
              </div>
              <div className="text-right"><p className="font-semibold">{money(a.amount)}</p><StatusPill status={a.status} /></div>
            </div>
            <p className="text-xs text-gray-600 dark:text-slate-400">Started {dateTime(a.createdAt)}{a.sentAt ? ` · sent by ${a.sentVia === 'sms' ? 'text' : 'email'} ${dateTime(a.sentAt)}` : ''}{a.fundedAt ? ` · paid out ${dateTime(a.fundedAt)}` : ''}</p>
            {a.status === 'funded' && !a.paymentId && can('financing:update') && (
              <button type="button" className={primary} disabled={busy === a.id} onClick={() => act(a.id, 'record-payment', {}, 'Payment recorded on the invoice')}>Record payment on the invoice</button>
            )}
            {a.status === 'funded' && a.paymentId && <p className="text-xs text-emerald-800 dark:text-emerald-300">Recorded as a payment on the invoice.</p>}
            {!a.reportsBack && !FINAL.includes(a.status) && can('financing:update') && (
              <label className="flex flex-wrap items-center gap-2 text-sm"><span className="text-gray-700 dark:text-slate-300">Status from your Wisetack portal:</span>
                <select value="" onChange={(e) => e.target.value && act(a.id, 'status', { status: e.target.value }, 'Status updated')} disabled={busy === a.id} className="px-2 py-1.5 border rounded-lg bg-white dark:bg-slate-700 border-gray-300 dark:border-slate-600">
                  <option value="">Choose…</option>
                  {OFFICE_STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                </select>
              </label>
            )}
            <SendLink app={a} onSent={load} />
          </li>
        ))}
      </ul>
    </div>
  )
}
