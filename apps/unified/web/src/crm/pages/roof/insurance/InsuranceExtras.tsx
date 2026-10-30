// Insurance follow-ups (roofing depth, gap 7; server/crm/roof/insurance/extras.ts, behind the not-ready feature
// insurance_extras): the held depreciation to get back after the roof is done, and the carrier's cheques that need the
// mortgage company's endorsement. Two cards for the claim page, and the follow-ups list across every claim.
//
// Each control asks what its own route asks: the certificate is insurance:create, moving or editing a check is
// insurance:update, recording what the carrier released is insurance:approve. A figure the server withheld (a seat without
// the books) is drawn as "hidden", never $0.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle, Landmark, Plus, Send } from 'lucide-react'
import { api } from '../../../../api'
import { useMayWrite, usePermissions, useToast, errorText } from '../../../../shared'
import { formatDate } from '../../../date'
import { money } from '@twomiah/tenant-ui/src/money'

interface Depreciation {
  claimId: string; jobId: string; claimNumber?: string; insuranceCompany?: string
  state: 'none_held' | 'job_not_done' | 'send_certificate' | 'waiting_on_carrier' | 'recovered'
  held?: number; recoveredAmount?: number | null; certificateSentAt?: string | null; recoveredAt?: string | null
  jobNumber?: string; address?: string; jobStatus?: string; moneyWithheld?: boolean
}
export interface MortgageCheck {
  id: string; claimId: string; mortgageCompany: string; loanNumber?: string | null; checkNumber?: string | null; amount?: string
  status: 'received' | 'sent_to_mortgage' | 'endorsed' | 'deposited'
  receivedAt?: string | null; sentAt?: string | null; trackingNumber?: string | null; endorsedAt?: string | null; depositedAt?: string | null
  notes?: string | null; moneyWithheld?: boolean; jobNumber?: string; address?: string; claimNumber?: string
}
interface ListReply<T> { data: T[] }

const STATUS_WORDS: Record<MortgageCheck['status'], string> = {
  received: 'Received from the carrier', sent_to_mortgage: 'Sent to the mortgage company', endorsed: 'Endorsed', deposited: 'Deposited',
}
const NEXT: Record<MortgageCheck['status'], { status: MortgageCheck['status']; label: string } | null> = {
  received: { status: 'sent_to_mortgage', label: 'Mark sent to the mortgage company' },
  sent_to_mortgage: { status: 'endorsed', label: 'Mark endorsed' },
  endorsed: { status: 'deposited', label: 'Mark deposited' },
  deposited: null,
}
const amount = (v: unknown) => (v === undefined || v === null || v === '' ? 'hidden' : `${money(Number(v))}`)
const day = (v?: string | null) => (v ? formatDate(v) : '')
const BASE = '/api/insurance-extras'

const CARD = 'bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900'
const H3 = 'text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100'
const BTN = 'px-3 py-1.5 text-xs rounded-lg font-medium disabled:opacity-50'

/** Held depreciation on this claim: whether the certificate went out, and what the carrier released. */
export function DepreciationCard({ claimId }: { claimId: string }) {
  const mayCertify = useMayWrite('insurance:create')
  const mayRecord = useMayWrite('insurance:approve')
  const toast = useToast()
  const [dep, setDep] = useState<Depreciation | null>(null)
  const [released, setReleased] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setDep(await api.get(`${BASE}/claims/${claimId}/depreciation`)) } catch { setDep(null) }
  }, [claimId])
  useEffect(() => { load() }, [load])

  if (!dep || dep.state === 'none_held') return null
  const act = async (path: string, body: object, ok: string) => {
    setBusy(true)
    try { setDep(await api.post(`${BASE}/claims/${claimId}/${path}`, body)); toast.success(ok) } catch (e) { toast.error(errorText(e, 'That did not save')) } finally { setBusy(false) }
  }
  const held = dep.moneyWithheld ? 'hidden' : amount(dep.held)

  return (
    <div className={CARD}>
      <h3 className={H3}><Send className="w-4 h-4 text-gray-400" /> Held depreciation</h3>
      {dep.state === 'recovered' ? (
        <p className="text-sm text-green-700 dark:text-green-300 flex items-center gap-1.5">
          <CheckCircle className="w-4 h-4" /> {dep.insuranceCompany} released {dep.moneyWithheld ? 'the held depreciation' : amount(dep.recoveredAmount)} on {day(dep.recoveredAt)}.
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-700 dark:text-slate-200">
            {dep.insuranceCompany} is holding <strong>{held}</strong> until it has your certificate of completion.
            {dep.state === 'job_not_done' && ' The job is not finished yet; you are reminded when it is.'}
            {dep.state === 'send_certificate' && ' The job is done — send the certificate now.'}
            {dep.state === 'waiting_on_carrier' && ` Certificate sent ${day(dep.certificateSentAt)}; waiting on the carrier.`}
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {mayCertify && dep.state !== 'job_not_done' && (
              <button type="button" disabled={busy} onClick={() => act('completion-certificate', {}, 'Marked as sent')}
                className={`${BTN} bg-orange-600 text-white hover:bg-orange-700`}>
                {dep.certificateSentAt ? 'Sent again today' : 'I sent the certificate'}
              </button>
            )}
            {mayRecord && (
              <>
                <label className="text-xs text-gray-500 dark:text-slate-400">Carrier released
                  <input value={released} onChange={(e) => setReleased(e.target.value)} inputMode="decimal" placeholder="0.00"
                    className="block w-28 text-sm border rounded-lg px-2 py-1.5 mt-0.5" />
                </label>
                <button type="button" disabled={busy || !released.trim()} onClick={() => act('depreciation-recovered', { amount: released.trim() }, 'Recorded')}
                  className={`${BTN} bg-green-700 text-white hover:bg-green-800`}>Record the release</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** The carrier's cheques made out with the mortgage company, through endorsement to the bank. */
export function MortgageChecksCard({ claimId }: { claimId: string }) {
  const mayFile = useMayWrite('insurance:create')
  const mayMove = useMayWrite('insurance:update')
  const toast = useToast()
  const [checks, setChecks] = useState<MortgageCheck[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ mortgageCompany: '', loanNumber: '', checkNumber: '', amount: '' })
  const [tracking, setTracking] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setChecks(((await api.get(`${BASE}/mortgage-checks?claimId=${claimId}`)) as ListReply<MortgageCheck>).data ?? []) } catch { setChecks([]) }
  }, [claimId])
  useEffect(() => { load() }, [load])

  const file = async () => {
    setBusy(true)
    try {
      const body: Record<string, string> = {}
      for (const [k, v] of Object.entries(form)) if (v.trim()) body[k] = v.trim()
      await api.post(`${BASE}/claims/${claimId}/mortgage-checks`, body)
      setForm({ mortgageCompany: '', loanNumber: '', checkNumber: '', amount: '' }); setAdding(false); toast.success('Check recorded'); await load()
    } catch (e) { toast.error(errorText(e, 'Could not record the check')) } finally { setBusy(false) }
  }
  const move = async (c: MortgageCheck, status: MortgageCheck['status']) => {
    setBusy(true)
    try {
      await api.post(`${BASE}/mortgage-checks/${c.id}/status`, { status, ...(status === 'sent_to_mortgage' && tracking[c.id]?.trim() ? { trackingNumber: tracking[c.id].trim() } : {}) })
      await load()
    } catch (e) { toast.error(errorText(e, 'Could not update the check')) } finally { setBusy(false) }
  }

  if (!checks.length && !mayFile) return null
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 dark:text-slate-100"><Landmark className="w-4 h-4 text-gray-400" /> Mortgage-company checks</h3>
        {mayFile && !adding && <button type="button" onClick={() => setAdding(true)} className={`${BTN} bg-orange-600 text-white hover:bg-orange-700 flex items-center gap-1`}><Plus className="w-3.5 h-3.5" /> Add check</button>}
      </div>
      {adding && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {([['mortgageCompany', 'Mortgage company'], ['amount', 'Amount'], ['loanNumber', 'Loan number'], ['checkNumber', 'Check number']] as const).map(([k, label]) => (
            <label key={k} className="text-xs text-gray-500 dark:text-slate-400">{label}
              <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="block w-full text-sm border rounded-lg px-2 py-1.5 mt-0.5" />
            </label>
          ))}
          <div className="col-span-2 flex gap-2">
            <button type="button" disabled={busy || !form.mortgageCompany.trim() || !form.amount.trim()} onClick={file} className={`${BTN} bg-orange-600 text-white`}>Save check</button>
            <button type="button" onClick={() => setAdding(false)} className={`${BTN} border`}>Cancel</button>
          </div>
        </div>
      )}
      {!checks.length && !adding && <p className="text-sm text-gray-500 dark:text-slate-400">No mortgage-company checks on this claim.</p>}
      <ul className="space-y-3">
        {checks.map((c) => {
          const next = NEXT[c.status]
          return (
            <li key={c.id} className="border rounded-lg p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-medium text-gray-900 dark:text-slate-100">{c.mortgageCompany}{c.checkNumber ? ` · check ${c.checkNumber}` : ''}</span>
                <span className="text-gray-700 dark:text-slate-200">{c.moneyWithheld ? 'hidden' : amount(c.amount)}</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                {STATUS_WORDS[c.status]}{c.loanNumber ? ` · loan ${c.loanNumber}` : ''}
                {c.sentAt ? ` · sent ${day(c.sentAt)}` : ''}{c.trackingNumber ? ` · tracking ${c.trackingNumber}` : ''}
                {c.endorsedAt ? ` · endorsed ${day(c.endorsedAt)}` : ''}{c.depositedAt ? ` · deposited ${day(c.depositedAt)}` : ''}
              </p>
              {mayMove && next && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {next.status === 'sent_to_mortgage' && (
                    <input value={tracking[c.id] || ''} onChange={(e) => setTracking({ ...tracking, [c.id]: e.target.value })} placeholder="Tracking number (optional)"
                      className="text-xs border rounded-lg px-2 py-1.5 w-48" />
                  )}
                  <button type="button" disabled={busy} onClick={() => move(c, next.status)} className={`${BTN} bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-100`}>{next.label}</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Every claim's loose ends in one place: the depreciation still to be got and the checks not yet banked. */
export default function InsuranceFollowUpsPage() {
  const { known, can } = usePermissions()
  const [dep, setDep] = useState<Depreciation[]>([])
  const [checks, setChecks] = useState<MortgageCheck[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!known) return
    if (!can('insurance:read')) { setLoading(false); return }
    Promise.all([api.get(`${BASE}/depreciation`) as Promise<ListReply<Depreciation>>, api.get(`${BASE}/mortgage-checks?open=1`) as Promise<ListReply<MortgageCheck>>])
      .then(([d, c]) => { setDep(d.data ?? []); setChecks(c.data ?? []) }).catch(() => setFailed(true)).finally(() => setLoading(false))
  }, [known, can])

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>
  if (!can('insurance:read')) return <div className="p-6 text-sm text-gray-600">Insurance follow-ups are for the office. Ask the owner for access.</div>
  if (failed) return <div className="p-6 text-sm text-red-600">The follow-ups could not be loaded. Try again.</div>
  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Insurance follow-ups</h1>
      <section className={CARD}>
        <h2 className={H3}>Depreciation to get back ({dep.length})</h2>
        {!dep.length && <p className="text-sm text-gray-500 dark:text-slate-400">Nothing waiting. A finished job whose carrier is holding depreciation shows here until the money is released.</p>}
        <ul className="divide-y">
          {dep.map((r) => (
            <li key={r.claimId} className="py-2 flex flex-wrap justify-between gap-2 text-sm">
              <Link to={`/crm/jobs/${r.jobId}/insurance`} className="text-orange-700 dark:text-orange-300 font-medium">{r.address || r.jobNumber} · {r.insuranceCompany} · claim {r.claimNumber}</Link>
              <span className="text-gray-600 dark:text-slate-300">{r.moneyWithheld ? 'hidden' : amount(r.held)} · {r.state === 'waiting_on_carrier' ? `certificate sent ${day(r.certificateSentAt)}` : 'send the certificate'}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className={CARD}>
        <h2 className={H3}>Mortgage-company checks not yet banked ({checks.length})</h2>
        {!checks.length && <p className="text-sm text-gray-500 dark:text-slate-400">No checks are waiting on a mortgage company.</p>}
        <ul className="divide-y">
          {checks.map((c) => (
            <li key={c.id} className="py-2 flex flex-wrap justify-between gap-2 text-sm">
              <Link to={`/crm/jobs/${(c as any).jobId}/insurance`} className="text-orange-700 dark:text-orange-300 font-medium">{c.address || c.jobNumber} · {c.mortgageCompany}</Link>
              <span className="text-gray-600 dark:text-slate-300">{c.moneyWithheld ? 'hidden' : amount(c.amount)} · {STATUS_WORDS[c.status]}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
