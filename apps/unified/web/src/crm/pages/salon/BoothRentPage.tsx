// Booth rent (salon row 24; hidden feature `booth_rent`): the chair renters, what each owes, their rent and autopay, and each one's ledger and
// statement. Served by /api/booth-rent (server/crm/salon/boothRentRoutes.ts). A renter is a Team member; this page adds the rent.
import { useState, useEffect, useCallback } from 'react'
import { Loader2, Plus, X, Armchair } from 'lucide-react'
import { api } from '../../../api'
import { useAuth, useMayWrite, useToast, useConfirm, usePrompt, money as fmtMoney } from '../../../shared'

interface OpenInvoice { invoiceId: string; period: string; owedCents: number; number: string }
interface Renter {
  id: string; teamMemberId: string; name: string; email: string | null; phone: string | null; status: 'active' | 'paused' | 'ended'
  rentCents: number; frequency: 'weekly' | 'monthly'; dueWeekday: number | null; dueDay: number | null; rentWords: string; startDate: string; nextDue: string | null; endedOn: string | null; notes: string | null
  autoCharge: boolean; autoChargeConsentVia: string | null; card: { words: string; last4: string | null } | null
  owedCents: number; overdueCents: number; openInvoices: OpenInvoice[]; lastPaidAt: string | null
  lastCharge: { status: string; attempt: number; tries: number; message: string | null } | null
}
interface TeamMember { id: string; name: string }
interface LedgerLine { date: string; kind: string; description: string; chargeCents: number; paymentCents: number; balanceCents: number; invoiceNumber: string | null }
interface Statement { renter: string; from: string; to: string; openingCents: number; chargesCents: number; paymentsCents: number; closingCents: number; lines: LedgerLine[] }

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const c$ = (cents: number) => fmtMoney(cents / 100)
const day = (s?: string | null) => (s ? new Date(s.slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const inputCls = 'w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-600'
const STATUS: Record<string, string> = { active: 'Active', paused: 'Autopay paused', ended: 'Left' }

type Form = { teamMemberId: string; name: string; email: string; phone: string; rent: string; frequency: string; dueWeekday: string; dueDay: string; startDate: string; notes: string }
const blank = (today: string): Form => ({ teamMemberId: '', name: '', email: '', phone: '', rent: '', frequency: 'weekly', dueWeekday: '5', dueDay: '1', startDate: today, notes: '' })

export default function BoothRentPage() {
  const { hasFeature } = useAuth()
  const mayCreate = useMayWrite('invoices:create')
  const mayUpdate = useMayWrite('invoices:update')
  const toast = useToast()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const [renters, setRenters] = useState<Renter[] | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [form, setForm] = useState<Form | null>(null)
  const [editing, setEditing] = useState<Renter | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<Renter | null>(null)
  const today = new Date().toISOString().slice(0, 10)

  const load = useCallback(async () => {
    try { const r: any = await api.get('/api/booth-rent/renters'); setRenters(r?.data ?? []) }
    catch (e: any) { toast.error(e?.message || 'The renters could not be loaded.'); setRenters([]) }
  }, [toast])
  useEffect(() => { void load() }, [load])
  useEffect(() => { api.get('/api/team', { limit: 100 }).then((r: any) => setMembers((r?.data ?? []).map((m: any) => ({ id: m.id, name: m.name })))).catch(() => setMembers([])) }, [])

  const cardOn = hasFeature('card_on_file')
  const act = async (id: string, label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(id + label)
    try { await fn(); if (ok) toast.success(ok); await load() } catch (e: any) { toast.error(e?.message || 'That did not work.') } finally { setBusy('') }
  }

  const save = async () => {
    if (!form) return
    setErrors({})
    const body: Record<string, unknown> = { rent: form.rent, frequency: form.frequency, startDate: form.startDate, notes: form.notes }
    if (form.frequency === 'weekly') body.dueWeekday = Number(form.dueWeekday); else body.dueDay = Number(form.dueDay)
    try {
      if (editing) await api.patch(`/api/booth-rent/renters/${editing.id}`, body)
      else {
        if (form.teamMemberId) body.teamMemberId = form.teamMemberId; else Object.assign(body, { name: form.name, email: form.email, phone: form.phone })
        await api.post('/api/booth-rent/renters', body)
      }
      setForm(null); setEditing(null); toast.success('Saved'); await load()
    } catch (e: any) { setErrors(e?.data?.fields || {}); toast.error(e?.message || 'Could not save') }
  }

  const autopay = async (r: Renter, on: boolean) => {
    if (on && !(await confirm(`Has ${r.name} agreed to have their rent (${r.rentWords}) charged to their card on file each time it is due? Each charge is made on your own Stripe account and they are emailed a receipt.`, { title: 'Charge their card automatically', confirmText: 'They agreed', danger: false }))) return
    await act(r.id, 'auto', () => api.put(`/api/booth-rent/renters/${r.id}/auto-pay`, on ? { on, renterAgreed: true } : { on }))
  }
  const resume = async (r: Renter) => {
    if (!(await confirm(`Start ${r.name}'s automatic payments again? Every unpaid rent is charged to the card on file now. If it is declined, autopay stays paused.`, { title: 'Resume autopay', confirmText: 'Resume it', danger: false }))) return
    await act(r.id, 'resume', async () => {
      const res: any = await api.post(`/api/booth-rent/renters/${r.id}/resume`, {})
      const out = res?.resumeResult
      if (out === 'paid' || out === 'no_invoice') toast.success('Autopay resumed'); else toast.error('The card was not accepted — autopay is still paused. They have been sent a new link.')
    })
  }
  const retry = (r: Renter) => act(r.id, 'retry', async () => {
    const res: any = await api.post(`/api/booth-rent/renters/${r.id}/retry`, {})
    if (res?.retryResult === 'paid') toast.success(`${r.name}'s card was charged`); else toast.error('The card was declined again.')
  })
  const waive = async (r: Renter, period?: string) => {
    const p = period ?? r.nextDue
    if (!p) return
    const reason = await prompt(`Waive the rent due ${day(p)}? An unpaid invoice for it is voided. Say why:`, { title: 'Waive rent', confirmText: 'Waive it', placeholder: 'e.g. Salon closed for a week' })
    if (!reason) return
    await act(r.id, 'waive', () => api.post(`/api/booth-rent/renters/${r.id}/waive`, { period: p, reason }), 'Waived')
  }
  const end = async (r: Renter) => {
    if (!(await confirm(`${r.name} leaves today? Rent due up to today is invoiced first; what is unpaid stays open. Their history stays.`, { title: 'End rent', confirmText: 'They leave' }))) return
    await act(r.id, 'end', () => api.post(`/api/booth-rent/renters/${r.id}/end`, {}), 'Ended')
  }
  const link = (r: Renter) => act(r.id, 'link', () => api.post(`/api/booth-rent/renters/${r.id}/card-link`, {}), `The link was emailed to ${r.email}`)
  const addAtDesk = (r: Renter) => act(r.id, 'desk', async () => {
    const res: any = await api.post(`/api/booth-rent/renters/${r.id}/card-setup`, {})
    if (res?.url) window.open(res.url, '_blank', 'noopener')
    toast.success('Stripe’s card page is open. Once the renter saves their card it shows here.')
    setTimeout(() => { void load() }, 8000)
  })

  const startEdit = (r: Renter) => {
    setEditing(r); setErrors({})
    setForm({ ...blank(today), rent: String(r.rentCents / 100), frequency: r.frequency, dueWeekday: String(r.dueWeekday ?? 5), dueDay: String(r.dueDay ?? 1), startDate: r.startDate, notes: r.notes ?? '' })
  }

  const owedTotal = (renters ?? []).reduce((t, r) => t + r.owedCents, 0)
  const overdueTotal = (renters ?? []).reduce((t, r) => t + r.overdueCents, 0)
  const rentersNow = (renters ?? []).filter((r) => r.status !== 'ended')
  const taken = new Set((renters ?? []).filter((r) => r.status !== 'ended').map((r) => r.teamMemberId))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100"><Armchair className="w-6 h-6 text-rose-500 dark:text-rose-300" /> Booth rent</h1>
          <p className="text-gray-500 dark:text-slate-400">Chair renters, their rent, and what they owe</p>
        </div>
        {mayCreate && <button onClick={() => { setEditing(null); setErrors({}); setForm(blank(today)) }} className="flex items-center gap-2 px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800"><Plus className="w-4 h-4" /> Add a renter</button>}
      </div>

      {renters && rentersNow.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3" data-testid="rent-totals">
          <div className="bg-white rounded-xl border p-4 dark:bg-slate-900 dark:border-slate-700"><div className="text-sm text-gray-500 dark:text-slate-400">Renters</div><div className="text-2xl font-semibold">{rentersNow.length}</div></div>
          <div className="bg-white rounded-xl border p-4 dark:bg-slate-900 dark:border-slate-700"><div className="text-sm text-gray-500 dark:text-slate-400">Owed now</div><div className="text-2xl font-semibold">{c$(owedTotal)}</div></div>
          <div className="bg-white rounded-xl border p-4 dark:bg-slate-900 dark:border-slate-700"><div className="text-sm text-gray-500 dark:text-slate-400">Past due</div><div className={`text-2xl font-semibold ${overdueTotal > 0 ? 'text-red-700 dark:text-red-300' : ''}`}>{c$(overdueTotal)}</div></div>
        </div>
      )}

      {form && (
        <section className="bg-white rounded-xl border p-4 dark:bg-slate-900 dark:border-slate-700" aria-label={editing ? 'Change rent' : 'Add a renter'}>
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold text-gray-900 dark:text-slate-100">{editing ? `${editing.name} — change the rent` : 'Add a renter'}</h2>
            <button onClick={() => { setForm(null); setEditing(null) }} aria-label="Close" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>
          </div>
          {editing && <p className="text-sm text-gray-600 mb-3 dark:text-slate-300">A change applies to rent not yet invoiced. What was invoiced stays as it was.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {!editing && (
              <>
                <label className="text-sm sm:col-span-2"><span className="block mb-1">Team member</span>
                  <select className={inputCls} value={form.teamMemberId} onChange={(e) => setForm({ ...form, teamMemberId: e.target.value })}>
                    <option value="">A new person…</option>
                    {members.filter((m) => !taken.has(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                {!form.teamMemberId && (
                  <>
                    <label className="text-sm"><span className="block mb-1">Name</span><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />{errors.name && <span className="text-xs text-red-700 dark:text-red-300" role="alert">{errors.name}</span>}</label>
                    <label className="text-sm"><span className="block mb-1">Email (for receipts and the card link)</span><input type="email" className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />{errors.email && <span className="text-xs text-red-700 dark:text-red-300" role="alert">{errors.email}</span>}</label>
                    <label className="text-sm"><span className="block mb-1">Phone</span><input type="tel" className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
                  </>
                )}
              </>
            )}
            <label className="text-sm"><span className="block mb-1">Rent each time ($)</span><input inputMode="decimal" className={inputCls} value={form.rent} onChange={(e) => setForm({ ...form, rent: e.target.value })} />{errors.rent && <span className="text-xs text-red-700 dark:text-red-300" role="alert">{errors.rent}</span>}</label>
            <label className="text-sm"><span className="block mb-1">Paid</span>
              <select className={inputCls} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}><option value="weekly">Every week</option><option value="monthly">Every month</option></select>
              {errors.frequency && <span className="text-xs text-red-700 dark:text-red-300" role="alert">{errors.frequency}</span>}
            </label>
            {form.frequency === 'weekly'
              ? <label className="text-sm"><span className="block mb-1">Due on</span><select className={inputCls} value={form.dueWeekday} onChange={(e) => setForm({ ...form, dueWeekday: e.target.value })}>{WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}</select>{errors.dueWeekday && <span className="text-xs text-red-700 dark:text-red-300" role="alert">{errors.dueWeekday}</span>}</label>
              : <label className="text-sm"><span className="block mb-1">Due on the day of the month</span><input type="number" min={1} max={31} className={inputCls} value={form.dueDay} onChange={(e) => setForm({ ...form, dueDay: e.target.value })} /><span className="text-xs text-gray-500 dark:text-slate-400">A short month is billed on its last day.</span>{errors.dueDay && <span className="block text-xs text-red-700 dark:text-red-300" role="alert">{errors.dueDay}</span>}</label>}
            <label className="text-sm"><span className="block mb-1">Starts</span><input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} disabled={!!editing && editing.nextDue !== null && editing.startDate < today && false} />{errors.startDate && <span className="text-xs text-red-700 dark:text-red-300" role="alert">{errors.startDate}</span>}</label>
            <label className="text-sm sm:col-span-2"><span className="block mb-1">Notes</span><input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Chair 4, includes shampoo bowl" />{errors.notes && <span className="text-xs text-red-700 dark:text-red-300" role="alert">{errors.notes}</span>}</label>
          </div>
          <div className="mt-4 flex gap-2"><button onClick={save} className="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800">Save</button><button onClick={() => { setForm(null); setEditing(null) }} className="px-4 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">Cancel</button></div>
        </section>
      )}

      {renters === null ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : renters.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border dark:text-slate-400 dark:bg-slate-900">No chair renters yet. Add a renter to bill their rent on a schedule.</div>
      ) : (
        <ul className="space-y-3">
          {renters.map((r) => (
            <li key={r.id} className="bg-white rounded-xl border p-4 dark:bg-slate-900 dark:border-slate-700" data-testid="renter-row">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-slate-100">{r.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'paused' ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : r.status === 'ended' ? 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300' : 'bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200'}`}>{STATUS[r.status]}</span>
                  </div>
                  <div className="text-sm text-gray-600 dark:text-slate-300">{r.rentWords}{r.nextDue && r.status !== 'ended' ? ` · next due ${day(r.nextDue)}` : ''}{r.status === 'ended' ? ` · left ${day(r.endedOn)}` : ''}</div>
                  <div className="text-sm text-gray-600 dark:text-slate-300">
                    {r.card ? r.card.words : 'No card on file'}{r.autoCharge ? ' · pays automatically' : ''}{r.lastPaidAt ? ` · last paid ${day(r.lastPaidAt)}` : ''}
                  </div>
                  {r.lastCharge && r.lastCharge.status !== 'succeeded' && (
                    <div className="text-sm text-amber-800 dark:text-amber-200" role="status">
                      {r.lastCharge.status === 'needs_action' ? 'The card needs the renter to approve the charge' : 'The card was declined'} — try {r.lastCharge.attempt} of {r.lastCharge.tries}.{r.status === 'paused' ? ' Autopay is paused: resume it once they have a new card.' : ''}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className={`text-lg font-semibold ${r.overdueCents > 0 ? 'text-red-700 dark:text-red-300' : ''}`}>{c$(r.owedCents)}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400">{r.owedCents > 0 ? (r.overdueCents > 0 ? `${c$(r.overdueCents)} past due` : 'owed') : 'nothing owed'}</div>
                </div>
              </div>
              <div className="mt-3 flex gap-3 flex-wrap text-sm">
                <button className="text-teal-700 hover:underline dark:text-teal-300" onClick={() => setOpen(open?.id === r.id ? null : r)}>{open?.id === r.id ? 'Hide ledger' : 'Ledger and statement'}</button>
                {mayUpdate && r.status !== 'ended' && (
                  <>
                    <button className="text-teal-700 hover:underline dark:text-teal-300" onClick={() => startEdit(r)}>Change rent</button>
                    {r.nextDue && <button className="text-teal-700 hover:underline dark:text-teal-300" onClick={() => waive(r)}>Waive next rent</button>}
                    {cardOn && !r.card && <button className="text-teal-700 hover:underline dark:text-teal-300" onClick={() => addAtDesk(r)} disabled={busy === r.id + 'desk'}>Add a card here</button>}
                    {cardOn && r.email && <button className="text-teal-700 hover:underline dark:text-teal-300" onClick={() => link(r)} disabled={busy === r.id + 'link'}>{r.card ? 'Email a card link' : 'Email them a link to add a card'}</button>}
                    {cardOn && r.card && !r.autoCharge && r.status === 'active' && <button className="text-teal-700 hover:underline dark:text-teal-300" onClick={() => autopay(r, true)}>Charge their card automatically</button>}
                    {r.autoCharge && r.status === 'active' && <button className="text-teal-700 hover:underline dark:text-teal-300" onClick={() => autopay(r, false)}>Stop automatic payments</button>}
                    {r.status === 'active' && r.lastCharge && ['declined', 'needs_action'].includes(r.lastCharge.status) && r.lastCharge.attempt < r.lastCharge.tries && <button className="text-teal-700 hover:underline dark:text-teal-300" onClick={() => retry(r)} disabled={busy === r.id + 'retry'}>{busy === r.id + 'retry' ? 'Trying…' : 'Retry now'}</button>}
                    {r.status === 'paused' && <button className="text-teal-700 hover:underline dark:text-teal-300" onClick={() => resume(r)} disabled={busy === r.id + 'resume'}>Resume autopay</button>}
                    <button className="text-red-700 hover:underline dark:text-red-300" onClick={() => end(r)}>They leave</button>
                  </>
                )}
              </div>
              {open?.id === r.id && <Ledger renter={r} may={mayUpdate} onWaive={(p) => waive(r, p)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Ledger({ renter, may, onWaive }: { renter: Renter; may: boolean; onWaive: (period: string) => void }) {
  const toast = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const [from, setFrom] = useState(renter.startDate)
  const [to, setTo] = useState(today)
  const [s, setS] = useState<Statement | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    setErr('')
    api.get(`/api/booth-rent/renters/${renter.id}/statement?from=${from}&to=${to}`).then((r: any) => { if (live) setS(r) }).catch((e: any) => { if (live) { setS(null); setErr(e?.message || 'The statement could not be loaded.') } })
    return () => { live = false }
  }, [renter.id, from, to])
  const download = async () => {
    try {
      const res = await api.raw(`/api/booth-rent/renters/${renter.id}/statement?from=${from}&to=${to}&format=csv`)
      if (!res.ok) throw new Error('The file could not be made.')
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a'); a.href = url; a.download = `rent-statement-${renter.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${from}-to-${to}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e: any) { toast.error(e?.message || 'The file could not be made.') }
  }
  const email = async () => {
    try { await api.post(`/api/booth-rent/renters/${renter.id}/statement/email`, { from, to }); toast.success('The statement was emailed.') } catch (e: any) { toast.error(e?.message || 'It could not be emailed.') }
  }
  return (
    <div className="mt-4 border-t pt-4 dark:border-slate-700" data-testid="ledger">
      <div className="flex items-end gap-3 flex-wrap mb-3">
        <label className="text-sm"><span className="block">From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-600" /></label>
        <label className="text-sm"><span className="block">To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-600" /></label>
        <button onClick={() => window.print()} className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-slate-800">Print</button>
        <button onClick={download} className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-slate-800">Download (spreadsheet)</button>
        {may && renter.email && <button onClick={email} className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-slate-800">Email it to {renter.name.split(' ')[0]}</button>}
      </div>
      {err && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{err}</p>}
      {s && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 dark:text-slate-400"><th className="py-1 pr-3">Date</th><th className="pr-3">What</th><th className="pr-3 text-right">Charged</th><th className="pr-3 text-right">Paid</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              <tr className="text-gray-600 dark:text-slate-300"><td className="py-1 pr-3" colSpan={4}>Owed at the start ({day(s.from)})</td><td className="text-right">{c$(s.openingCents)}</td></tr>
              {s.lines.map((l, i) => (
                <tr key={i} className="border-t dark:border-slate-700">
                  <td className="py-1 pr-3 whitespace-nowrap">{day(l.date)}</td>
                  <td className="pr-3">{l.description}{l.invoiceNumber ? <span className="text-gray-500 dark:text-slate-400"> · {l.invoiceNumber}</span> : ''}{may && l.kind === 'rent' && l.balanceCents > 0 && <button className="ml-2 text-xs text-teal-700 hover:underline dark:text-teal-300" onClick={() => onWaive(l.date)}>Waive</button>}</td>
                  <td className="pr-3 text-right">{l.chargeCents ? c$(l.chargeCents) : ''}</td>
                  <td className="pr-3 text-right">{l.paymentCents ? c$(l.paymentCents) : ''}</td>
                  <td className="text-right">{c$(l.balanceCents)}</td>
                </tr>
              ))}
              {s.lines.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-500 dark:text-slate-400">Nothing happened in these days.</td></tr>}
              <tr className="border-t font-semibold dark:border-slate-700"><td className="py-1 pr-3" colSpan={2}>Owed at the end ({day(s.to)})</td><td className="pr-3 text-right">{c$(s.chargesCents)}</td><td className="pr-3 text-right">{c$(s.paymentsCents)}</td><td className="text-right">{c$(s.closingCents)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
