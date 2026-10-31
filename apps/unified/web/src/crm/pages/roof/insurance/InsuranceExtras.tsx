// Insurance follow-ups (roofing depth, gap 7; server/crm/roof/insurance/extras.ts, behind the not-ready feature
// insurance_extras): the held depreciation to get back after the roof is done, and the carrier's cheques that need the
// mortgage company's endorsement. Two cards for the claim page, and the follow-ups list across every claim.
//
// Row 10 (roofing parity; server/crm/roof/insurance/supplementStatuses.ts): the company's own supplement statuses on top of the
// fixed four — a picker on each supplement of the claim page, the set-up card (settings:update) and a tracker of every claim's
// supplements in two columns, requested and in progress, on the follow-ups page.
//
// Each control asks what its own route asks: the certificate is insurance:create, moving or editing a check is
// insurance:update, recording what the carrier released is insurance:approve. A figure the server withheld (a seat without
// the books) is drawn as "hidden", never $0.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, ArrowDown, ArrowUp, CheckCircle, Landmark, Plus, Send, Trash2 } from 'lucide-react'
import { api } from '../../../../api'
import { useMayWrite, usePermissions, useToast, useConfirm, errorText } from '../../../../shared'
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

/** The four statuses every supplement has (supplement.status); a company's own sits under one of them. */
export type FixedSupplementStatus = 'draft' | 'submitted' | 'approved' | 'denied'
export const FIXED_WORDS: Record<FixedSupplementStatus, string> = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', denied: 'Denied' }
export interface SupplementStatusDef {
  id: string; name: string; baseStatus: FixedSupplementStatus; sortOrder: number; archived: boolean; supplements: number
}
/** A supplement as the tracker lists it: its claim and job beside it, the amounts absent (moneyWithheld) for a seat without the books. */
interface TrackedSupplement {
  id: string; supplementNumber: string; status: FixedSupplementStatus; reason?: string | null; column: 'requested' | 'in_progress' | 'decided'
  customStatusId: string | null; customStatus: string | null; customStatusArchived: boolean
  claimId: string; jobId: string; claimNumber?: string; insuranceCompany?: string; jobNumber?: string; address?: string
  totalAmount?: string; approvedAmount?: string | null; moneyWithheld?: boolean; daysOpen: number
}

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

/** The company's supplement statuses, in the company's order. Not asked for when `on` is false (Insurance Follow-ups off). */
export function useSupplementStatuses(on = true) {
  const [statuses, setStatuses] = useState<SupplementStatusDef[]>([])
  const reload = useCallback(async () => {
    if (!on) { setStatuses([]); return }
    try { setStatuses(((await api.get(`${BASE}/supplement-statuses`)) as ListReply<SupplementStatusDef>).data ?? []) } catch { setStatuses([]) }
  }, [on])
  useEffect(() => { reload() }, [reload])
  return { statuses, reload }
}

/**
 * The company's own status on one supplement of the claim page: its name beside the fixed status, and (insurance:update) a box to
 * choose another from the ones that sit under the supplement's fixed status. Nothing is drawn when the company has none to offer
 * and the supplement carries none.
 */
export function SupplementStatusControl({ supplementId, fixedStatus, customStatusId, statuses, onChanged }: {
  supplementId: string; fixedStatus: string; customStatusId?: string | null; statuses: SupplementStatusDef[]; onChanged: () => void | Promise<void>
}) {
  const mayMove = useMayWrite('insurance:update')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const current = statuses.find((x) => x.id === customStatusId)
  const offered = statuses.filter((x) => !x.archived && x.baseStatus === fixedStatus)
  if (!current && !(mayMove && offered.length)) return null
  const choose = async (statusId: string) => {
    setBusy(true)
    try { await api.post(`${BASE}/supplements/${supplementId}/custom-status`, { statusId: statusId || null }); await onChanged() }
    catch (e) { toast.error(errorText(e, 'That did not save')) } finally { setBusy(false) }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="supplement-custom-status">
      <span className="text-gray-500 dark:text-slate-400">Your status</span>
      {mayMove && offered.length ? (
        <select aria-label="Your status for this supplement" disabled={busy} value={current ? current.id : ''} onChange={(e) => choose(e.target.value)}
          className="border rounded-lg px-2 py-1 text-xs">
          <option value="">None</option>
          {current && current.archived && <option value={current.id}>{current.name} (archived)</option>}
          {offered.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      ) : (
        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 font-medium">{current?.name}</span>
      )}
    </div>
  )
}

const COLUMNS: { key: 'requested' | 'in_progress'; title: string; hint: string }[] = [
  { key: 'requested', title: 'Requested', hint: 'Raised on the claim, not yet sent to the carrier' },
  { key: 'in_progress', title: 'In progress', hint: 'With the carrier, waiting for its answer' },
]

/** Every claim's supplements still being worked, in two columns (AccuLynx's supplement tracker). */
function SupplementTracker({ statuses }: { statuses: SupplementStatusDef[] }) {
  const [rows, setRows] = useState<TrackedSupplement[]>([])
  const [statusId, setStatusId] = useState('')
  const [decided, setDecided] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const q = [statusId && `statusId=${encodeURIComponent(statusId)}`, decided && 'decided=1'].filter(Boolean).join('&')
    ;(api.get(`${BASE}/supplements${q ? `?${q}` : ''}`) as Promise<ListReply<TrackedSupplement>>)
      .then((r) => { setRows(r.data ?? []); setFailed(false) }).catch(() => setFailed(true))
  }, [statusId, decided])
  const used = statuses.filter((x) => !x.archived || x.supplements > 0)
  const card = (r: TrackedSupplement) => (
    <li key={r.id} className="border rounded-lg p-3 text-sm bg-white dark:bg-slate-900">
      <div className="flex justify-between gap-2">
        <Link to={`/crm/jobs/${r.jobId}/insurance`} className="font-medium text-orange-700 dark:text-orange-300">{r.supplementNumber} · {r.address || r.jobNumber}</Link>
        <span className="text-gray-700 dark:text-slate-200 whitespace-nowrap">{r.moneyWithheld ? 'hidden' : amount(r.totalAmount)}</span>
      </div>
      <p className="text-xs text-gray-500 dark:text-slate-400">{r.insuranceCompany} · claim {r.claimNumber} · {r.daysOpen === 0 ? 'today' : `${r.daysOpen} day${r.daysOpen === 1 ? '' : 's'}`}</p>
      {r.reason && <p className="text-xs text-gray-600 dark:text-slate-300 mt-1 line-clamp-2">{r.reason}</p>}
      <p className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
        <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-200">{FIXED_WORDS[r.status] ?? r.status}</span>
        {r.customStatus && <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 font-medium">{r.customStatus}</span>}
      </p>
    </li>
  )
  return (
    <section className={CARD} data-testid="supplement-tracker">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className={`${H3} mb-0`}>Supplements in progress ({rows.filter((r) => r.column !== 'decided').length})</h2>
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-slate-300">
          {used.length > 0 && (
            <select aria-label="Show one of your statuses" value={statusId} onChange={(e) => setStatusId(e.target.value)} className="border rounded-lg px-2 py-1">
              <option value="">All statuses</option>
              {used.map((x) => <option key={x.id} value={x.id}>{x.name}{x.archived ? ' (archived)' : ''}</option>)}
            </select>
          )}
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={decided} onChange={(e) => setDecided(e.target.checked)} /> Also show approved and denied</label>
        </div>
      </div>
      {failed ? <p className="text-sm text-red-600">The supplements could not be loaded. Try again.</p> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {COLUMNS.map((col) => {
            const list = rows.filter((r) => r.column === col.key)
            return (
              <div key={col.key} data-testid={`column-${col.key}`}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{col.title} ({list.length})</h3>
                <p className="text-xs text-gray-400 dark:text-slate-500 mb-2">{col.hint}</p>
                {!list.length && <p className="text-sm text-gray-500 dark:text-slate-400">None.</p>}
                <ul className="space-y-2">{list.map(card)}</ul>
              </div>
            )
          })}
          {decided && (
            <div className="sm:col-span-2" data-testid="column-decided">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Decided ({rows.filter((r) => r.column === 'decided').length})</h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">{rows.filter((r) => r.column === 'decided').map(card)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** The company's own supplement statuses (settings:update): add, rename, choose what each sits under, order, archive, delete. */
function SupplementStatusSetup({ statuses, reload }: { statuses: SupplementStatusDef[]; reload: () => Promise<void> }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [name, setName] = useState('')
  const [base, setBase] = useState<FixedSupplementStatus>('submitted')
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    try { await fn(); await reload() } catch (e) { toast.error(errorText(e, fallback)) } finally { setBusy(false) }
  }
  const add = () => run(async () => { await api.post(`${BASE}/supplement-statuses`, { name: name.trim(), baseStatus: base }); setName('') }, 'Could not add the status')
  const move = (i: number, by: -1 | 1) => {
    const ids = statuses.map((x) => x.id)
    ;[ids[i], ids[i + by]] = [ids[i + by], ids[i]]
    return run(() => api.put(`${BASE}/supplement-statuses/order`, { ids }), 'Could not reorder')
  }
  const remove = async (x: SupplementStatusDef) => {
    if (!(await confirm('Nothing carries it, so it is simply removed.', { title: `Delete “${x.name}”?`, confirmText: 'Delete', danger: true }))) return
    await run(() => api.delete(`${BASE}/supplement-statuses/${x.id}`), 'Could not delete the status')
  }
  return (
    <section className={CARD} data-testid="supplement-status-setup">
      <h2 className={H3}>Your supplement statuses</h2>
      <p className="text-sm text-gray-600 dark:text-slate-300 mb-3">
        Every supplement is Draft, Submitted, Approved or Denied. Add your own — “Under review”, “Pending re-inspection”, “Need more information from the rep” —
        to say where it stands. Each sits under one of the four and can be put on a supplement that is in it; the four, and the claim’s money, never change.
      </p>
      {!statuses.length && <p className="text-sm text-gray-500 dark:text-slate-400 mb-3">You have not added any yet.</p>}
      <ul className="divide-y mb-4">
        {statuses.map((x, i) => (
          <li key={x.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className={x.archived ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-slate-100 font-medium'}>
              {x.name} <span className="text-xs font-normal text-gray-500 dark:text-slate-400 no-underline">under {FIXED_WORDS[x.baseStatus]} · {x.supplements} supplement{x.supplements === 1 ? '' : 's'}{x.archived ? ' · archived' : ''}</span>
            </span>
            <span className="flex items-center gap-1">
              <button type="button" aria-label={`Move ${x.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)} className={`${BTN} border`}><ArrowUp className="w-3.5 h-3.5" /></button>
              <button type="button" aria-label={`Move ${x.name} down`} disabled={busy || i === statuses.length - 1} onClick={() => move(i, 1)} className={`${BTN} border`}><ArrowDown className="w-3.5 h-3.5" /></button>
              <button type="button" disabled={busy} onClick={() => run(() => api.put(`${BASE}/supplement-statuses/${x.id}`, { archived: !x.archived }), 'Could not change the status')} className={`${BTN} border flex items-center gap-1`}>
                <Archive className="w-3.5 h-3.5" /> {x.archived ? 'Restore' : 'Archive'}
              </button>
              {x.supplements === 0 && <button type="button" aria-label={`Delete ${x.name}`} disabled={busy} onClick={() => remove(x)} className={`${BTN} border text-red-700`}><Trash2 className="w-3.5 h-3.5" /></button>}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-500 dark:text-slate-400">New status
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Under review" className="block w-56 text-sm border rounded-lg px-2 py-1.5 mt-0.5" />
        </label>
        <label className="text-xs text-gray-500 dark:text-slate-400">Sits under
          <select value={base} onChange={(e) => setBase(e.target.value as FixedSupplementStatus)} className="block text-sm border rounded-lg px-2 py-1.5 mt-0.5">
            {(Object.keys(FIXED_WORDS) as FixedSupplementStatus[]).map((k) => <option key={k} value={k}>{FIXED_WORDS[k]}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy || !name.trim()} onClick={add} className={`${BTN} bg-orange-600 text-white hover:bg-orange-700`}>Add status</button>
      </div>
    </section>
  )
}

/** Every claim's loose ends in one place: the depreciation still to be got and the checks not yet banked. */
export default function InsuranceFollowUpsPage() {
  const { known, can } = usePermissions()
  const { statuses, reload: reloadStatuses } = useSupplementStatuses()
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
    <div className="p-6 space-y-6 max-w-5xl">
      <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Insurance follow-ups</h1>
      <SupplementTracker statuses={statuses} />
      {can('settings:update') && <SupplementStatusSetup statuses={statuses} reload={reloadStatuses} />}
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
