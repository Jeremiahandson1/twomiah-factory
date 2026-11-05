// Pickup bonus, points and rewards (care_pickup_rewards, not ready until the owner has tried it):
//   Bonuses   the open shifts caregivers picked up, the bonus each carried, and whether the visit has been worked (a worked one is in the pay run)
//   Points    what earns points (extra shift, on-time clock-in, weekly minimum hours), who has how many, and a hand adjustment with a reason
//   Rewards   the reward catalogue, and the requests to hand over (declining returns the points)
// Server: server/crm/homecare/scheduling/pickupRewards.ts on /api/care-rewards.
import { useCallback, useEffect, useState } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, rows, errorMessage } from '../lib/http'
import { agencyToday, formatAgencyDateTime } from '../lib/agencyClock'

const inp = 'w-full rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const card = 'rounded-lg border p-4 mb-3 border-gray-200 bg-white text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
const soft = 'text-sm text-gray-600 dark:text-slate-400'
const btn = 'rounded-md px-3 py-1.5 text-sm font-medium bg-blue-600 text-white disabled:opacity-50'
const btn2 = 'rounded-md px-3 py-1.5 text-sm font-medium border border-gray-300 dark:border-slate-600'
type Tab = 'bonuses' | 'points' | 'rewards'
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
const daysAgo = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }

interface Pickup { openShiftId: string; shiftDate: string; bonusCents: number; worked: boolean; caregiverFirst: string; caregiverLast: string; clientFirst: string | null; clientLast: string | null }
interface Rules { enabled: boolean; startedOn: string | null; pointsPerExtraShift: number; pointsPerOnTime: number; minHoursPerWeek: number; pointsForMinHours: number }
interface Board { caregiverId: string; firstName: string; lastName: string; balance: number; earned: number; waiting: number }
interface Item { id: string; name: string; description: string | null; costPoints: number; isActive: boolean }
interface Request { id: string; name: string; points: number; status: string; statusLabel: string; handledNote: string | null; createdAt: string; firstName: string; lastName: string }

function Bonuses() {
  const toast = useToast()
  const [from, setFrom] = useState(daysAgo(agencyToday(), 14))
  const [to, setTo] = useState(agencyToday())
  const [list, setList] = useState<Pickup[] | null>(null)
  const load = useCallback(async () => {
    try { setList(rows<Pickup>(await api.get('/api/care-rewards/pickups', { startDate: from, endDate: to }))) } catch (e) { toast.error(errorMessage(e, 'Could not load the pickups')) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])
  useEffect(() => { load() }, [load])
  const owed = (list || []).filter((p) => p.worked).reduce((s, p) => s + p.bonusCents, 0)
  const waiting = (list || []).filter((p) => !p.worked).reduce((s, p) => s + p.bonusCents, 0)
  return (
    <div>
      <p className={soft} style={{ marginBottom: 12 }}>The bonus on an open shift is paid in the pay run once the visit has been worked and its hours are approved. It shows on Payroll → Calculate as its own line.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <label className={soft}>From <input className={inp} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className={soft}>To <input className={inp} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className={card} style={{ minWidth: 200 }}><div className={soft}>In the pay run (worked)</div><div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{money(owed)}</div></div>
        <div className={card} style={{ minWidth: 200 }}><div className={soft}>Not worked yet</div><div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{money(waiting)}</div></div>
      </div>
      {list === null ? <div className={card}>Loading…</div> : list.length === 0 ? <div className={card}>No open shifts were picked up in these dates.</div> : (
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead><tr className={soft} style={{ textAlign: 'left' }}><th>Date</th><th>Caregiver</th><th>Client</th><th style={{ textAlign: 'right' }}>Bonus</th><th>Status</th></tr></thead>
          <tbody>{list.map((p) => (
            <tr key={p.openShiftId} className="border-t border-gray-200 dark:border-slate-700">
              <td>{p.shiftDate}</td><td>{p.caregiverFirst} {p.caregiverLast}</td><td>{p.clientFirst} {p.clientLast}</td>
              <td style={{ textAlign: 'right' }}>{p.bonusCents ? money(p.bonusCents) : '—'}</td>
              <td>{p.worked ? 'Worked — in the pay run' : 'Not worked yet'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}

function Points() {
  const toast = useToast()
  const [rules, setRules] = useState<Rules | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [board, setBoard] = useState<Board[]>([])
  const [adj, setAdj] = useState({ caregiverId: '', points: '', note: '' })
  const load = useCallback(async () => {
    try {
      const r = (await api.get('/api/care-rewards/rules')) as Rules
      setRules(r)
      setDraft({ pointsPerExtraShift: String(r.pointsPerExtraShift), pointsPerOnTime: String(r.pointsPerOnTime), minHoursPerWeek: String(r.minHoursPerWeek), pointsForMinHours: String(r.pointsForMinHours) })
      setBoard(rows<Board>(await api.get('/api/care-rewards/board')))
    } catch (e) { toast.error(errorMessage(e, 'Could not load points')) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])
  const save = async (enabled: boolean) => {
    try { await api.put('/api/care-rewards/rules', { enabled, ...Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v])) }); toast.success(enabled ? 'Points are on' : 'Points are off'); load() } catch (e) { toast.error(errorMessage(e)) }
  }
  const adjust = async () => {
    try { await api.post('/api/care-rewards/adjust', { caregiverId: adj.caregiverId, points: Number(adj.points), note: adj.note }); toast.success('Points adjusted'); setAdj({ caregiverId: '', points: '', note: '' }); load() } catch (e) { toast.error(errorMessage(e)) }
  }
  if (!rules) return <div className={card}>Loading…</div>
  const field = (key: string, label: string, hint?: string) => (
    <label className={soft} style={{ display: 'block', marginBottom: 8 }}>{label}
      <input className={inp} inputMode="numeric" value={draft[key] ?? ''} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
      {hint && <span style={{ fontSize: '0.8rem' }}>{hint}</span>}
    </label>
  )
  return (
    <div>
      <div className={card}>
        <strong>What earns points</strong>
        <p className={soft}>{rules.enabled ? `On since ${rules.startedOn}. Only visits from that day on earn points.` : 'Off. When you turn it on, points start that day — nothing is counted back.'}</p>
        {field('pointsPerExtraShift', 'Points for an extra shift picked up', 'Earned once the open shift’s visit has been worked and paid.')}
        {field('pointsPerOnTime', 'Points for each on-time clock-in', 'On time = clocked in within 7 minutes after the scheduled start (early is fine).')}
        {field('minHoursPerWeek', 'Weekly minimum hours (0 = no minimum)', 'Counted for each finished work week.')}
        {field('pointsForMinHours', 'Points for a week at or over the minimum')}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={btn} onClick={() => save(true)}>{rules.enabled ? 'Save' : 'Save and turn on'}</button>
          {rules.enabled && <button className={btn2} onClick={() => save(false)}>Turn off</button>}
        </div>
      </div>
      <div className={card}>
        <strong>Who has points</strong>
        {board.length === 0 ? <p className={soft}>No one has earned points yet.</p> : (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse', marginTop: 8 }}>
            <thead><tr className={soft} style={{ textAlign: 'left' }}><th>Caregiver</th><th style={{ textAlign: 'right' }}>Balance</th><th style={{ textAlign: 'right' }}>Earned in all</th><th style={{ textAlign: 'right' }}>Requests waiting</th></tr></thead>
            <tbody>{board.map((b) => (
              <tr key={b.caregiverId} className="border-t border-gray-200 dark:border-slate-700"><td>{b.firstName} {b.lastName}</td><td style={{ textAlign: 'right' }}>{b.balance}</td><td style={{ textAlign: 'right' }}>{b.earned}</td><td style={{ textAlign: 'right' }}>{b.waiting || '—'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className={card}>
        <strong>Add or take away points</strong>
        <p className={soft}>The caregiver sees your reason on their points page.</p>
        <select className={inp} value={adj.caregiverId} onChange={(e) => setAdj({ ...adj, caregiverId: e.target.value })} aria-label="Caregiver" style={{ marginBottom: 8 }}>
          <option value="">Choose a caregiver…</option>
          {board.map((b) => <option key={b.caregiverId} value={b.caregiverId}>{b.firstName} {b.lastName}</option>)}
        </select>
        <input className={inp} style={{ marginBottom: 8 }} placeholder="Points, e.g. 5 or -5" inputMode="numeric" value={adj.points} onChange={(e) => setAdj({ ...adj, points: e.target.value })} />
        <input className={inp} style={{ marginBottom: 8 }} placeholder="Why" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} />
        <button className={btn} disabled={!adj.caregiverId || !adj.points} onClick={adjust}>Adjust</button>
        <p className={soft} style={{ marginTop: 8 }}>Only caregivers who have already earned points are listed here.</p>
      </div>
    </div>
  )
}

function Rewards() {
  const toast = useToast()
  const confirm = useConfirm()
  const [items, setItems] = useState<Item[]>([])
  const [reqs, setReqs] = useState<Request[]>([])
  const [status, setStatus] = useState('requested')
  const [f, setF] = useState({ name: '', description: '', costPoints: '' })
  const [notes, setNotes] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    try {
      setItems(rows<Item>(await api.get('/api/care-rewards/items')))
      setReqs(rows<Request>(await api.get('/api/care-rewards/requests', status ? { status } : {})))
    } catch (e) { toast.error(errorMessage(e, 'Could not load rewards')) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])
  useEffect(() => { load() }, [load])
  const add = async () => {
    try { await api.post('/api/care-rewards/items', { name: f.name, description: f.description, costPoints: Number(f.costPoints) }); setF({ name: '', description: '', costPoints: '' }); toast.success('Reward added'); load() } catch (e) { toast.error(errorMessage(e)) }
  }
  const toggle = async (i: Item) => {
    try { await api.put(`/api/care-rewards/items/${i.id}`, { name: i.name, description: i.description, costPoints: i.costPoints, isActive: !i.isActive }); load() } catch (e) { toast.error(errorMessage(e)) }
  }
  const handle = async (r: Request, action: 'fulfil' | 'decline') => {
    if (action === 'decline' && !(await confirm(`Decline "${r.name}" for ${r.firstName} ${r.lastName}? Their ${r.points} points go back.`, { confirmText: 'Decline', danger: true }))) return
    try { await api.put(`/api/care-rewards/requests/${r.id}`, { action, note: notes[r.id] || '' }); toast.success(action === 'fulfil' ? 'Marked as given' : 'Declined — points returned'); load() } catch (e) { toast.error(errorMessage(e)) }
  }
  return (
    <div>
      <div className={card}>
        <strong>Requests</strong>
        <div style={{ margin: '8px 0' }}>
          <select className={inp} style={{ width: 220 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Show">
            <option value="requested">Waiting for the office</option><option value="fulfilled">Given</option><option value="declined">Not given</option><option value="">All</option>
          </select>
        </div>
        {reqs.length === 0 ? <p className={soft}>No requests here.</p> : reqs.map((r) => (
          <div key={r.id} className="border-t border-gray-200 dark:border-slate-700" style={{ padding: '8px 0' }}>
            <div><strong>{r.name}</strong> — {r.firstName} {r.lastName} · {r.points} points</div>
            <div className={soft}>{formatAgencyDateTime(r.createdAt)} · {r.statusLabel}{r.handledNote ? ` · “${r.handledNote}”` : ''}</div>
            {r.status === 'requested' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <input className={inp} style={{ maxWidth: 260 }} placeholder="Note to the caregiver (optional)" value={notes[r.id] || ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                <button className={btn} onClick={() => handle(r, 'fulfil')}>Mark as given</button>
                <button className={btn2} onClick={() => handle(r, 'decline')}>Decline</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className={card}>
        <strong>Rewards caregivers can ask for</strong>
        {items.length === 0 ? <p className={soft}>No rewards yet — add one below.</p> : items.map((i) => (
          <div key={i.id} className="border-t border-gray-200 dark:border-slate-700" style={{ padding: '8px 0', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div><strong>{i.name}</strong> · {i.costPoints} points{!i.isActive && <span className={soft}> · hidden from caregivers</span>}{i.description && <div className={soft}>{i.description}</div>}</div>
            <button className={btn2} onClick={() => toggle(i)}>{i.isActive ? 'Hide' : 'Show'}</button>
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <input className={inp} style={{ marginBottom: 8 }} placeholder="Reward, e.g. $25 grocery card" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className={inp} style={{ marginBottom: 8 }} placeholder="A line about it (optional)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <input className={inp} style={{ marginBottom: 8 }} placeholder="Cost in points" inputMode="numeric" value={f.costPoints} onChange={(e) => setF({ ...f, costPoints: e.target.value })} />
          <button className={btn} disabled={!f.name.trim() || !f.costPoints} onClick={add}>Add reward</button>
        </div>
      </div>
    </div>
  )
}

export default function PickupRewards() {
  const [tab, setTab] = useState<Tab>('bonuses')
  const [waiting, setWaiting] = useState(0)
  useEffect(() => { api.get('/api/care-rewards/summary').then((s: any) => setWaiting(s?.waiting ?? 0)).catch(() => {}) }, [tab])
  const tabs: [Tab, string][] = [['bonuses', 'Pickup bonuses'], ['points', 'Points'], ['rewards', waiting ? `Rewards (${waiting} waiting)` : 'Rewards']]
  return (
    <div style={{ padding: 16, maxWidth: 960 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 12 }}>Pickup bonus & rewards</h1>
      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? btn : btn2} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'bonuses' && <Bonuses />}
      {tab === 'points' && <Points />}
      {tab === 'rewards' && <Rewards />}
    </div>
  )
}
