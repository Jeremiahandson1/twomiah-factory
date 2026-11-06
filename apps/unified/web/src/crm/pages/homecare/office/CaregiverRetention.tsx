// Caregiver satisfaction & retention (parity row 13, care_caregiver_surveys): the surveys the agency asks caregivers on the phone,
// their results by branch / manager / caregiver with a trend, who has not answered, and the retention risk of every caregiver with
// its reasons and its trend. server/crm/homecare/hr/caregiverSurveys.ts (/api/caregiver-surveys).
import { useCallback, useEffect, useState } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, errorMessage, rows } from '../lib/http'
import { agencyToday, formatAgencyDate, formatAgencyDateTime } from '../lib/agencyClock'
import { useMay } from '../lib/useMay'
import { LineChart, BarChart } from '../lib/Chart'

type Tab = 'dashboard' | 'risk' | 'results' | 'surveys'
interface Question { id: string; text: string; kind: 'scale' | 'yes_no' | 'text' }
interface Survey { id: string; name: string; trigger: string; days: number | null; questions: Question[]; alertBelow: number; isActive: boolean; triggerLabel: string }
interface Risk { caregiverId: string; name: string; hired: string; branchName: string | null; team: string | null; managerName: string | null; score: number; band: 'low' | 'watch' | 'high'; bandLabel: string; reasons: { signal: string; label: string; points: number; detail: string }[] }

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const TH = 'px-3 py-2 text-left'
const card = 'rounded-lg border p-3 border-gray-200 dark:border-slate-700'
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`)
const score = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)} / 5`)
const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const bandClass = (b: string) => (b === 'high' ? 'text-red-700 dark:text-red-300 font-semibold' : b === 'watch' ? 'text-amber-800 dark:text-amber-300 font-semibold' : '')
const Stat = ({ label, value }: { label: string; value: string }) => <div className={card}><div className="text-xs text-gray-600 dark:text-slate-400">{label}</div><div className="text-lg font-semibold">{value}</div></div>
const Empty = ({ text }: { text: string }) => <div className="rounded-lg p-6 text-center text-sm bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-400">{text}</div>

export default function CaregiverRetention() {
  const hr = useMay('care-hr')
  const [tab, setTab] = useState<Tab>('dashboard')
  if (!hr.read) return <div className="p-4 text-sm text-gray-600 dark:text-slate-400">You do not have access to this page.</div>
  const tabs: [Tab, string][] = [['dashboard', 'Retention dashboard'], ['risk', 'At-risk caregivers'], ['results', 'Survey results'], ['surveys', 'Surveys']]
  return (
    <div className="p-4 max-w-6xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Caregiver satisfaction &amp; retention</h1>
      <p className="text-sm mb-3 text-gray-600 dark:text-slate-400">Ask caregivers how it is going at the points you set, see the answers by branch, manager and caregiver, and know who may be about to leave — and why.</p>
      <div className="flex flex-wrap gap-2 mb-4">{tabs.map(([id, label]) => <button key={id} type="button" className={`hc-btn hc-btn-sm ${tab === id ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setTab(id)}>{label}</button>)}</div>
      {tab === 'dashboard' && <Dashboard />}
      {tab === 'risk' && <RiskList />}
      {tab === 'results' && <Results />}
      {tab === 'surveys' && <Surveys canWrite={hr.update} />}
    </div>
  )
}

function Dashboard() {
  const toast = useToast()
  const [days, setDays] = useState(180)
  const [d, setD] = useState<any>(null)
  useEffect(() => { api.get(`/api/caregiver-surveys/dashboard?days=${days}`).then(setD).catch((e) => { toast.error(errorMessage(e, 'Could not load the dashboard')); setD(null) }) }, [days, toast])
  if (!d) return <div className="text-sm text-gray-600 dark:text-slate-400">Loading…</div>
  const s = d.satisfaction.summary
  return (
    <>
      <div className="flex justify-end mb-3"><label className="text-sm">Window<br /><select className={inp} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[30, 90, 180, 365].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select></label></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Satisfaction" value={score(s.averageScore)} /><Stat label="Surveys answered" value={`${s.answered} of ${s.sent} (${pct(s.responseRatePercent)})`} /><Stat label="Low scores" value={String(s.low)} />
        <Stat label="At risk" value={`${d.risk.atRisk} of ${d.risk.caregivers}${d.risk.watch ? ` · ${d.risk.watch} to watch` : ''}`} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <LineChart title="Satisfaction trend (average score by month)" labels={d.satisfaction.trend.map((p: any) => p.month)} series={[{ name: 'Average score', values: d.satisfaction.trend.map((p: any) => p.averageScore) }]} format={(v) => v.toFixed(1)} emptyText="No surveys answered yet." />
        <LineChart title="Retention risk trend (caregivers at risk, by day)" labels={d.risk.trend.map((p: any) => p.asOf)} series={[{ name: 'At risk', values: d.risk.trend.map((p: any) => p.atRisk) }, { name: 'To watch', values: d.risk.trend.map((p: any) => p.watch) }]} emptyText="The risk is snapshotted once a day; the trend fills in from tomorrow." />
        <BarChart title="Satisfaction by branch" rows={d.satisfaction.byBranch.map((g: any) => ({ label: g.name, value: g.averageScore, detail: `${g.answered} answered` }))} format={(v) => v.toFixed(1)} max={5} emptyText="No answers by branch yet." />
        <BarChart title="Satisfaction by manager" rows={d.satisfaction.byManager.map((g: any) => ({ label: g.name, value: g.averageScore, detail: `${g.answered} answered` }))} format={(v) => v.toFixed(1)} max={5} emptyText="No answers by manager yet." />
      </div>
      {d.risk.list.length > 0 && <><h3 className="font-semibold mb-1">Caregivers to look after</h3><RiskTable list={d.risk.list} /></>}
    </>
  )
}

function RiskTable({ list }: { list: Risk[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const [trend, setTrend] = useState<Record<string, any[]>>({})
  const toggle = async (id: string) => {
    if (open === id) { setOpen(null); return }
    setOpen(id)
    if (!trend[id]) { try { setTrend({ ...trend, [id]: rows(await api.get(`/api/caregiver-surveys/risk/${id}/trend?days=90`)) }) } catch { setTrend({ ...trend, [id]: [] }) } }
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
      <table className="w-full text-sm"><thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>Caregiver</th><th className={TH}>Branch / team / manager</th><th className={TH}>Score</th><th className={TH}>Band</th><th className={TH}>Why</th><th className={TH}></th></tr></thead>
        <tbody>{list.map((r) => (
          <>
            <tr key={r.caregiverId} className="border-t border-gray-100 dark:border-slate-700 align-top">
              <td className="px-3 py-2 font-semibold">{r.name}<div className="text-xs font-normal text-gray-600 dark:text-slate-400">Hired {formatAgencyDate(r.hired)}</div></td>
              <td className="px-3 py-2">{[r.branchName, r.team, r.managerName].filter(Boolean).join(' / ') || '—'}</td>
              <td className="px-3 py-2">{r.score}</td><td className={`px-3 py-2 ${bandClass(r.band)}`}>{r.bandLabel}</td>
              <td className="px-3 py-2">{r.reasons.length === 0 ? <span className="text-gray-600 dark:text-slate-400">Nothing of note</span> : <ul className="list-disc ml-4">{r.reasons.map((x) => <li key={x.signal + x.detail}><b>{x.label}</b> (+{x.points}): {x.detail}</li>)}</ul>}</td>
              <td className="px-3 py-2"><button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => toggle(r.caregiverId)}>{open === r.caregiverId ? 'Hide trend' : 'Trend'}</button></td>
            </tr>
            {open === r.caregiverId && <tr key={`${r.caregiverId}-t`}><td colSpan={6} className="px-3 pb-3"><LineChart title={`${r.name}: risk score by day (last 90 days)`} labels={(trend[r.caregiverId] ?? []).map((p: any) => p.asOf)} series={[{ name: 'Score', values: (trend[r.caregiverId] ?? []).map((p: any) => p.score) }]} height={160} emptyText="No snapshots yet — the risk is written once a day." /></td></tr>}
          </>
        ))}</tbody></table>
    </div>
  )
}

function RiskList() {
  const toast = useToast()
  const [list, setList] = useState<Risk[] | null>(null)
  const [band, setBand] = useState<'all' | 'high' | 'watch' | 'low'>('all')
  useEffect(() => { api.get('/api/caregiver-surveys/risk').then((r) => setList(rows<Risk>(r))).catch((e) => { toast.error(errorMessage(e, 'Could not load the list')); setList([]) }) }, [toast])
  if (!list) return <div className="text-sm text-gray-600 dark:text-slate-400">Loading…</div>
  const shown = list.filter((r) => band === 'all' || r.band === band)
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(['all', 'high', 'watch', 'low'] as const).map((b) => <button key={b} type="button" className={`hc-btn hc-btn-sm ${band === b ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setBand(b)}>{b === 'all' ? `Everyone (${list.length})` : b === 'high' ? `At risk (${list.filter((r) => r.band === 'high').length})` : b === 'watch' ? `Watch (${list.filter((r) => r.band === 'watch').length})` : `Low risk (${list.filter((r) => r.band === 'low').length})`}</button>)}
      </div>
      {shown.length === 0 ? <Empty text="Nobody in this band." /> : <RiskTable list={shown} />}
      <p className="text-xs mt-2 text-gray-600 dark:text-slate-400">The score adds up our own signals: hours dropping (the last 4 weeks against the 8 before), call-outs and missed visits in the last 60 days, the latest survey score or a survey left unanswered, the first 90 days, going quiet, and working under half the hours asked for. 50 and over is at risk, 25 to 49 is worth a word.</p>
    </>
  )
}

function Results() {
  const toast = useToast()
  const [end, setEnd] = useState(agencyToday())
  const [start, setStart] = useState(shift(agencyToday(), -89))
  const [by, setBy] = useState<'byBranch' | 'byManager' | 'byCaregiver'>('byCaregiver')
  const [r, setR] = useState<any>(null)
  const [outstanding, setOutstanding] = useState<any[]>([])
  useEffect(() => {
    api.get(`/api/caregiver-surveys/results?startDate=${start}&endDate=${end}`).then(setR).catch((e) => { toast.error(errorMessage(e, 'Could not load the results')); setR(null) })
    api.get('/api/caregiver-surveys/outstanding').then((x) => setOutstanding(rows(x))).catch(() => setOutstanding([]))
  }, [start, end, toast])
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="text-sm">From<br /><input type="date" className={inp} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="text-sm">To<br /><input type="date" className={inp} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label className="text-sm">By<br /><select className={inp} value={by} onChange={(e) => setBy(e.target.value as any)}><option value="byCaregiver">Caregiver</option><option value="byManager">Manager</option><option value="byBranch">Branch</option></select></label>
      </div>
      {!r ? <div className="text-sm text-gray-600 dark:text-slate-400">Loading…</div> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"><Stat label="Average score" value={score(r.summary.averageScore)} /><Stat label="Answered" value={`${r.summary.answered} of ${r.summary.sent}`} /><Stat label="Response rate" value={pct(r.summary.responseRatePercent)} /><Stat label="Low scores" value={String(r.summary.low)} /></div>
          {r[by].length === 0 ? <Empty text="No surveys answered in these dates." /> : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700 mb-4"><table className="w-full text-sm"><thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>{by === 'byBranch' ? 'Branch' : by === 'byManager' ? 'Manager' : 'Caregiver'}</th><th className={TH}>Answered</th><th className={TH}>Average score</th><th className={TH}>Low scores</th></tr></thead>
              <tbody>{r[by].map((g: any) => <tr key={g.id ?? 'none'} className="border-t border-gray-100 dark:border-slate-700"><td className="px-3 py-1 font-semibold">{g.name}</td><td className="px-3">{g.answered}</td><td className={`px-3 ${g.averageScore !== null && g.averageScore < 3 ? 'text-red-700 dark:text-red-300 font-semibold' : ''}`}>{score(g.averageScore)}</td><td className="px-3">{g.low}</td></tr>)}</tbody></table></div>
          )}
          {r.answers.length > 0 && (
            <>
              <h3 className="font-semibold mb-1">Every answer</h3>
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700 mb-4"><table className="w-full text-sm"><thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>When</th><th className={TH}>Caregiver</th><th className={TH}>Survey</th><th className={TH}>Why asked</th><th className={TH}>Score</th><th className={TH}>In their words</th></tr></thead>
                <tbody>{r.answers.map((a: any) => <tr key={a.id} className="border-t border-gray-100 dark:border-slate-700"><td className="px-3 py-1">{formatAgencyDate(a.answeredOn)}</td><td className="px-3 font-semibold">{a.name}</td><td className="px-3">{a.surveyName}</td><td className="px-3">{a.reason}</td><td className={`px-3 ${a.alerted ? 'text-red-700 dark:text-red-300 font-semibold' : ''}`}>{score(a.score)}{a.alerted ? ' · office alerted' : ''}</td><td className="px-3">{a.comment ?? '—'}</td></tr>)}</tbody></table></div>
            </>
          )}
        </>
      )}
      <h3 className="font-semibold mb-1">Not answered yet</h3>
      {outstanding.length === 0 ? <p className="text-sm text-gray-600 dark:text-slate-400">Everyone asked has answered.</p> : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700"><table className="w-full text-sm"><thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>Caregiver</th><th className={TH}>Survey</th><th className={TH}>Why asked</th><th className={TH}>Asked</th><th className={TH}>Push</th></tr></thead>
          <tbody>{outstanding.map((o) => <tr key={o.id} className="border-t border-gray-100 dark:border-slate-700"><td className="px-3 py-1 font-semibold">{o.name}</td><td className="px-3">{o.surveyName}</td><td className="px-3">{o.reason}</td><td className="px-3">{o.sentAt ? formatAgencyDateTime(o.sentAt) : '—'}</td><td className="px-3">{o.pushed ? 'Sent to their phone' : 'In the app only (no phone or pushes off)'}</td></tr>)}</tbody></table></div>
      )}
    </>
  )
}

const BLANK: Omit<Survey, 'id' | 'triggerLabel'> = { name: '', trigger: 'days_after_hire', days: 90, questions: [], alertBelow: 3, isActive: true }
function Surveys({ canWrite }: { canWrite: boolean }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [list, setList] = useState<Survey[]>([])
  const [options, setOptions] = useState<any>(null)
  const [form, setForm] = useState<any>(null)
  const [asking, setAsking] = useState<{ survey: Survey; ids: string[] } | null>(null)
  const [caregivers, setCaregivers] = useState<{ id: string; name: string }[]>([])
  const load = useCallback(async () => {
    try { setList(rows<Survey>(await api.get('/api/caregiver-surveys/surveys'))); if (!options) setOptions(await api.get('/api/caregiver-surveys/options')) } catch (e) { toast.error(errorMessage(e, 'Could not load the surveys')) }
  }, [toast, options])
  useEffect(() => { load() }, [load])
  const save = async () => {
    try {
      if (form.id) await api.put(`/api/caregiver-surveys/surveys/${form.id}`, form); else await api.post('/api/caregiver-surveys/surveys', form)
      toast.success('Survey saved'); setForm(null); load()
    } catch (e) { toast.error(errorMessage(e, 'Could not save the survey')) }
  }
  const remove = async (s: Survey) => {
    if (!(await confirm(`Delete the survey "${s.name}"? Its answers go with it.`, { title: 'Delete survey', confirmText: 'Delete', danger: true }))) return
    try { await api.delete(`/api/caregiver-surveys/surveys/${s.id}`); load() } catch (e) { toast.error(errorMessage(e, 'Could not delete it')) }
  }
  const openAsk = async (s: Survey) => {
    try { setCaregivers(rows<any>(await api.get('/api/users/caregivers', { isActive: 'true' })).map((u) => ({ id: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() }))) } catch { setCaregivers([]) }
    setAsking({ survey: s, ids: [] })
  }
  const ask = async () => {
    if (!asking) return
    try { const r: any = await api.post(`/api/caregiver-surveys/surveys/${asking.survey.id}/ask`, { caregiverIds: asking.ids }); toast.success(r.message); setAsking(null) } catch (e) { toast.error(errorMessage(e, 'Could not ask')) }
  }
  const setQ = (i: number, patch: Partial<Question>) => setForm({ ...form, questions: form.questions.map((q: Question, j: number) => (j === i ? { ...q, ...patch } : q)) })
  return (
    <>
      {canWrite && <div className="flex gap-2 mb-3"><button type="button" className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => setForm({ ...BLANK, name: 'How is it going?', questions: options?.standardQuestions ?? [] })}>+ New survey (standard questions)</button><button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setForm({ ...BLANK })}>+ New blank survey</button></div>}
      {form && (
        <div className={`${card} mb-4`}>
          <div className="grid md:grid-cols-4 gap-3 mb-2">
            <label className="text-sm">Name<br /><input className={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="text-sm">Asked<br /><select className={inp} value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>{(options?.triggers ?? []).map((t: any) => <option key={t.trigger} value={t.trigger}>{t.label}</option>)}</select></label>
            {form.trigger !== 'first_visit_with_client' && <label className="text-sm">Days<br /><input type="number" min={1} max={730} className={inp} value={form.days ?? 90} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })} /></label>}
            <label className="text-sm">Alert the office under<br /><select className={inp} value={form.alertBelow} onChange={(e) => setForm({ ...form, alertBelow: Number(e.target.value) })}>{[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} of 5</option>)}</select></label>
          </div>
          <div className="text-sm font-semibold mb-1">Questions</div>
          {form.questions.map((q: Question, i: number) => (
            <div key={i} className="flex flex-wrap items-end gap-2 mb-2">
              <input className={`${inp} flex-1 min-w-[240px]`} value={q.text} placeholder="The question" onChange={(e) => setQ(i, { text: e.target.value })} />
              <select className={inp} value={q.kind} onChange={(e) => setQ(i, { kind: e.target.value as Question['kind'] })}>{(options?.questionKinds ?? []).map((k: any) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select>
              <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setForm({ ...form, questions: form.questions.filter((_: Question, j: number) => j !== i) })}>Remove</button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setForm({ ...form, questions: [...form.questions, { id: `q${form.questions.length + 1}`, text: '', kind: 'scale' }] })}>+ Add question</button>
            <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />Active</label>
            <button type="button" className="hc-btn hc-btn-sm hc-btn-primary" onClick={save}>Save</button>
            <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}
      {asking && (
        <div className={`${card} mb-4`}>
          <div className="font-semibold mb-1">Ask "{asking.survey.name}" now</div>
          <div className="flex flex-wrap gap-3 text-sm mb-2">{caregivers.map((c) => <label key={c.id} className="flex items-center gap-1"><input type="checkbox" checked={asking.ids.includes(c.id)} onChange={(e) => setAsking({ ...asking, ids: e.target.checked ? [...asking.ids, c.id] : asking.ids.filter((x) => x !== c.id) })} />{c.name}</label>)}</div>
          <div className="flex gap-2"><button type="button" className="hc-btn hc-btn-sm hc-btn-primary" onClick={ask}>Send to their phones</button><button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setAsking(null)}>Cancel</button></div>
        </div>
      )}
      {list.length === 0 ? <Empty text="No surveys yet. Start from the standard questions." /> : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700"><table className="w-full text-sm"><thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>Survey</th><th className={TH}>Asked</th><th className={TH}>Questions</th><th className={TH}>Alert under</th><th className={TH}>Active</th><th className={TH}></th></tr></thead>
          <tbody>{list.map((s) => <tr key={s.id} className="border-t border-gray-100 dark:border-slate-700"><td className="px-3 py-1 font-semibold">{s.name}</td><td className="px-3">{s.triggerLabel}</td><td className="px-3">{s.questions.length}</td><td className="px-3">{s.alertBelow} of 5</td><td className="px-3">{s.isActive ? 'Yes' : 'No'}</td>
            <td className="px-3 whitespace-nowrap">{canWrite && <><button type="button" className="hc-btn hc-btn-sm hc-btn-secondary mr-1" onClick={() => setForm({ ...s })}>Edit</button><button type="button" className="hc-btn hc-btn-sm hc-btn-secondary mr-1" onClick={() => openAsk(s)}>Ask now</button><button type="button" className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => remove(s)}>Delete</button></>}</td></tr>)}</tbody></table></div>
      )}
      <p className="text-xs mt-2 text-gray-600 dark:text-slate-400">A survey reaches the caregiver as a push to their phone (their own notification settings apply) and a notice in the app; they answer under More › How is it going?. Each point is asked once.</p>
    </>
  )
}
