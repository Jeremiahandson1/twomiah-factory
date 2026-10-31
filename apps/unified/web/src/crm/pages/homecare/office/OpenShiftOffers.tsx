// Open-shift offers (care_open_shift_offers, not ready until the owner has tried it):
//   Board     every open shift with its offer status (Not sent / Pending / Accepted / Declined / Expired / Closed) and counts of who was sent it,
//             accepted, declined, hid it or has not answered; open one for the messages sent (and how each ended), to resend, or to set its answer-by time
//   Series    offer a recurring visit for several weeks at once — the first caregiver to accept takes every visit
//   Settings  what caregivers see: everything offered, only what was sent to them, or nothing; and how many days ahead
// Server: server/crm/homecare/scheduling/openShiftOffers.ts on /api/open-shift-offers (the sending itself is /api/open-shifts/:id/notify).
import { useCallback, useEffect, useState } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, listAll, rows, errorMessage } from '../lib/http'
import { agencyToday } from '../lib/agencyClock'

const inp = 'w-full rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const card = 'rounded-lg border p-4 mb-3 border-gray-200 bg-white text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
const soft = 'text-sm text-gray-600 dark:text-slate-400'
const btn = 'rounded-md px-3 py-1.5 text-sm font-medium bg-blue-600 text-white disabled:opacity-50'
const btn2 = 'rounded-md px-3 py-1.5 text-sm font-medium border border-gray-300 dark:border-slate-600 disabled:opacity-50'
type Tab = 'board' | 'series' | 'settings'
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Counts { sent: number; accepted: number; declined: number; hidden: number; noAnswer: number }
interface Posting {
  id: string; shiftDate: string; startTime: string; endTime: string; status: string; clientFirstName: string | null; clientLastName: string | null
  offerStatus: string; offerStatusLabel: string; counts: Counts; respondBy: string | null; seriesId: string | null; bonusAmount?: number | string | null
}
interface Message { id: string; caregiverId: string; firstName: string; lastName: string; channel: string; channelLabel: string; target: string | null; status: string; statusLabel: string; detail: string | null; createdAt: string }
interface Settings { visibility: string; daysAhead: number | null; visibilityOptions: { code: string; label: string }[] }

const hm = (t: string) => String(t || '').slice(0, 5)
const clientOf = (s: Posting) => `${s.clientFirstName || ''} ${s.clientLastName || ''}`.trim() || 'Client'
const toneOf = (code: string) => code === 'accepted' ? 'text-green-700 dark:text-green-400' : code === 'declined' || code === 'expired' ? 'text-red-700 dark:text-red-400' : code === 'pending' ? 'text-amber-700 dark:text-amber-400' : soft

function Outbox({ s, onChanged }: { s: Posting; onChanged: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [list, setList] = useState<Message[] | null>(null)
  const [by, setBy] = useState(s.respondBy ? s.respondBy.replace('T', ' ').slice(0, 16) : '')
  const [busy, setBusy] = useState(false)
  const [sms, setSms] = useState(false)
  const [email, setEmail] = useState(false)
  const load = useCallback(async () => {
    try { setList(rows<Message>(await api.get(`/api/open-shift-offers/${s.id}/outbox`))) } catch (e) { toast.error(errorMessage(e, 'Could not load the messages')) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id])
  useEffect(() => { load() }, [load])
  const resend = async (mode: 'failed' | 'new' | 'everyone') => {
    if (mode === 'everyone' && !(await confirm('Send it again to everyone it was sent to? Anyone who turned it down or hid it will see it again.', { confirmText: 'Send to everyone' }))) return
    setBusy(true)
    try {
      const channels = ['app', 'push', ...(sms ? ['sms'] : []), ...(email ? ['email'] : [])]
      const r = (await api.post(`/api/open-shift-offers/${s.id}/resend`, { mode, channels })) as any
      toast.success(`Sent to ${r?.notified ?? 0} caregiver(s)`)
      await load(); onChanged()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const saveBy = async () => {
    try { await api.put(`/api/open-shift-offers/${s.id}/deadline`, { respondBy: by.trim() || null }); toast.success(by.trim() ? 'Answer-by time saved' : 'Answer-by time cleared'); onChanged() } catch (e) { toast.error(errorMessage(e)) }
  }
  const failed = (list || []).filter((m) => m.status === 'failed').length
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 8 }}>
        <label className={soft}>Answer by (date and time)
          <input className={inp} style={{ width: 190 }} placeholder="2026-11-02 17:00" value={by} onChange={(e) => setBy(e.target.value)} /></label>
        <button className={btn2} onClick={saveBy}>Save answer-by</button>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <label className={soft}><input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} /> Text too</label>
        <label className={soft}><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email too</label>
        <button className={btn2} disabled={busy || failed === 0} onClick={() => resend('failed')}>Resend failed{failed ? ` (${failed})` : ''}</button>
        <button className={btn2} disabled={busy} onClick={() => resend('new')}>Send to newly eligible</button>
        <button className={btn2} disabled={busy} onClick={() => resend('everyone')}>Send to everyone again</button>
      </div>
      {list === null ? <p className={soft}>Loading…</p> : list.length === 0 ? <p className={soft}>Nothing has been sent for this shift yet.</p> : (
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead><tr className={soft} style={{ textAlign: 'left' }}><th>Caregiver</th><th>How</th><th>Sent to</th><th>Result</th></tr></thead>
          <tbody>{list.map((m) => (
            <tr key={m.id} className="border-t border-gray-200 dark:border-slate-700">
              <td>{m.firstName} {m.lastName}</td><td>{m.channelLabel}</td><td>{m.target || '—'}</td>
              <td className={m.status === 'failed' ? 'text-red-700 dark:text-red-400' : ''}>{m.statusLabel}{m.detail ? ` — ${m.detail}` : ''}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}

function BoardTab() {
  const toast = useToast()
  const [status, setStatus] = useState('active')
  const [list, setList] = useState<Posting[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setList(rows<Posting>(await api.get('/api/open-shift-offers/board', { status }))) } catch (e) { toast.error(errorMessage(e, 'Could not load the board')) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])
  useEffect(() => { load() }, [load])
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <select className={inp} style={{ width: 220 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Show">
          <option value="active">Still open</option><option value="all">All</option>
        </select>
      </div>
      {list === null ? <div className={card}>Loading…</div> : list.length === 0 ? <div className={card}>No open shifts here. Post one from the schedule.</div> : list.map((s) => (
        <div key={s.id} className={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <strong>{s.shiftDate} · {hm(s.startTime)}–{hm(s.endTime)}</strong> · {clientOf(s)}
              {s.seriesId ? <span className={soft}> · part of a series</span> : null}
              {s.respondBy ? <div className={soft}>Answer by {s.respondBy.replace('T', ' ').slice(0, 16)}</div> : null}
            </div>
            <div className={`font-semibold ${toneOf(s.offerStatus)}`}>{s.offerStatusLabel}</div>
          </div>
          <div className={soft} style={{ marginTop: 4 }}>
            Sent to {s.counts.sent} · Accepted {s.counts.accepted} · Declined {s.counts.declined} · Hid it {s.counts.hidden} · No answer {s.counts.noAnswer}
          </div>
          <button className={btn2} style={{ marginTop: 8 }} onClick={() => setOpenId(openId === s.id ? null : s.id)}>{openId === s.id ? 'Close messages' : 'Messages and resend'}</button>
          {openId === s.id && <Outbox s={s} onChanged={load} />}
        </div>
      ))}
    </div>
  )
}

interface Sched { id: string; clientId: string | null; caregiverId: string | null; dayOfWeek: number | null; startTime: string | null; endTime: string | null }
interface Named { id: string; firstName: string; lastName: string }

function SeriesTab({ onPosted }: { onPosted: () => void }) {
  const toast = useToast()
  const [scheds, setScheds] = useState<Sched[]>([])
  const [clients, setClients] = useState<Named[]>([])
  const [cgs, setCgs] = useState<Named[]>([])
  const [f, setF] = useState({ scheduleId: '', from: agencyToday(), weeks: '4', bonus: '', autoAssign: false, respondBy: '' })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    Promise.all([api.get('/api/schedules-all'), listAll('/api/clients'), listAll('/api/caregivers')])
      .then(([s, c, g]) => { setScheds(rows<Sched>(s).filter((x) => x.dayOfWeek !== null && x.dayOfWeek !== undefined)); setClients(rows<Named>(c)); setCgs(rows<Named>(g)) })
      .catch((e) => toast.error(errorMessage(e, 'Could not load the schedule')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const nameOf = (list: Named[], id: string | null) => { const x = list.find((n) => n.id === id); return x ? `${x.firstName} ${x.lastName}` : '—' }
  const post = async () => {
    setBusy(true); setResult(null)
    try {
      const r = (await api.post(`/api/open-shift-offers/series/${f.scheduleId}`, {
        from: f.from, weeks: Number(f.weeks), autoAssign: f.autoAssign, ...(f.bonus.trim() ? { bonusAmount: Number(f.bonus) } : {}), ...(f.respondBy.trim() ? { respondBy: f.respondBy.trim() } : {}),
      })) as any
      const skipped = (r?.skipped || []).map((x: any) => `${x.date}: ${x.reason}`)
      setResult(`${r?.posted} visits posted as one offer.${skipped.length ? ` Left out — ${skipped.join('; ')}` : ''} Send it to caregivers from the board.`)
      onPosted()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className={card}>
      <p className={soft} style={{ marginBottom: 12 }}>Offer a repeating visit for several weeks at once. Whoever accepts first takes every visit, and the shifts are not offered to anyone who already has a visit that clashes.</p>
      <label className={soft}>Which repeating visit
        <select className={inp} value={f.scheduleId} onChange={(e) => setF({ ...f, scheduleId: e.target.value })}>
          <option value="">Choose…</option>
          {scheds.map((s) => <option key={s.id} value={s.id}>{nameOf(clients, s.clientId)} · {DAY_FULL[Number(s.dayOfWeek)]} · {hm(String(s.startTime || '').slice(-8))}–{hm(String(s.endTime || '').slice(-8))} · now {nameOf(cgs, s.caregiverId)}</option>)}
        </select></label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
        <label className={soft}>From <input className={inp} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className={soft}>Weeks (2–12) <input className={inp} inputMode="numeric" value={f.weeks} onChange={(e) => setF({ ...f, weeks: e.target.value })} /></label>
        <label className={soft}>Bonus per visit ($) <input className={inp} inputMode="decimal" value={f.bonus} onChange={(e) => setF({ ...f, bonus: e.target.value })} /></label>
        <label className={soft}>Answer by <input className={inp} placeholder="2026-11-02 17:00" value={f.respondBy} onChange={(e) => setF({ ...f, respondBy: e.target.value })} /></label>
      </div>
      <label className={soft} style={{ display: 'block', marginBottom: 8 }}><input type="checkbox" checked={f.autoAssign} onChange={(e) => setF({ ...f, autoAssign: e.target.checked })} /> The first to accept gets it without waiting for the office</label>
      <button className={btn} disabled={busy || !f.scheduleId} onClick={post}>Offer the series</button>
      {result ? <p style={{ marginTop: 8 }}>{result}</p> : null}
    </div>
  )
}

function SettingsTab() {
  const toast = useToast()
  const [s, setS] = useState<Settings | null>(null)
  const [days, setDays] = useState('')
  const [vis, setVis] = useState('all')
  useEffect(() => {
    api.get('/api/open-shift-offers/settings').then((r: any) => { setS(r); setVis(r.visibility); setDays(r.daysAhead ? String(r.daysAhead) : '') }).catch((e) => toast.error(errorMessage(e, 'Could not load the settings')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const save = async () => {
    try { await api.put('/api/open-shift-offers/settings', { visibility: vis, daysAhead: days.trim() ? Number(days) : null }); toast.success('Saved') } catch (e) { toast.error(errorMessage(e)) }
  }
  if (!s) return <div className={card}>Loading…</div>
  return (
    <div className={card}>
      <strong>What caregivers see</strong>
      <div style={{ margin: '8px 0' }}>
        {s.visibilityOptions.map((o) => (
          <label key={o.code} style={{ display: 'block', padding: '4px 0' }}><input type="radio" name="vis" checked={vis === o.code} onChange={() => setVis(o.code)} /> {o.label}</label>
        ))}
      </div>
      <label className={soft}>Only shifts within this many days (leave empty for no limit)
        <input className={inp} style={{ maxWidth: 160 }} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
      <div style={{ marginTop: 12 }}><button className={btn} onClick={save}>Save</button></div>
    </div>
  )
}

export default function OpenShiftOffers() {
  const [tab, setTab] = useState<Tab>('board')
  const [key, setKey] = useState(0)
  const tabs: [Tab, string][] = [['board', 'Offers'], ['series', 'Offer a series'], ['settings', 'What caregivers see']]
  return (
    <div style={{ padding: 16, maxWidth: 960 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 12 }}>Open shift offers</h1>
      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? btn : btn2} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'board' && <BoardTab key={key} />}
      {tab === 'series' && <SeriesTab onPosted={() => setKey((k) => k + 1)} />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}
