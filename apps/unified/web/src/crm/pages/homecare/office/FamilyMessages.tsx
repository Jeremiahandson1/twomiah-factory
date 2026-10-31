// What relatives ask the office, and what the agency says to them (care_family_comms, not ready until the owner has tried it):
//   Requests        a relative's visit change / service change / new visit — an "Open requests" tile, and Done / Declined with a note the relative sees
//   Texts & emails  every arrival and finish notice sent or held back, and why (GET /api/family-comms/texts)
//   Wording         the arrival and finish text in the agency's own words, with {caregiver} {client} {time} {agency}
//   Emails          the four portal emails (account created, forgot password, access granted, access revoked) in the agency's words
// Server: server/crm/homecare/portals/familyComms.ts on /api/family-comms (care-portal:update).
import { useCallback, useEffect, useState } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, rows, errorMessage } from '../lib/http'
import { formatAgencyDateTime, agencyToday } from '../lib/agencyClock'

const inp = 'w-full rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const card = 'rounded-lg border p-4 mb-3 border-gray-200 bg-white text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
const soft = 'text-sm text-gray-600 dark:text-slate-400'

interface Req { id: string; kind: string; kindLabel: string; visitDate: string | null; details: string; status: string; statusLabel: string; handledNote: string | null; createdAt: string; relativeName: string; relationship: string | null; clientFirst: string; clientLast: string }
interface Msg { id: string; event: string; eventLabel: string; status: string; statusLabel: string; channelLabel: string; reason: string | null; createdAt: string; relativeName: string; clientFirst: string; clientLast: string; caregiverFirst: string; caregiverLast: string }
interface Wording { arrivalText: string; departureText: string; tags: string[]; defaults: { arrivalText: string; departureText: string } }
interface Tpl { kind: string; label: string; tags: string[]; switchable: boolean; enabled: boolean; subject: string; body: string; custom: boolean }
type Tab = 'requests' | 'texts' | 'wording' | 'emails'

function Requests() {
  const toast = useToast()
  const confirm = useConfirm()
  const [status, setStatus] = useState('open')
  const [list, setList] = useState<Req[]>([])
  const [open, setOpen] = useState(0)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    try {
      setList(rows<Req>(await api.get('/api/family-comms/requests', status ? { status } : {})))
      setOpen(((await api.get('/api/family-comms/summary')) as any).openRequests ?? 0)
    } catch (e) { toast.error(errorMessage(e, 'Could not load requests')) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])
  useEffect(() => { load() }, [load])
  const handle = async (r: Req, s: 'done' | 'declined') => {
    if (s === 'declined' && !(await confirm(`Decline this request from ${r.relativeName}?`, { confirmText: 'Decline', danger: true }))) return
    try { await api.put(`/api/family-comms/requests/${r.id}`, { status: s, note: notes[r.id] || '' }); toast.success(s === 'done' ? 'Marked done' : 'Declined'); load() } catch (e) { toast.error(errorMessage(e)) }
  }
  return (
    <div>
      <div className={card} style={{ display: 'inline-block', minWidth: 180 }}>
        <div className={soft}>Open requests</div>
        <div style={{ fontSize: '2rem', fontWeight: 800 }}>{open}</div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <select className={inp} style={{ width: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Show">
          <option value="open">Open</option><option value="done">Done</option><option value="declined">Declined</option><option value="">All</option>
        </select>
      </div>
      {list.length === 0 ? <div className={card}>No requests here.</div> : list.map((r) => (
        <div key={r.id} className={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <strong>{r.kindLabel} — {r.clientFirst} {r.clientLast}</strong>
            <span className={soft}>{formatAgencyDateTime(r.createdAt)} · {r.statusLabel}</span>
          </div>
          <div className={soft}>{r.relativeName}{r.relationship ? ` (${r.relationship})` : ''}{r.visitDate ? ` · about ${r.visitDate}` : ''}</div>
          <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0' }}>{r.details}</p>
          {r.status === 'open' ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input className={inp} style={{ flex: 1, minWidth: 200 }} placeholder="A note for the relative (optional)" value={notes[r.id] || ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
              <button className="hc-btn hc-btn-primary" onClick={() => handle(r, 'done')}>Done</button>
              <button className="hc-btn hc-btn-secondary" onClick={() => handle(r, 'declined')}>Decline</button>
            </div>
          ) : r.handledNote ? <div className={soft}>Your note: {r.handledNote}</div> : null}
        </div>
      ))}
    </div>
  )
}

function Texts() {
  const toast = useToast()
  const [from, setFrom] = useState(() => { const d = new Date(agencyToday() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 13); return d.toISOString().slice(0, 10) })
  const [to, setTo] = useState(agencyToday())
  const [status, setStatus] = useState('')
  const [list, setList] = useState<Msg[]>([])
  useEffect(() => {
    api.get('/api/family-comms/texts', { from, to, ...(status ? { status } : {}) }).then((r) => setList(rows<Msg>(r))).catch((e) => { setList([]); toast.error(errorMessage(e, 'Could not load')) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, status])
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input className={inp} style={{ width: 160 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input className={inp} style={{ width: 160 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select className={inp} style={{ width: 220 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Sent and held</option><option value="sent">Sent</option><option value="failed">Not sent</option>
          <option value="skipped_quiet">Held (quiet hours)</option><option value="skipped_late">Held (too late to be news)</option>
        </select>
      </div>
      {list.length === 0 ? <div className={card}>Nothing in these dates.</div> : (
        <table className="hc-table" style={{ width: '100%' }}>
          <thead><tr><th>When</th><th>Relative</th><th>Client</th><th>Caregiver</th><th>What</th><th>How</th><th>Result</th></tr></thead>
          <tbody>{list.map((m) => (
            <tr key={m.id}>
              <td>{formatAgencyDateTime(m.createdAt)}</td><td>{m.relativeName}</td><td>{m.clientFirst} {m.clientLast}</td><td>{m.caregiverFirst} {m.caregiverLast}</td>
              <td>{m.eventLabel}</td><td>{m.channelLabel}</td>
              <td><strong>{m.statusLabel}</strong>{m.reason ? <div className={soft}>{m.reason}</div> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}

function WordingTab() {
  const toast = useToast()
  const [w, setW] = useState<Wording | null>(null)
  const [problem, setProblem] = useState<Record<string, string>>({})
  useEffect(() => { api.get('/api/family-comms/text-wording').then((r) => setW(r as Wording)).catch((e) => toast.error(errorMessage(e))) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])
  if (!w) return <div className={card}>Loading…</div>
  const save = async () => {
    try { setW({ ...(await api.put('/api/family-comms/text-wording', { arrivalText: w.arrivalText, departureText: w.departureText }) as Wording), defaults: w.defaults }); setProblem({}); toast.success('Saved') } catch (e) {
      const f = (e as any)?.data?.fields; setProblem(f || {}); toast.error(errorMessage(e))
    }
  }
  const field = (k: 'arrivalText' | 'departureText', label: string) => (
    <div style={{ marginBottom: 12 }}>
      <label className="block text-sm font-semibold mb-1" htmlFor={k}>{label}</label>
      <textarea id={k} className={inp} rows={2} maxLength={300} value={w[k]} onChange={(e) => setW({ ...w, [k]: e.target.value })} />
      {problem[k] ? <div style={{ color: 'var(--hc-danger-ink, #b91c1c)' }} className="text-sm">{problem[k]}</div> : null}
    </div>
  )
  return (
    <div className={card}>
      <p className={soft}>You can use {w.tags.map((t) => `{${t}}`).join(', ')}. If you leave out {'{agency}'} the agency name is put in front. &ldquo;Reply STOP to stop these texts.&rdquo; is added unless your words already say STOP.</p>
      {field('arrivalText', 'When the caregiver arrives')}
      {field('departureText', 'When the caregiver finishes')}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="hc-btn hc-btn-primary" onClick={save}>Save</button>
        <button className="hc-btn hc-btn-secondary" onClick={() => setW({ ...w, ...w.defaults })}>Use our wording</button>
      </div>
    </div>
  )
}

function EmailsTab() {
  const toast = useToast()
  const [list, setList] = useState<Tpl[]>([])
  const [problem, setProblem] = useState<Record<string, Record<string, string>>>({})
  const load = useCallback(() => api.get('/api/family-comms/email-templates').then((r) => setList(rows<Tpl>(r))).catch((e) => toast.error(errorMessage(e))), [toast])
  useEffect(() => { load() }, [load])
  const edit = (kind: string, patch: Partial<Tpl>) => setList((cur) => cur.map((t) => (t.kind === kind ? { ...t, ...patch } : t)))
  const save = async (t: Tpl) => {
    try { await api.put(`/api/family-comms/email-templates/${t.kind}`, { subject: t.subject, body: t.body, ...(t.switchable ? { enabled: t.enabled } : {}) }); setProblem({ ...problem, [t.kind]: {} }); toast.success('Saved'); load() } catch (e) {
      setProblem({ ...problem, [t.kind]: (e as any)?.data?.fields || {} }); toast.error(errorMessage(e))
    }
  }
  const reset = async (t: Tpl) => { try { await api.delete(`/api/family-comms/email-templates/${t.kind}`); toast.success('Back to our wording'); load() } catch (e) { toast.error(errorMessage(e)) } }
  return (
    <div>
      {list.map((t) => (
        <div key={t.kind} className={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong>{t.label}{t.custom ? ' (your wording)' : ''}</strong>
            {t.switchable ? <label className="text-sm"><input type="checkbox" checked={t.enabled} onChange={(e) => edit(t.kind, { enabled: e.target.checked })} /> Send this email</label> : <span className={soft}>Always sent</span>}
          </div>
          <p className={soft}>You can use {t.tags.map((x) => `{${x}}`).join(', ')}.</p>
          <label className="block text-sm font-semibold mb-1" htmlFor={`s-${t.kind}`}>Subject</label>
          <input id={`s-${t.kind}`} className={inp} value={t.subject} onChange={(e) => edit(t.kind, { subject: e.target.value })} />
          {problem[t.kind]?.subject ? <div className="text-sm" style={{ color: 'var(--hc-danger-ink, #b91c1c)' }}>{problem[t.kind].subject}</div> : null}
          <label className="block text-sm font-semibold mb-1 mt-2" htmlFor={`b-${t.kind}`}>Words</label>
          <textarea id={`b-${t.kind}`} className={inp} rows={7} value={t.body} onChange={(e) => edit(t.kind, { body: e.target.value })} />
          {problem[t.kind]?.body ? <div className="text-sm" style={{ color: 'var(--hc-danger-ink, #b91c1c)' }}>{problem[t.kind].body}</div> : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="hc-btn hc-btn-primary" onClick={() => save(t)}>Save</button>
            {t.custom ? <button className="hc-btn hc-btn-secondary" onClick={() => reset(t)}>Use our wording</button> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function FamilyMessages() {
  const [tab, setTab] = useState<Tab>('requests')
  const tabs: Array<[Tab, string]> = [['requests', 'Requests'], ['texts', 'Texts & emails sent'], ['wording', 'Text wording'], ['emails', 'Portal emails']]
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Family messages</h2>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }} role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`hc-btn ${tab === k ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'requests' ? <Requests /> : tab === 'texts' ? <Texts /> : tab === 'wording' ? <WordingTab /> : <EmailsTab />}
    </div>
  )
}
