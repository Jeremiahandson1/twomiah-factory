// The private-event depth screens (restaurant-bar-depth, docs/parity/restaurant-*.md): the proposal builder, the
// payment reminders / pay links / card on file, the guarantee note, the room minimums, the room calendar with its
// waitlist and feeds, the lead-source and year reports, and the venue's event settings. Each shows only with its own
// feature on (all of them not ready) and asks the permission its server route asks.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Lock, FileSignature, Send, Ban, Copy, CreditCard, Bell, CalendarDays, Rss, Plus, Trash2, Download, BarChart3, Settings2, Link2 } from 'lucide-react'
import { api } from '../api'
import { useAuth, useToast, useConfirm, usePrompt, errorText } from '../shared'
import { money } from '@twomiah/tenant-ui/src/money'
import { companyTodayKey, whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'

const client = api as any
const card = 'bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 text-sm text-gray-900 dark:text-slate-100'
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 text-sm hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50'
const primary = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 text-white text-sm hover:bg-orange-700 disabled:opacity-50'
const input = 'w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700'
const label = 'block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1'
const muted = 'text-gray-600 dark:text-slate-400'

/** The server's machine word on a refused write (ApiError.data.code), if it sent one. */
export const errCode = (e: unknown): string => String((e as any)?.data?.code || '')
const abs = (path: string) => `${window.location.origin}${path}`
const copy = async (toast: ReturnType<typeof useToast>, text: string) => { try { await navigator.clipboard.writeText(text); toast.success('Link copied') } catch { toast.error('Could not copy — select the link and copy it') } }

/** The sources an enquiry can come from (server/crm/restaurant/eventSources.ts). */
export const EVENT_SOURCES: Array<{ id: string; label: string }> = [
  { id: 'website', label: 'Website form' }, { id: 'the_knot', label: 'The Knot' }, { id: 'weddingwire', label: 'WeddingWire' },
  { id: 'google_business', label: 'Google Business Profile' }, { id: 'instagram', label: 'Instagram / Facebook' }, { id: 'phone', label: 'Phone call' },
  { id: 'walk_in', label: 'Walk-in' }, { id: 'referral', label: 'Referral' }, { id: 'repeat', label: 'Repeat client' }, { id: 'other', label: 'Other' },
]

/** Where did this enquiry come from — a short list, not free text, so the report can count it. */
export function SourcePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = EVENT_SOURCES.some((s) => s.id === value)
  return (
    <div>
      <label className={label}>Where did it come from?</label>
      <select value={known ? value : value ? 'other' : ''} onChange={(e) => onChange(e.target.value)} className={input}>
        <option value="">Not recorded</option>
        {EVENT_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </div>
  )
}

/** Hook: ask for a reason when the server says the count is locked and a manager may change it anyway. */
export function useGuaranteeOverride() {
  const askText = usePrompt()
  return useCallback(async (e: unknown): Promise<string | null> => {
    if (errCode(e) !== 'count_locked' || (e as any)?.status !== 409) return null
    return askText(`${(e as Error).message}`, { title: 'The guest count is locked', confirmText: 'Change it anyway', placeholder: 'Why is it changing?' })
  }, [askText])
}

// ── On the event: the guarantee note ─────────────────────────────────────────────────────────────────────────────────
export function GuaranteeNote({ guarantee, event }: { guarantee?: { cutoff: string | null; locked: boolean; days: number } | null; event: { guaranteeOverrideReason?: string | null } }) {
  if (!guarantee || !guarantee.cutoff) return null
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-2 ${guarantee.locked ? 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200' : 'border-gray-200 bg-white text-gray-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300'}`} data-testid="guarantee-note">
      <Lock className="w-4 h-4 mt-0.5 shrink-0" />
      <div>
        {guarantee.locked
          ? <p><strong>The guest count is locked</strong> — it was final {guarantee.days} days before the event. Only a manager can change it, and must say why.</p>
          : <p>The client's guest count becomes final on <strong>{guarantee.cutoff}</strong> ({guarantee.days} days before the event).</p>}
        {event.guaranteeOverrideReason && <p className="mt-1">Last changed after the cutoff: “{event.guaranteeOverrideReason}”</p>}
      </div>
    </div>
  )
}

// ── On the event: proposals ──────────────────────────────────────────────────────────────────────────────────────────
interface Choice { id?: string; label: string; price: string; perPerson: boolean }
interface OptionGroup { id?: string; title: string; kind: 'single' | 'multi'; required: boolean; choices: Choice[] }
interface Proposal { id: string; version: number; status: string; message?: string | null; options: Array<{ id: string; title: string; kind: 'single' | 'multi'; required: boolean; choices: Array<{ id: string; label: string; price: number; perPerson: boolean }> }>; selections?: Record<string, string[]>; path?: string; sentAt?: string | null; expiresAt?: string | null; acceptedAt?: string | null; signedBy?: string | null; declineReason?: string | null; stale?: boolean }
const PSTATUS: Record<string, string> = { draft: 'Draft', sent: 'Sent', viewed: 'Opened', accepted: 'Signed', declined: 'Declined', expired: 'Expired', superseded: 'Replaced' }

export function ProposalsPanel({ eventId, onChanged }: { eventId: string; onChanged: () => void }) {
  const { hasFeature, can } = useAuth()
  const toast = useToast()
  const ask = useConfirm()
  const [rows, setRows] = useState<Proposal[] | null>(null)
  const [building, setBuilding] = useState(false)
  const show = hasFeature('event_proposals') && can('invoices:read')
  const mayEdit = can('invoices:update')
  const load = useCallback(async () => {
    try { setRows(((await client.get('/api/event-proposals', { eventId })) as { data: Proposal[] }).data) } catch (e) { toast.error(errorText(e, 'Could not load proposals')) }
  }, [eventId, toast])
  useEffect(() => { if (show) load() }, [show, load])
  if (!show) return null
  const send = async (p: Proposal) => {
    try { await client.post(`/api/event-proposals/${p.id}/send`); toast.success('Proposal sent to the client'); await load(); onChanged() } catch (e) { toast.error(errorText(e, 'Could not send the proposal')) }
  }
  const withdraw = async (p: Proposal) => {
    if (!(await ask('The client’s link will stop working.', { title: 'Withdraw this proposal?', confirmText: 'Withdraw' }))) return
    try { await client.post(`/api/event-proposals/${p.id}/withdraw`); await load() } catch (e) { toast.error(errorText(e, 'Could not withdraw it')) }
  }
  const pdf = async (p: Proposal) => {
    try {
      const res = await fetch(`/api/event-proposals/${p.id}/pdf`, { credentials: 'include' })
      if (!res.ok) throw new Error('Could not make the PDF')
      const url = URL.createObjectURL(await res.blob()); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) { toast.error(errorText(e, 'Could not make the PDF')) }
  }
  return (
    <section className={card} data-testid="proposals-panel">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-semibold flex items-center gap-2"><FileSignature className="w-4 h-4" />Proposals</h3>
        {mayEdit && <button type="button" className={primary} onClick={() => setBuilding(true)}><Plus className="w-4 h-4" />New proposal</button>}
      </div>
      <p className={`${muted} mb-3`}>The client reads the room, date, menu and price, picks their options and signs on their phone. Signing books the event.</p>
      {!rows && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
      {rows && rows.length === 0 && <p className={muted}>No proposals yet.</p>}
      <ul className="space-y-3">
        {rows?.map((p) => (
          <li key={p.id} className="border border-gray-200 dark:border-slate-700 rounded-lg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">Proposal {p.version} <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${p.status === 'accepted' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' : 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200'}`}>{PSTATUS[p.status] || p.status}</span></span>
              <span className="flex flex-wrap gap-2">
                {p.status === 'draft' && mayEdit && <button type="button" className={primary} onClick={() => send(p)}><Send className="w-4 h-4" />Send</button>}
                {p.path && ['sent', 'viewed'].includes(p.status) && <button type="button" className={btn} onClick={() => copy(toast, abs(p.path!))}><Copy className="w-4 h-4" />Copy link</button>}
                {['sent', 'viewed'].includes(p.status) && mayEdit && <button type="button" className={btn} onClick={() => withdraw(p)}><Ban className="w-4 h-4" />Withdraw</button>}
                <button type="button" className={btn} onClick={() => pdf(p)}><Download className="w-4 h-4" />PDF</button>
              </span>
            </div>
            {p.stale && <p role="alert" className="mt-2 text-amber-800 dark:text-amber-300">The date, time, room or head count changed after this was sent — the client can’t sign it. Send a new one.</p>}
            {p.status === 'accepted' && <p className="mt-2 text-green-800 dark:text-green-300">Signed by {p.signedBy}{p.acceptedAt ? ` on ${whenDateTime(p.acceptedAt)}` : ''}.</p>}
            {p.status === 'declined' && <p className="mt-2">Declined{p.declineReason ? `: “${p.declineReason}”` : '.'}</p>}
            {p.options.length > 0 && <p className={`mt-2 ${muted}`}>{p.options.map((o) => `${o.title} (${o.choices.length})`).join(' · ')}</p>}
          </li>
        ))}
      </ul>
      {building && <ProposalBuilder eventId={eventId} onClose={() => setBuilding(false)} onMade={async () => { setBuilding(false); await load() }} />}
    </section>
  )
}

function ProposalBuilder({ eventId, onClose, onMade }: { eventId: string; onClose: () => void; onMade: () => void }) {
  const toast = useToast()
  const [message, setMessage] = useState('')
  const [groups, setGroups] = useState<OptionGroup[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const patch = (i: number, p: Partial<OptionGroup>) => setGroups((g) => g.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const patchChoice = (i: number, c: number, p: Partial<Choice>) => setGroups((g) => g.map((x, j) => (j === i ? { ...x, choices: x.choices.map((y, k) => (k === c ? { ...y, ...p } : y)) } : x)))
  const submit = async () => {
    setBusy(true); setErr('')
    try {
      await client.post('/api/event-proposals', { eventId, message: message.trim() || undefined, options: groups.map((g) => ({ title: g.title, kind: g.kind, required: g.required, choices: g.choices.map((c) => ({ label: c.label, price: Number(c.price || 0), perPerson: c.perPerson })) })) })
      toast.success('Draft made — send it when you are ready'); onMade()
    } catch (e) { setErr(errorText(e, 'Could not make the proposal')) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" role="dialog" aria-label="New proposal">
      <div className="bg-white dark:bg-slate-900 rounded-xl w-full max-w-2xl p-6 space-y-4 mt-8">
        <h3 className="text-lg font-semibold">New proposal</h3>
        <p className={muted}>It is made from the event as it stands now — room, date, hours, head count, menu lines, minimum and the payment schedule. Add the choices the client makes.</p>
        <div><label className={label}>Note to the client</label><textarea value={message} onChange={(e) => setMessage(e.target.value)} className={input} rows={2} /></div>
        {groups.map((g, i) => (
          <div key={i} className="border border-gray-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1"><label className={label}>Question</label><input className={input} value={g.title} placeholder="Choose your main" onChange={(e) => patch(i, { title: e.target.value })} /></div>
              <select className={`${input} w-40`} value={g.kind} onChange={(e) => patch(i, { kind: e.target.value as 'single' | 'multi' })} aria-label="How many may they pick"><option value="single">Pick one</option><option value="multi">Pick any</option></select>
              <label className="flex items-center gap-1 text-sm whitespace-nowrap"><input type="checkbox" checked={g.required} onChange={(e) => patch(i, { required: e.target.checked })} />Required</label>
              <button type="button" className={btn} aria-label="Remove question" onClick={() => setGroups((x) => x.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></button>
            </div>
            {g.choices.map((c, k) => (
              <div key={k} className="flex gap-2 items-center">
                <input className={input} value={c.label} placeholder="Herb-crusted salmon" onChange={(e) => patchChoice(i, k, { label: e.target.value })} aria-label="Choice" />
                <input className={`${input} w-28`} type="number" min="0" step="0.01" value={c.price} onChange={(e) => patchChoice(i, k, { price: e.target.value })} aria-label="Price" />
                <label className="flex items-center gap-1 text-sm whitespace-nowrap"><input type="checkbox" checked={c.perPerson} onChange={(e) => patchChoice(i, k, { perPerson: e.target.checked })} />per guest</label>
                <button type="button" className={btn} aria-label="Remove choice" onClick={() => patch(i, { choices: g.choices.filter((_, j) => j !== k) })}><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <button type="button" className={btn} onClick={() => patch(i, { choices: [...g.choices, { label: '', price: '', perPerson: true }] })}><Plus className="w-4 h-4" />Add a choice</button>
          </div>
        ))}
        <button type="button" className={btn} onClick={() => setGroups((g) => [...g, { title: '', kind: 'single', required: false, choices: [{ label: '', price: '', perPerson: true }] }])}><Plus className="w-4 h-4" />Add a question</button>
        {err && <p role="alert" className="text-red-700 dark:text-red-300">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="button" className={primary} onClick={submit} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Make the draft</button></div>
      </div>
    </div>
  )
}

// ── On the event: reminders, pay links and the card on file ─────────────────────────────────────────────────────────
interface Instalment { id: string; label: string; amount: number; dueDate: string | null; state: string; paidAmount: number; remindedBeforeAt: string | null; remindedDueAt: string | null; remindedOverdueAt: string | null; autopayStatus: string | null; autopayError: string | null; payPath?: string }
export function PaymentAutomationPanel({ eventId }: { eventId: string }) {
  const { hasFeature, can } = useAuth()
  const toast = useToast()
  const ask = useConfirm()
  const show = hasFeature('event_payment_automation') && can('invoices:read')
  const [data, setData] = useState<{ instalments: Instalment[]; autopay: { status: string; brand: string | null; last4: string | null; consentAt: string | null } | null; cardsOn: boolean } | null>(null)
  const load = useCallback(async () => { try { setData(await client.get(`/api/event-payments/${eventId}`)) } catch (e) { toast.error(errorText(e, 'Could not load the payment reminders')) } }, [eventId, toast])
  useEffect(() => { if (show) load() }, [show, load])
  if (!show) return null
  const mayEdit = can('invoices:update')
  const remind = async (i: Instalment) => { try { await client.post(`/api/event-payments/${eventId}/remind/${i.id}`); toast.success('Reminder sent'); await load() } catch (e) { toast.error(errorText(e, 'Could not send it')) } }
  const stop = async () => {
    if (!(await ask('The saved card is removed here and at the card processor. Payments after this need the client to pay.', { title: 'Stop charging the card on file?', confirmText: 'Stop' }))) return
    try { await client.post(`/api/event-payments/${eventId}/autopay/stop`); await load() } catch (e) { toast.error(errorText(e, 'Could not stop it')) }
  }
  const last = (i: Instalment) => i.remindedOverdueAt ? 'Overdue reminder sent' : i.remindedDueAt ? 'Due-day reminder sent' : i.remindedBeforeAt ? 'Reminder sent' : 'No reminder yet'
  return (
    <section className={card} data-testid="payment-automation-panel">
      <h3 className="font-semibold flex items-center gap-2 mb-3"><Bell className="w-4 h-4" />Reminders, pay links and card on file</h3>
      {!data && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
      {data && data.instalments.length === 0 && <p className={muted}>Schedule a payment first — each one gets a reminder and a pay link.</p>}
      <ul className="space-y-2">
        {data?.instalments.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-slate-800 pb-2">
            <span><strong>{i.label}</strong> {money(i.amount)}{i.dueDate ? ` · due ${i.dueDate}` : ''} <span className={muted}>· {i.state === 'paid' ? 'paid' : last(i)}</span>{i.autopayStatus === 'failed' && <span className="ml-2 text-red-700 dark:text-red-300">card declined{i.autopayError ? `: ${i.autopayError}` : ''}</span>}</span>
            {i.state !== 'paid' && i.state !== 'void' && (
              <span className="flex gap-2">
                {i.payPath && <button type="button" className={btn} onClick={() => copy(toast, abs(i.payPath!))}><Link2 className="w-4 h-4" />Copy pay link</button>}
                {mayEdit && <button type="button" className={btn} onClick={() => remind(i)}><Bell className="w-4 h-4" />Remind now</button>}
              </span>
            )}
          </li>
        ))}
      </ul>
      {data && (
        <p className="mt-3 flex flex-wrap items-center gap-2">
          <CreditCard className="w-4 h-4" />
          {data.autopay?.status === 'active'
            ? <>The client left a {data.autopay.brand || 'card'} ending {data.autopay.last4}; each payment is charged to it on its due date.{mayEdit && <button type="button" className={btn} onClick={stop}>Stop</button>}</>
            : data.cardsOn ? <span className={muted}>No card on file. The client can leave one from any pay link.</span> : <span className={muted}>Card payments are not switched on for this business, so pay links show the amount only.</span>}
        </p>
      )}
    </section>
  )
}

// ── On a room: the minimum rules ─────────────────────────────────────────────────────────────────────────────────────
interface Rule { id: string; label: string | null; daysOfWeek: number[]; seasonStart: string | null; seasonEnd: string | null; category: string | null; amount: string | number }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CATS = ['canape', 'lunch', 'dinner', 'buffet', 'bar', 'dessert', 'other']
const ruleWords = (r: Rule) => [r.daysOfWeek?.length ? r.daysOfWeek.map((d) => DAYS[d]).join(', ') : 'Any day', r.seasonStart && r.seasonEnd ? `${r.seasonStart} to ${r.seasonEnd}` : 'all year', r.category ? `${r.category} spend` : 'all food and drink'].join(' · ')

export function SpaceMinimums({ spaceId }: { spaceId: string }) {
  const { hasFeature, can } = useAuth()
  const toast = useToast()
  const show = hasFeature('event_minimums') && can('invoices:read')
  const [rows, setRows] = useState<Rule[] | null>(null)
  const [f, setF] = useState({ label: '', amount: '', days: [] as number[], start: '', end: '', category: '' })
  const load = useCallback(async () => { try { setRows(((await client.get('/api/event-minimums', { spaceId })) as { data: Rule[] }).data) } catch (e) { toast.error(errorText(e, 'Could not load the minimums')) } }, [spaceId, toast])
  useEffect(() => { if (show) load() }, [show, load])
  if (!show) return null
  const may = can('contacts:update')
  const add = async () => {
    try {
      await client.post('/api/event-minimums', { spaceId, label: f.label || undefined, amount: Number(f.amount), daysOfWeek: f.days, seasonStart: f.start || null, seasonEnd: f.end || null, category: f.category || null })
      setF({ label: '', amount: '', days: [], start: '', end: '', category: '' }); await load()
    } catch (e) { toast.error(errorText(e, 'Could not add the minimum')) }
  }
  const remove = async (r: Rule) => { try { await client.delete('/api/event-minimums', r.id); await load() } catch (e) { toast.error(errorText(e, 'Could not remove it')) } }
  return (
    <div className="mt-3 border-t border-gray-100 dark:border-slate-800 pt-3 text-sm" data-testid="space-minimums">
      <p className="font-medium mb-1">Minimums by day and season</p>
      <p className={`${muted} mb-2`}>The most specific rule that fits the event’s date applies. What the guest spends on food and drink short of it goes on the bill as its own line.</p>
      {rows?.length === 0 && <p className={muted}>None — the room’s single minimum spend applies.</p>}
      <ul className="space-y-1">{rows?.map((r) => <li key={r.id} className="flex items-center justify-between gap-2"><span><strong>{money(Number(r.amount))}</strong> {r.label ? `· ${r.label} ` : ''}<span className={muted}>· {ruleWords(r)}</span></span>{may && <button type="button" className={btn} aria-label="Remove minimum" onClick={() => remove(r)}><Trash2 className="w-4 h-4" /></button>}</li>)}</ul>
      {may && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2"><input className={input} placeholder="Name (Saturday dinners)" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /><input className={`${input} w-32`} type="number" min="0" step="0.01" placeholder="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} aria-label="Minimum amount" /></div>
          <div className="flex flex-wrap gap-2 items-center">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1"><input type="checkbox" checked={f.days.includes(i)} onChange={(e) => setF({ ...f, days: e.target.checked ? [...f.days, i] : f.days.filter((x) => x !== i) })} />{d}</label>)}</div>
          <div className="flex gap-2 items-center"><input className={`${input} w-28`} placeholder="05-01" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} aria-label="Season starts (month-day)" /> to <input className={`${input} w-28`} placeholder="10-31" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} aria-label="Season ends (month-day)" />
            <select className={`${input} w-40`} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Counts"><option value="">All food and drink</option>{CATS.map((c) => <option key={c} value={c}>{c} only</option>)}</select>
            <button type="button" className={primary} onClick={add} disabled={!f.amount}><Plus className="w-4 h-4" />Add</button></div>
        </div>
      )}
    </div>
  )
}

/** The minimum on the event's money tab. */
export function MinimumNote({ minimum }: { minimum?: { required: number | null; spend: number; shortfall: number } | null }) {
  const { hasFeature } = useAuth()
  if (!hasFeature('event_minimums') || !minimum || minimum.required == null) return null
  return (
    <p className={`rounded-lg border px-4 py-3 text-sm ${minimum.shortfall > 0 ? 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200' : 'border-gray-200 text-gray-700 dark:border-slate-800 dark:text-slate-300'}`} data-testid="minimum-note">
      Food and drink minimum {money(minimum.required)} · spending {money(minimum.spend)}{minimum.shortfall > 0 ? ` · ${money(minimum.shortfall)} short — it is added to the bill as “Food and beverage minimum shortfall”.` : ' · met.'}
    </p>
  )
}

// ── The room calendar ────────────────────────────────────────────────────────────────────────────────────────────────
interface CalSpace { id: string; name: string }
interface CalEvent { id: string; name: string; status: string; eventDate: string; startTime: string | null; endTime: string | null; spaceId: string | null; guestCount: number | null }
interface Wait { id: string; spaceId: string; eventDate: string; startTime: string | null; endTime: string | null; name: string; status: string }
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const mondayOf = (d: string) => { const dow = new Date(d + 'T12:00:00Z').getUTCDay(); return addDays(d, -((dow + 6) % 7)) }
const STATUS_TONE: Record<string, string> = { enquiry: 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-100', tentative: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100', confirmed: 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100', completed: 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100' }

export function EventCalendarPage() {
  const { hasFeature, can } = useAuth()
  const toast = useToast()
  const ask = useConfirm()
  const [mode, setMode] = useState<'week' | 'month'>('week')
  const [start, setStart] = useState(() => mondayOf(companyTodayKey()))
  const [data, setData] = useState<{ spaces: CalSpace[]; events: CalEvent[]; waitlist: Wait[] } | null>(null)
  const [feeds, setFeeds] = useState<Array<{ spaceId: string; name: string; path: string }> | null>(null)
  const [waitList, setWaitList] = useState<Wait[]>([])
  const days = useMemo(() => Array.from({ length: mode === 'week' ? 7 : 35 }, (_, i) => addDays(mode === 'week' ? start : mondayOf(start.slice(0, 8) + '01'), i)), [mode, start])
  const first = days[0], last = days[days.length - 1]
  const load = useCallback(async () => {
    try { setData(await client.get('/api/event-calendar', { from: first, to: last })) } catch (e) { toast.error(errorText(e, 'Could not load the calendar')) }
    try { setWaitList(((await client.get('/api/event-waitlist', { status: 'waiting' })) as { data: Wait[] }).data) } catch { /* shown without the list */ }
  }, [first, last, toast])
  useEffect(() => { load() }, [load])
  const mayFeeds = can('contacts:update')
  useEffect(() => { if (mayFeeds) client.get('/api/event-calendar/feeds').then((r: any) => setFeeds(r.data)).catch(() => setFeeds([])) }, [mayFeeds])
  const [wait, setWait] = useState<{ spaceId: string; eventDate: string; name: string; email: string; startTime: string; endTime: string } | null>(null)
  if (!hasFeature('event_calendar')) return <p className="text-gray-600 dark:text-slate-400">The room calendar is not switched on for this business.</p>
  const step = mode === 'week' ? 7 : 28
  const submitWait = async () => {
    if (!wait) return
    try { await client.post('/api/event-waitlist', { ...wait, email: wait.email || undefined, startTime: wait.startTime || undefined, endTime: wait.endTime || undefined }); toast.success('Added to the waitlist'); setWait(null); await load() } catch (e) { toast.error(errorText(e, 'Could not add them')) }
  }
  const resetFeed = async (spaceId: string) => {
    if (!(await ask('The old link stops working; anyone subscribed needs the new one.', { title: 'Make a new calendar link?', confirmText: 'Make a new link' }))) return
    try { const r = await client.post(`/api/event-calendar/feeds/${spaceId}/reset`); setFeeds((f) => (f || []).map((x) => (x.spaceId === spaceId ? r : x))) } catch (e) { toast.error(errorText(e, 'Could not reset it')) }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-900 dark:text-slate-100"><CalendarDays className="w-6 h-6 text-orange-600 dark:text-orange-200" />Room calendar</h1>
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={() => setStart(addDays(start, -step))}>Earlier</button>
          <button type="button" className={btn} onClick={() => setStart(mondayOf(companyTodayKey()))}>Today</button>
          <button type="button" className={btn} onClick={() => setStart(addDays(start, step))}>Later</button>
          <select className={`${input} w-28`} value={mode} onChange={(e) => setMode(e.target.value as 'week' | 'month')} aria-label="Show"><option value="week">Week</option><option value="month">Month</option></select>
        </div>
      </div>
      {!data ? <Loader2 className="w-5 h-5 animate-spin text-gray-400" /> : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs bg-white dark:bg-slate-900" data-testid="room-grid">
            <thead><tr><th className="border p-2 text-left sticky left-0 bg-white dark:bg-slate-900">Room</th>{days.map((d) => <th key={d} className="border p-2 min-w-[7rem] font-medium">{new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</th>)}</tr></thead>
            <tbody>
              {data.spaces.map((s) => (
                <tr key={s.id}>
                  <th className="border p-2 text-left sticky left-0 bg-white dark:bg-slate-900">{s.name}</th>
                  {days.map((d) => {
                    const here = data.events.filter((e) => e.spaceId === s.id && e.eventDate === d)
                    const waiting = data.waitlist.filter((w) => w.spaceId === s.id && w.eventDate === d)
                    return (
                      <td key={d} className="border p-1 align-top">
                        {here.map((e) => <Link key={e.id} to={`/crm/events/${e.id}`} className={`block rounded px-1.5 py-1 mb-1 ${STATUS_TONE[e.status] || STATUS_TONE.enquiry}`}><span className="font-medium">{e.startTime ? `${e.startTime}${e.endTime ? '–' + e.endTime : ''} ` : ''}</span>{e.name}</Link>)}
                        {waiting.length > 0 && <p className="text-[11px] text-purple-800 dark:text-purple-300">{waiting.length} waiting</p>}
                        {here.length > 0 && can('contacts:create') && <button type="button" className="text-[11px] underline text-gray-600 dark:text-slate-400" onClick={() => setWait({ spaceId: s.id, eventDate: d, name: '', email: '', startTime: '', endTime: '' })}>+ waitlist</button>}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {data.spaces.length === 0 && <tr><td className="p-4 text-gray-600 dark:text-slate-400" colSpan={days.length + 1}>Add a room on the Spaces page to see it here.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <section className={card}>
        <h2 className="font-semibold mb-2">Waitlist</h2>
        {waitList.length === 0 ? <p className={muted}>Nobody is waiting for a held date. When a hold is let go, the first guest waiting for it is told.</p> : (
          <ul className="space-y-1">{waitList.map((w) => <li key={w.id} className="flex items-center justify-between gap-2"><span><strong>{w.name}</strong> · {w.eventDate}{w.startTime ? ` ${w.startTime}–${w.endTime || ''}` : ''} · {data?.spaces.find((s) => s.id === w.spaceId)?.name}</span>{can('contacts:update') && <button type="button" className={btn} onClick={async () => { await client.delete('/api/event-waitlist', w.id); load() }} aria-label="Remove from waitlist"><Trash2 className="w-4 h-4" /></button>}</li>)}</ul>
        )}
      </section>
      {mayFeeds && (
        <section className={card}>
          <h2 className="font-semibold mb-2 flex items-center gap-2"><Rss className="w-4 h-4" />Calendar links</h2>
          <p className={`${muted} mb-2`}>Add a room’s link to Google, Apple or Outlook calendar (“subscribe by URL”). It shows the room’s name, hours, head count and stage — no client details, no money.</p>
          {!feeds ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : (
            <ul className="space-y-2">{feeds.map((f) => <li key={f.spaceId} className="flex flex-wrap items-center justify-between gap-2"><strong>{f.name}</strong><span className="flex gap-2"><button type="button" className={btn} onClick={() => copy(toast, abs(f.path))}><Copy className="w-4 h-4" />Copy link</button><button type="button" className={btn} onClick={() => resetFeed(f.spaceId)}>New link</button></span></li>)}</ul>
          )}
        </section>
      )}
      {wait && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-label="Add to the waitlist">
          <div className="bg-white dark:bg-slate-900 rounded-xl w-full max-w-md p-5 space-y-3">
            <h3 className="font-semibold">Wait for {wait.eventDate}</h3>
            <div><label className={label}>Name</label><input className={input} value={wait.name} onChange={(e) => setWait({ ...wait, name: e.target.value })} /></div>
            <div><label className={label}>Email (they are told when it opens)</label><input className={input} type="email" value={wait.email} onChange={(e) => setWait({ ...wait, email: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2"><div><label className={label}>From</label><input className={input} type="time" value={wait.startTime} onChange={(e) => setWait({ ...wait, startTime: e.target.value })} /></div><div><label className={label}>To</label><input className={input} type="time" value={wait.endTime} onChange={(e) => setWait({ ...wait, endTime: e.target.value })} /></div></div>
            <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={() => setWait(null)}>Cancel</button><button type="button" className={primary} onClick={submitWait} disabled={!wait.name.trim()}>Add</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Reports and the venue's event settings ───────────────────────────────────────────────────────────────────────────
interface SourceRow { source: string; label: string; enquiries: number; booked: number; lost: number; open: number; conversion: number; bookedValue?: number }
interface YearMonth { month: number; booked: number; lastYearBooked: number; value?: number; lastYearValue?: number }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
interface Settings { guaranteeDays: number; guaranteeReminderDays: number; shortfallTaxed: boolean; payRemindBeforeDays: number; payRemindOnDue: boolean; payRemindOverdueDays: number; proposalValidDays: number; proposalTerms: string }

export function EventInsightsPage() {
  const { hasFeature, can } = useAuth()
  const toast = useToast()
  const today = companyTodayKey()
  const [from, setFrom] = useState(() => `${today.slice(0, 4)}-01-01`)
  const [to, setTo] = useState(today)
  const [src, setSrc] = useState<{ sources: SourceRow[]; totals: Omit<SourceRow, 'source' | 'label' | 'open'> } | null>(null)
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [yrs, setYrs] = useState<{ months: YearMonth[]; totals: { booked: number; lastYearBooked: number; value?: number; lastYearValue?: number } } | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const reports = hasFeature('event_reports') && can('reports:read')
  useEffect(() => { if (reports) client.get('/api/event-reports/sources', { from, to }).then(setSrc).catch((e: unknown) => toast.error(errorText(e, 'Could not load the report'))) }, [reports, from, to, toast])
  useEffect(() => { if (reports) client.get('/api/event-reports/years', { year }).then(setYrs).catch((e: unknown) => toast.error(errorText(e, 'Could not load the report'))) }, [reports, year, toast])
  const showSettings = hasFeature('event_bookings') && can('contacts:read')
  useEffect(() => { if (showSettings) client.get('/api/event-settings').then(setSettings).catch(() => setSettings(null)) }, [showSettings])
  const maySave = can('settings:update')
  const save = async () => { try { setSettings(await client.put('/api/event-settings', settings)); toast.success('Saved') } catch (e) { toast.error(errorText(e, 'Could not save')) } }
  const set = (k: keyof Settings, v: number | boolean | string) => setSettings((s) => (s ? { ...s, [k]: v } : s))
  const num = (k: keyof Settings, text: string, hint: string) => settings && (
    <div><label className={label}>{text}</label><input className={`${input} w-28`} type="number" min="0" disabled={!maySave} value={settings[k] as number} onChange={(e) => set(k, Number(e.target.value))} /><p className={`text-xs mt-1 ${muted}`}>{hint}</p></div>
  )
  const peak = Math.max(1, ...(yrs?.months.map((m) => Math.max(m.booked, m.lastYearBooked)) || [1]))
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-900 dark:text-slate-100"><BarChart3 className="w-6 h-6 text-orange-600 dark:text-orange-200" />Event sources and settings</h1>
      {reports && (
        <section className={card} data-testid="source-report">
          <h2 className="font-semibold mb-2">Where enquiries come from</h2>
          <div className="flex flex-wrap gap-3 mb-3"><div><label className={label}>From</label><input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} /></div><div><label className={label}>To</label><input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} /></div></div>
          {!src ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : src.sources.length === 0 ? <p className={muted}>No enquiries in those dates.</p> : (
            <div className="overflow-x-auto"><table className="min-w-full text-left"><thead><tr className="border-b"><th className="py-1 pr-4">Source</th><th className="pr-4">Enquiries</th><th className="pr-4">Booked</th><th className="pr-4">Lost</th><th className="pr-4">Still open</th><th className="pr-4">Booked %</th>{src.totals.bookedValue !== undefined && <th>Booked value</th>}</tr></thead>
              <tbody>{src.sources.map((r) => <tr key={r.source} className="border-b border-gray-100 dark:border-slate-800"><td className="py-1 pr-4">{r.label}</td><td>{r.enquiries}</td><td>{r.booked}</td><td>{r.lost}</td><td>{r.open}</td><td>{r.conversion}%</td>{r.bookedValue !== undefined && <td>{money(r.bookedValue)}</td>}</tr>)}
                <tr className="font-semibold"><td className="py-1 pr-4">All</td><td>{src.totals.enquiries}</td><td>{src.totals.booked}</td><td>{src.totals.lost}</td><td /><td>{src.totals.conversion}%</td>{src.totals.bookedValue !== undefined && <td>{money(src.totals.bookedValue)}</td>}</tr></tbody></table></div>
          )}
        </section>
      )}
      {reports && (
        <section className={card} data-testid="year-report">
          <div className="flex items-center justify-between gap-2 mb-2"><h2 className="font-semibold">Events booked each month, against last year</h2><select className={`${input} w-28`} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">{[0, 1, 2].map((n) => <option key={n} value={Number(today.slice(0, 4)) - n}>{Number(today.slice(0, 4)) - n}</option>)}</select></div>
          {!yrs ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : (
            <>
              <div className="grid grid-cols-12 gap-1 items-end h-32" role="img" aria-label={`Events booked each month in ${year} against ${year - 1}`}>
                {yrs.months.map((m) => <div key={m.month} className="flex flex-col items-center justify-end h-full gap-0.5"><div className="flex items-end gap-0.5 h-full w-full justify-center"><div className="w-2 bg-gray-300 dark:bg-slate-600" style={{ height: `${(m.lastYearBooked / peak) * 100}%` }} title={`${MONTHS[m.month - 1]} ${year - 1}: ${m.lastYearBooked}`} /><div className="w-2 bg-orange-500" style={{ height: `${(m.booked / peak) * 100}%` }} title={`${MONTHS[m.month - 1]} ${year}: ${m.booked}`} /></div><span className="text-[10px]">{MONTHS[m.month - 1]}</span></div>)}
              </div>
              <p className={`mt-2 ${muted}`}>{year}: {yrs.totals.booked} booked{yrs.totals.value !== undefined ? ` (${money(yrs.totals.value)})` : ''} · {year - 1}: {yrs.totals.lastYearBooked} booked{yrs.totals.lastYearValue !== undefined ? ` (${money(yrs.totals.lastYearValue)})` : ''}. Grey is last year, orange this year.</p>
            </>
          )}
        </section>
      )}
      {showSettings && settings && (
        <section className={card} data-testid="event-settings">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Settings2 className="w-4 h-4" />Event settings</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {hasFeature('event_guarantee') && num('guaranteeDays', 'Guest count is final (days before)', '0 means no cutoff. After it, only a manager can change the count, with a reason.')}
            {hasFeature('event_guarantee') && num('guaranteeReminderDays', 'Remind the client (days before the cutoff)', '0 means no reminder.')}
            {hasFeature('event_payment_automation') && num('payRemindBeforeDays', 'Remind before a payment is due (days)', '0 means no reminder before.')}
            {hasFeature('event_payment_automation') && num('payRemindOverdueDays', 'Remind after it was due (days)', '0 means no reminder after.')}
            {hasFeature('event_proposals') && num('proposalValidDays', 'A proposal stays open (days)', 'After that the client’s link says it has expired.')}
          </div>
          <div className="mt-3 space-y-2">
            {hasFeature('event_payment_automation') && <label className="flex items-center gap-2"><input type="checkbox" disabled={!maySave} checked={settings.payRemindOnDue} onChange={(e) => set('payRemindOnDue', e.target.checked)} />Remind on the day a payment is due</label>}
            {hasFeature('event_minimums') && <label className="flex items-center gap-2"><input type="checkbox" disabled={!maySave} checked={settings.shortfallTaxed} onChange={(e) => set('shortfallTaxed', e.target.checked)} />Charge sales tax on a minimum-spend shortfall</label>}
            {hasFeature('event_proposals') && <div><label className={label}>Terms printed on every proposal</label><textarea className={input} rows={4} disabled={!maySave} value={settings.proposalTerms} onChange={(e) => set('proposalTerms', e.target.value)} /></div>}
          </div>
          {maySave ? <button type="button" className={`${primary} mt-3`} onClick={save}>Save</button> : <p className={`mt-3 ${muted}`}>Only the owner or an admin changes these.</p>}
        </section>
      )}
    </div>
  )
}
