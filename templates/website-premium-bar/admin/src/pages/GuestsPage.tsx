// Guests — the Regulars list. Search by name or the last digits of a phone,
// sort by who's been in lately / most / spent most / has points, open a
// profile to see visits and what they order, fix details, adjust points.
// The Regulars terms (points and rewards) are set at the top. The email
// export only ever contains people who ticked the box and haven't opted out.
import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { api } from '../api/client'
import { Label, Hint } from '../components/Field'

interface Row { id: string; name: string; phone: string | null; email: string | null; visitCount: number; lifetimeCents: number; pointsBalance: number; lastVisitAt: string | null; createdAt: string; source: string; birthday: string | null }
interface Profile {
  id: string; name: string; phone: string | null; email: string | null; note: string | null; visitCount: number; lifetimeCents: number
  firstVisitAt: string | null; lastVisitAt: string | null; birthday: string | null; birthdaySoon: boolean; usual: Array<{ name: string; qty: number }>
  pointsBalance: number; rewardReady: boolean; emailOk: boolean; birthdayMonth: number | null; birthdayDay: number | null; source: string; createdAt: string
}
interface Detail { guest: Profile; visits: Array<{ id: string; number: number; label: string; kind: string; totalCents: number | null; closedAt: string; items: string[] }>; ledger: Array<{ id: string; points: number; reason: string; by: string | null; at: string }> }
interface Loyalty { enabled: boolean; pointsPerDollar: number; rewardPoints: number; rewardCents: number }

const money = (c: number) => '$' + (c / 100).toFixed(2)
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const SORTS = [['recent', 'In lately'], ['visits', 'Most visits'], ['spend', 'Spent most'], ['points', 'Most points']] as const

function LoyaltyCard() {
  const [l, setL] = useState<Loyalty | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { api.get<{ loyalty: Loyalty }>('/api/admin/loyalty').then((r) => setL(r.loyalty)).catch(() => {}) }, [])
  if (!l) return null
  const save = async () => {
    setMsg(null)
    try { const r = await api.put<{ loyalty: Loyalty }>('/api/admin/loyalty', l); setL(r.loyalty); setMsg({ ok: true, text: 'Saved. The website and the register use these now.' }) } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  return (
    <section className="card card-padding mb-6">
      <h2 className="text-lg text-ink mb-1">The Regulars terms</h2>
      <p className="text-muted text-sm mb-4">Points come from food and drink, not tax or tips. A reward takes a set amount off a check. Changes show on the sign-up page and at the register right away.</p>
      {msg && <div className={'text-sm rounded-lg px-3 py-2 mb-3 border ' + (msg.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200')} role="status">{msg.text}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={l.enabled} onChange={(e) => setL({ ...l, enabled: e.target.checked })} /> Program on</label>
        <div><Label htmlFor="ly-ppd">Points per dollar</Label><input id="ly-ppd" className="input" inputMode="numeric" value={l.pointsPerDollar} onChange={(e) => setL({ ...l, pointsPerDollar: Number(e.target.value.replace(/\D/g, '')) })} /></div>
        <div><Label htmlFor="ly-rp">Points for a reward</Label><input id="ly-rp" className="input" inputMode="numeric" value={l.rewardPoints} onChange={(e) => setL({ ...l, rewardPoints: Number(e.target.value.replace(/\D/g, '')) })} /></div>
        <div><Label htmlFor="ly-rv">Reward is worth ($)</Label><input id="ly-rv" className="input" inputMode="decimal" value={(l.rewardCents / 100).toFixed(2)} onChange={(e) => setL({ ...l, rewardCents: Math.round(Number(e.target.value.replace(/[^\d.]/g, '')) * 100) || 0 })} /></div>
      </div>
      <Hint>Right now: {l.enabled ? `${l.pointsPerDollar} point${l.pointsPerDollar === 1 ? '' : 's'} per dollar; ${l.rewardPoints} points is ${money(l.rewardCents)} off. That works out to about ${((l.rewardCents * l.pointsPerDollar) / l.rewardPoints).toFixed(1)}% back on food and drink.` : 'off.'}</Hint>
      <button type="button" className="btn-primary inline-flex items-center mt-3" onClick={save}>Save terms</button>
    </section>
  )
}

interface Birthday { enabled: boolean; daysBefore: number; subject: string; message: string }

function BirthdayCard() {
  const [b, setB] = useState<Birthday | null>(null)
  const [meta, setMeta] = useState<{ emailReady: boolean; withBirthdays: number } | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { api.get<{ birthday: Birthday; emailReady: boolean; withBirthdays: number }>('/api/admin/birthday').then((r) => { setB(r.birthday); setMeta({ emailReady: r.emailReady, withBirthdays: r.withBirthdays }) }).catch(() => {}) }, [])
  if (!b || !meta) return null
  const save = async (next: Birthday) => {
    setMsg(null)
    try { const r = await api.put<{ birthday: Birthday }>('/api/admin/birthday', next); setB(r.birthday); setMsg({ ok: true, text: r.birthday.enabled ? 'Saved. Birthday emails are on.' : 'Saved. Birthday emails are off.' }) } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  const test = async () => {
    setMsg(null)
    try { const r = await api.post<{ to: string }>('/api/admin/birthday/test', b); setMsg({ ok: true, text: `Test sent to ${r.to}.` }) } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  return (
    <section className="card card-padding mb-6">
      <h2 className="text-lg text-ink mb-1">Birthday email</h2>
      <p className="text-muted text-sm mb-4">
        Goes to Regulars who asked for email, {b.daysBefore} day{b.daysBefore === 1 ? '' : 's'} before their birthday, once a year, after 10 AM. {meta.withBirthdays} {meta.withBirthdays === 1 ? 'person has' : 'people have'} a birthday on file and email turned on.
        Every email has the bar's address and an unsubscribe link.
      </p>
      {!meta.emailReady && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">Email isn't set up on this site yet, so nothing will send until it is (Resend key on the Render service).</p>}
      {msg && <div className={'text-sm rounded-lg px-3 py-2 mb-3 border ' + (msg.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200')} role="status">{msg.text}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
        <div><Label htmlFor="bd-subj">Subject</Label><input id="bd-subj" className="input" value={b.subject} onChange={(e) => setB({ ...b, subject: e.target.value })} /></div>
        <div><Label htmlFor="bd-days">Days before</Label><input id="bd-days" className="input" inputMode="numeric" value={b.daysBefore} onChange={(e) => setB({ ...b, daysBefore: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></div>
        <div className="sm:col-span-2"><Label htmlFor="bd-msg">The message (what's the birthday offer?)</Label>
          <textarea id="bd-msg" className="input min-h-[120px]" placeholder="Come in this week and your burger is on the house. Show this email at the bar." value={b.message} onChange={(e) => setB({ ...b, message: e.target.value })} />
          <Hint>It starts with "Happy birthday, [first name]." Keep it short and plain. Whatever you offer here, the bar has to honor.</Hint>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className="btn-primary inline-flex items-center" onClick={() => save({ ...b, enabled: !b.enabled })} disabled={!b.enabled && !b.message.trim()}>{b.enabled ? 'Turn off' : 'Turn on'}</button>
        <button type="button" className="btn-secondary inline-flex items-center" onClick={() => save(b)}>Save</button>
        <button type="button" className="btn-secondary inline-flex items-center" onClick={test} disabled={!b.message.trim()}>Send me a test</button>
        <span className="text-sm self-center text-muted">Now: {b.enabled ? 'on' : 'off'}</span>
      </div>
    </section>
  )
}

function GuestPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [pts, setPts] = useState({ points: '', reason: '' })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const load = () => api.get<Detail>(`/api/admin/guests/${id}`).then((r) => {
    setD(r)
    setForm({ name: r.guest.name, phone: r.guest.phone || '', email: r.guest.email || '', birthdayMonth: r.guest.birthdayMonth ? String(r.guest.birthdayMonth) : '', birthdayDay: r.guest.birthdayDay ? String(r.guest.birthdayDay) : '', note: r.guest.note || '' })
  }).catch((e) => setMsg({ ok: false, text: e.message }))
  useEffect(() => { load() }, [id])
  if (!d) return <aside className="card card-padding">Loading…</aside>
  const g = d.guest
  const save = async () => {
    setMsg(null)
    try { await api.patch(`/api/admin/guests/${id}`, form); setMsg({ ok: true, text: 'Saved.' }); load(); onChanged() } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  const adjust = async () => {
    setMsg(null)
    try { await api.post(`/api/admin/guests/${id}/points`, { points: Number(pts.points), reason: pts.reason }); setPts({ points: '', reason: '' }); setMsg({ ok: true, text: 'Points adjusted.' }); load(); onChanged() } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  return (
    <aside className="card card-padding" aria-labelledby="gp-name">
      <div className="flex justify-between items-start gap-3 mb-3">
        <div>
          <h2 id="gp-name" className="text-xl text-ink">{g.name}</h2>
          <p className="text-sm text-muted">{g.visitCount} visit{g.visitCount === 1 ? '' : 's'} · {money(g.lifetimeCents)} spent · {g.pointsBalance} points{g.birthday ? ` · birthday ${g.birthday}` : ''}</p>
          <p className="text-xs text-muted">On the list since {date(g.createdAt)} ({g.source === 'website' ? 'signed up online' : 'added at the bar'}) · {g.emailOk ? 'gets emails' : 'no emails'}</p>
        </div>
        <button type="button" onClick={onClose} className="btn-secondary btn-sm inline-flex items-center gap-1" aria-label="Close"><X className="w-4 h-4" /></button>
      </div>
      {msg && <div className={'text-sm rounded-lg px-3 py-2 mb-3 border ' + (msg.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200')} role="status">{msg.text}</div>}
      {g.usual.length > 0 && <p className="text-sm text-ink mb-3"><strong>Usual:</strong> {g.usual.map((u) => `${u.name} (${u.qty})`).join(', ')}</p>}

      <h3 className="text-sm font-semibold text-ink mt-4 mb-2">Details</h3>
      <div className="grid grid-cols-2 gap-3">
        {[['name', 'Name'], ['phone', 'Phone'], ['email', 'Email']].map(([k, label]) => (
          <div key={k} className={k === 'email' ? 'col-span-2' : ''}><Label htmlFor={'g-' + k}>{label}</Label><input id={'g-' + k} className="input" value={form[k] || ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
        ))}
        <div><Label htmlFor="g-bm">Birthday month</Label><input id="g-bm" className="input" inputMode="numeric" placeholder="1–12" value={form.birthdayMonth || ''} onChange={(e) => setForm({ ...form, birthdayMonth: e.target.value })} /></div>
        <div><Label htmlFor="g-bd">Day</Label><input id="g-bd" className="input" inputMode="numeric" value={form.birthdayDay || ''} onChange={(e) => setForm({ ...form, birthdayDay: e.target.value })} /></div>
        <div className="col-span-2"><Label htmlFor="g-note">Note for the bar</Label><input id="g-note" className="input" value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
      </div>
      <button type="button" className="btn-primary inline-flex items-center mt-3" onClick={save}>Save details</button>

      <h3 className="text-sm font-semibold text-ink mt-6 mb-2">Adjust points</h3>
      <div className="grid grid-cols-[100px_1fr_auto] gap-2 items-end">
        <div><Label htmlFor="g-pts">Points</Label><input id="g-pts" className="input" inputMode="numeric" placeholder="25 or -25" value={pts.points} onChange={(e) => setPts({ ...pts, points: e.target.value })} /></div>
        <div><Label htmlFor="g-why">Why</Label><input id="g-why" className="input" placeholder="Made up for a long wait" value={pts.reason} onChange={(e) => setPts({ ...pts, reason: e.target.value })} /></div>
        <button type="button" className="btn-secondary" onClick={adjust} disabled={!pts.points || !pts.reason}>Apply</button>
      </div>

      <h3 className="text-sm font-semibold text-ink mt-6 mb-2">Recent visits</h3>
      {d.visits.length === 0 ? <p className="text-sm text-muted">No paid visits yet.</p> : (
        <ul className="divide-y divide-line text-sm">
          {d.visits.map((v) => (
            <li key={v.id} className="py-2"><div className="flex justify-between"><span>{date(v.closedAt)} · #{v.number} {v.label}</span><span className="tabular-nums">{money(v.totalCents || 0)}</span></div><div className="text-xs text-muted">{v.items.join(', ')}</div></li>
          ))}
        </ul>
      )}
      <h3 className="text-sm font-semibold text-ink mt-6 mb-2">Points history</h3>
      <ul className="text-sm divide-y divide-line">
        {d.ledger.map((l) => (<li key={l.id} className="py-1.5 flex justify-between"><span>{date(l.at)} · {l.reason === 'visit' ? 'Visit' : l.reason === 'redeem' ? 'Used a reward' : l.reason === 'unredeem' ? 'Reward taken back off' : 'Adjusted'}{l.by ? ` · ${l.by}` : ''}</span><span className={'tabular-nums ' + (l.points < 0 ? 'text-red-700' : 'text-emerald-700')}>{l.points > 0 ? '+' : ''}{l.points}</span></li>))}
        {d.ledger.length === 0 && <li className="py-1.5 text-muted">None yet.</li>}
      </ul>
    </aside>
  )
}

export function GuestsPage() {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<string>('recent')
  const [data, setData] = useState<{ total: number; emailable: number; guests: Row[] } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => api.get<{ total: number; emailable: number; guests: Row[] }>(`/api/admin/guests?sort=${sort}&q=${encodeURIComponent(q)}`).then(setData).catch((e) => setError(e.message))
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [q, sort])

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl text-ink">Guests</h1>
          <p className="text-muted text-sm mt-1">The Regulars{data ? `: ${data.total} on the list, ${data.emailable} who said yes to email` : ''}.</p>
        </div>
        <a className="btn-secondary inline-flex items-center gap-2" href="/api/admin/guests/emails.csv" download><Download className="w-4 h-4" />Email list (CSV)</a>
      </div>
      <LoyaltyCard />
      <BirthdayCard />
      {error && <p className="text-red-700 text-sm mb-3">{error}</p>}
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <label className="sr-only" htmlFor="g-search">Search guests</label>
        <input id="g-search" className="input max-w-xs" placeholder="Name, email or last 4 of the phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex gap-2" role="group" aria-label="Sort">
          {SORTS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)} className={'px-3 py-1.5 rounded-full text-sm border ' + (sort === k ? 'bg-ink text-white border-ink' : 'border-line text-ink-soft hover:bg-paper')}>{label}</button>
          ))}
        </div>
      </div>
      <div className={open ? 'grid lg:grid-cols-[1fr_420px] gap-4 items-start' : ''}>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted border-b border-line"><th className="p-3">Name</th><th className="p-3">Phone</th><th className="p-3 text-right">Visits</th><th className="p-3 text-right">Spent</th><th className="p-3 text-right">Points</th><th className="p-3">Last in</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data?.guests.map((g) => (
                <tr key={g.id} className={'hover:bg-paper cursor-pointer ' + (open === g.id ? 'bg-paper' : '')} onClick={() => setOpen(g.id)}>
                  <td className="p-3"><button type="button" className="text-ink underline-offset-2 hover:underline text-left" onClick={(e) => { e.stopPropagation(); setOpen(g.id) }}>{g.name}</button>{g.birthday && <span className="ml-2 text-xs text-muted">b. {g.birthday}</span>}</td>
                  <td className="p-3 tabular-nums text-muted">{g.phone ? '…' + g.phone.slice(-4) : '—'}</td>
                  <td className="p-3 text-right tabular-nums">{g.visitCount}</td>
                  <td className="p-3 text-right tabular-nums">{money(g.lifetimeCents)}</td>
                  <td className="p-3 text-right tabular-nums">{g.pointsBalance}</td>
                  <td className="p-3 text-muted">{date(g.lastVisitAt)}</td>
                </tr>
              ))}
              {data && data.guests.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">{q ? 'Nobody matches that.' : 'Nobody on the list yet. Guests get added at the register or sign up at /regulars.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {open && <GuestPanel id={open} onClose={() => setOpen(null)} onChanged={load} />}
      </div>
    </div>
  )
}
