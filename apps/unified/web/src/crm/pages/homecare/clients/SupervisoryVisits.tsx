// Supervisory visits (item 11 + row 24, care_supervisory_visits): a check-in on each client's care on a regular cycle. The
// agency picks the rule here; the list shows who is overdue, who is due soon and who is fine, and where their days come from
// (their own, a service code's, or the agency's). The office PLANS a visit for a named supervisor (it goes on the schedule
// calendar and on that person's phone), moves, hands over or cancels it, or finishes it here; it can also record a visit that
// was not planned. The agency's own questions and whether both signatures are required are set under "Form settings".
//   GET /api/supervisory-visits → { ruleDays, today, clients: [{ clientId, firstName, lastName, intervalDays, intervalSource,
//        ownInterval, lastVisit, dueDate, status, daysOverdue, daysUntilDue, plannedId, plannedDate, plannedTime, plannedSupervisorName }] }
//   PUT /rule { days }   GET|PUT /settings { questions, requireSignatures }   PUT /client/:id/interval { days|null }
//   GET|POST /client/:id   POST /client/:id/plan   PUT /visits/:id   POST /visits/:id/cancel   POST /visits/:id/complete
//   GET /visits/:id/signatures                       (server/crm/homecare/clients/supervisoryVisits.ts)
import { useCallback, useEffect, useState } from 'react'
import { useConfirm, usePrompt, useToast } from '../../../../shared'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { formatAgencyDate } from '../lib/agencyClock'
import { useMay } from '../lib/useMay'
import SignaturePad from '../lib/SignaturePad'

interface Row {
  clientId: string; firstName: string; lastName: string; intervalDays: number; ownInterval: boolean; intervalSource: 'client' | 'service_code' | 'agency'
  lastVisit: string | null; dueDate: string; status: 'overdue' | 'due_soon' | 'ok'; daysOverdue: number; daysUntilDue: number
  plannedId: string | null; plannedDate: string | null; plannedTime: string | null; plannedHm: string | null; plannedSupervisorName: string | null
}
interface Reply { ruleDays: number; today: string; clients: Row[] }
interface Answer { id: string; label: string; kind: string; answer: string | boolean | null }
interface Visit {
  id: string; visitDate: string; visitType: string; clientFeedback: string | null; carePlanFollowed: boolean | null
  caregiverFeedback: string | null; concerns: string | null; followUpNotes: string | null; supervisorName?: string; caregiverName?: string
  answers?: Answer[]; supervisorSigned?: boolean; clientSigned?: boolean; clientSignReason?: string | null; recordedFrom?: string
}
interface Question { id: string; label: string; kind: 'yes_no' | 'text'; required: boolean }
interface Settings { questions: Question[]; requireSignatures: boolean }
interface Person { id: string; firstName: string | null; lastName: string | null }

const BADGE: Record<Row['status'], { label: string; cls: string }> = {
  overdue: { label: 'Overdue', cls: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200' },
  due_soon: { label: 'Due soon', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  ok: { label: 'On track', cls: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' },
}
const SOURCE: Record<Row['intervalSource'], string> = { client: ' (theirs)', service_code: ' (service code)', agency: '' }
const inp = 'w-full rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const muted = 'text-xs text-gray-600 dark:text-slate-400'
const blank = {
  visitDate: '', visitType: 'home', caregiverId: '', clientFeedback: '', carePlanFollowed: '', caregiverFeedback: '', concerns: '', followUpNotes: '',
  answers: {} as Record<string, string>, supervisorSignature: '', clientSignature: '', clientSignReason: '',
}
const blankPlan = { date: '', time: '10:00', supervisorId: '', visitType: 'home', caregiverId: '' }
const nameOf = (p: Person) => `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[2400] flex items-center justify-center p-4 bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-xl p-5 bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100">{children}</div>
    </div>
  )
}

export default function SupervisoryVisits() {
  const may = useMay('care-clients')
  const toast = useToast()
  const prompt = usePrompt()
  const confirm = useConfirm()
  const [data, setData] = useState<Reply | null>(null)
  const [settings, setSettings] = useState<Settings>({ questions: [], requireSignatures: false })
  const [loading, setLoading] = useState(true)
  const [caregivers, setCaregivers] = useState<Person[]>([])
  const [staff, setStaff] = useState<Person[]>([])
  // the form: a visit that was not planned (clientId), or finishing a planned one (plannedId)
  const [recording, setRecording] = useState<{ row: Row; plannedId: string | null } | null>(null)
  const [form, setForm] = useState(blank)
  const [signing, setSigning] = useState<null | 'supervisorSignature' | 'clientSignature'>(null)
  const [saving, setSaving] = useState(false)
  const [planning, setPlanning] = useState<{ row: Row; plannedId: string | null } | null>(null)
  const [plan, setPlan] = useState(blankPlan)
  const [editingSettings, setEditingSettings] = useState<Settings | null>(null)
  const [history, setHistory] = useState<{ row: Row; visits: Visit[] } | null>(null)
  const [signatures, setSignatures] = useState<{ supervisorSignature: string | null; clientSignature: string | null; clientSignReason: string | null } | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, s] = await Promise.all([api.get('/api/supervisory-visits') as Promise<Reply>, api.get('/api/supervisory-visits/settings') as Promise<Settings>])
      setData(list); setSettings(s)
    } catch (e) { toast.error(errorMessage(e, 'Could not load supervisory visits')) }
    finally { setLoading(false) }
  }, [toast])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    listAll('/api/caregivers').then((r) => setCaregivers(rows<Person>(r))).catch(() => { /* the form works without the list */ })
    // who can do a visit: anyone on the team — the office and the caregivers
    Promise.all([api.get('/api/users/admins').catch(() => null), api.get('/api/users/caregivers').catch(() => null)]).then(([a, c]) => {
      const seen = new Set<string>()
      setStaff([...rows<Person>(a), ...rows<Person>(c)].filter((p) => !seen.has(p.id) && seen.add(p.id)).sort((x, y) => nameOf(x).localeCompare(nameOf(y))))
    })
  }, [])

  const setRule = async (days: number) => {
    try { await api.put('/api/supervisory-visits/rule', { days }); toast.success(`Supervisory visits are every ${days} days`); load() }
    catch (e) { toast.error(errorMessage(e)) }
  }
  const setInterval_ = async (r: Row) => {
    const answer = await prompt(`Days between supervisory visits for ${r.firstName} ${r.lastName}. Leave blank to use their service code's or the agency's ${data?.ruleDays} days, or 0 if none are needed.`, { title: 'Change days', confirmText: 'Save' })
    if (answer === null || answer === undefined) return
    try {
      await api.put(`/api/supervisory-visits/client/${r.clientId}/interval`, { days: answer.trim() === '' ? null : Number(answer) })
      load()
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const save = async () => {
    if (!recording) return
    setSaving(true)
    try {
      const payload = {
        ...form, visitDate: form.visitDate || undefined, caregiverId: form.caregiverId || undefined,
        carePlanFollowed: form.carePlanFollowed === '' ? undefined : form.carePlanFollowed === 'yes',
        supervisorSignature: form.supervisorSignature || undefined, clientSignature: form.clientSignature || undefined, clientSignReason: form.clientSignReason || undefined,
      }
      if (recording.plannedId) await api.post(`/api/supervisory-visits/visits/${recording.plannedId}/complete`, payload)
      else await api.post(`/api/supervisory-visits/client/${recording.row.clientId}`, payload)
      toast.success('Visit recorded')
      setRecording(null); setForm(blank); load()
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setSaving(false) }
  }
  const savePlan = async () => {
    if (!planning) return
    setSaving(true)
    try {
      if (planning.plannedId) await api.put(`/api/supervisory-visits/visits/${planning.plannedId}`, { date: plan.date, time: plan.time, visitType: plan.visitType, ...(plan.supervisorId ? { supervisorId: plan.supervisorId } : {}) })
      else await api.post(`/api/supervisory-visits/client/${planning.row.clientId}/plan`, { ...plan, caregiverId: plan.caregiverId || undefined })
      toast.success(planning.plannedId ? 'Visit moved' : 'Visit planned')
      setPlanning(null); load()
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setSaving(false) }
  }
  const cancelPlan = async (r: Row) => {
    if (!r.plannedId || !(await confirm(`Take the planned visit with ${r.firstName} ${r.lastName} off the calendar?`, { title: 'Cancel the visit', confirmText: 'Cancel the visit', danger: true }))) return
    try { await api.post(`/api/supervisory-visits/visits/${r.plannedId}/cancel`, {}); toast.success('Visit cancelled'); load() }
    catch (e) { toast.error(errorMessage(e)) }
  }
  const saveSettings = async () => {
    if (!editingSettings) return
    setSaving(true)
    try { setSettings(await api.put('/api/supervisory-visits/settings', editingSettings) as Settings); setEditingSettings(null); toast.success('Form settings saved') }
    catch (e) { toast.error(errorMessage(e)) }
    finally { setSaving(false) }
  }
  const openHistory = async (r: Row) => {
    try { setHistory({ row: r, visits: rows<Visit>(await api.get(`/api/supervisory-visits/client/${r.clientId}`)) }) }
    catch (e) { toast.error(errorMessage(e)) }
  }
  const openSignatures = async (v: Visit) => {
    try { setSignatures(await api.get(`/api/supervisory-visits/visits/${v.id}/signatures`) as any) }
    catch (e) { toast.error(errorMessage(e)) }
  }

  if (loading) return <div className="p-4 text-sm text-gray-600 dark:text-slate-400">Loading…</div>
  const list = data?.clients ?? []
  const count = (s: Row['status']) => list.filter((r) => r.status === s).length
  const answer = (q: Question, v: string) => setForm({ ...form, answers: { ...form.answers, [q.id]: v } })

  return (
    <div className="p-4 max-w-5xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Supervisory visits</h1>
      <p className="text-sm mb-3 text-gray-600 dark:text-slate-400">A check-in on each client&apos;s care, on a regular schedule. The next one is due this many days after the last. Plan one and it goes on the calendar and on that person&apos;s phone.</p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="text-sm font-semibold" htmlFor="sv-rule">Our rule</label>
        <select id="sv-rule" className={`${inp} !w-auto`} value={data?.ruleDays ?? 90} disabled={!may.update} onChange={(e) => setRule(Number(e.target.value))}>
          <option value={60}>Every 60 days</option><option value={90}>Every 90 days</option>
        </select>
        {may.update && <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setEditingSettings({ questions: settings.questions.map((q) => ({ ...q })), requireSignatures: settings.requireSignatures })}>Form settings</button>}
        <span className="text-sm"><b>{count('overdue')}</b> overdue · <b>{count('due_soon')}</b> due within 14 days · <b>{count('ok')}</b> on track</span>
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg p-6 text-center text-sm bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-400">No clients need supervisory visits.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead><tr className="text-left bg-gray-50 dark:bg-slate-800"><th className="px-3 py-2">Client</th><th>Last visit</th><th>Next due</th><th>Every</th><th>Status</th><th>Planned</th><th /></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.clientId} className="border-t border-gray-100 dark:border-slate-700">
                  <td className="px-3 py-2 font-semibold">{r.firstName} {r.lastName}</td>
                  <td>{r.lastVisit ? formatAgencyDate(r.lastVisit) : 'None yet'}</td>
                  <td>{formatAgencyDate(r.dueDate)}</td>
                  <td>{r.intervalDays} days{SOURCE[r.intervalSource] ?? ''}</td>
                  <td>
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${BADGE[r.status].cls}`}>{BADGE[r.status].label}</span>
                    <span className="ml-2 text-xs text-gray-600 dark:text-slate-400">{r.status === 'overdue' ? `${r.daysOverdue} days late` : `in ${r.daysUntilDue} days`}</span>
                  </td>
                  <td className="text-xs">{r.plannedId ? <>{formatAgencyDate(r.plannedDate!)}{r.plannedTime ? ` ${r.plannedTime}` : ''}<br /><span className={muted}>{r.plannedSupervisorName}</span></> : <span className={muted}>—</span>}</td>
                  <td className="py-1 pr-2 text-right whitespace-nowrap">
                    {r.plannedId ? (<>
                      {may.update && <button type="button" className="hc-btn hc-btn-sm hc-btn-primary mr-1" onClick={() => { setRecording({ row: r, plannedId: r.plannedId }); setForm(blank) }}>Finish</button>}
                      {may.update && <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary mr-1" onClick={() => { setPlanning({ row: r, plannedId: r.plannedId }); setPlan({ ...blankPlan, date: r.plannedDate ?? '', time: r.plannedHm ?? blankPlan.time }) }}>Move</button>}
                      {may.update && <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary mr-1" onClick={() => cancelPlan(r)}>Cancel</button>}
                    </>) : (<>
                      {may.update && <button type="button" className="hc-btn hc-btn-sm hc-btn-primary mr-1" onClick={() => { setPlanning({ row: r, plannedId: null }); setPlan(blankPlan) }}>Plan</button>}
                      {may.update && <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary mr-1" onClick={() => { setRecording({ row: r, plannedId: null }); setForm(blank) }}>Record a visit</button>}
                    </>)}
                    <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary mr-1" onClick={() => openHistory(r)}>History</button>
                    {may.update && <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setInterval_(r)}>Change days</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {planning && (
        <Modal onClose={() => setPlanning(null)}>
          <h2 className="m-0 mb-3 text-lg font-semibold">{planning.plannedId ? 'Move the visit' : 'Plan a visit'}: {planning.row.firstName} {planning.row.lastName}</h2>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <label className="text-sm">Day<input type="date" className={inp} value={plan.date} onChange={(e) => setPlan({ ...plan, date: e.target.value })} /></label>
            <label className="text-sm">Time<input type="time" className={inp} value={plan.time} onChange={(e) => setPlan({ ...plan, time: e.target.value })} /></label>
          </div>
          <label className="block text-sm mb-2">Who will do it
            <select className={inp} value={plan.supervisorId} onChange={(e) => setPlan({ ...plan, supervisorId: e.target.value })}>
              <option value="">{planning.plannedId ? '— keep the same person —' : '— choose —'}</option>{staff.map((p) => <option key={p.id} value={p.id}>{nameOf(p)}</option>)}
            </select>
            <span className={muted}>They get it on their phone and a reminder the day before.</span>
          </label>
          <label className="block text-sm mb-2">How<select className={inp} value={plan.visitType} onChange={(e) => setPlan({ ...plan, visitType: e.target.value })}><option value="home">In the home</option><option value="phone">By phone</option></select></label>
          {!planning.plannedId && (
            <label className="block text-sm mb-3">Caregiver this visit will look at (optional)
              <select className={inp} value={plan.caregiverId} onChange={(e) => setPlan({ ...plan, caregiverId: e.target.value })}>
                <option value="">— none —</option>{caregivers.map((c) => <option key={c.id} value={c.id}>{nameOf(c)}</option>)}
              </select>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setPlanning(null)}>Close</button>
            <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" disabled={saving} onClick={savePlan}>{saving ? 'Saving…' : planning.plannedId ? 'Move' : 'Plan the visit'}</button>
          </div>
        </Modal>
      )}

      {recording && (
        <Modal onClose={() => setRecording(null)}>
          <h2 className="m-0 mb-3 text-lg font-semibold">Supervisory visit: {recording.row.firstName} {recording.row.lastName}</h2>
          <div className="grid grid-cols-2 gap-2 mb-2">
            {!recording.plannedId && <label className="text-sm">Date<input type="date" className={inp} value={form.visitDate} onChange={(e) => setForm({ ...form, visitDate: e.target.value })} /><span className={muted}>Blank = today</span></label>}
            <label className="text-sm">How<select className={inp} value={form.visitType} onChange={(e) => setForm({ ...form, visitType: e.target.value })}><option value="home">In the home</option><option value="phone">By phone</option></select></label>
          </div>
          <label className="block text-sm mb-2">Caregiver this visit looked at (optional)
            <select className={inp} value={form.caregiverId} onChange={(e) => setForm({ ...form, caregiverId: e.target.value })}>
              <option value="">— none —</option>{caregivers.map((c) => <option key={c.id} value={c.id}>{nameOf(c)}</option>)}
            </select>
          </label>
          <label className="block text-sm mb-2">What did the client say?<textarea className={inp} rows={2} value={form.clientFeedback} onChange={(e) => setForm({ ...form, clientFeedback: e.target.value })} /></label>
          <label className="block text-sm mb-2">Is the care plan being followed?
            <select className={inp} value={form.carePlanFollowed} onChange={(e) => setForm({ ...form, carePlanFollowed: e.target.value })}><option value="">Not sure / not checked</option><option value="yes">Yes</option><option value="no">No</option></select>
          </label>
          <label className="block text-sm mb-2">How is the caregiver doing?<textarea className={inp} rows={2} value={form.caregiverFeedback} onChange={(e) => setForm({ ...form, caregiverFeedback: e.target.value })} /></label>
          <label className="block text-sm mb-2">Any concerns?<textarea className={inp} rows={2} value={form.concerns} onChange={(e) => setForm({ ...form, concerns: e.target.value })} /></label>
          <label className="block text-sm mb-2">What needs to happen next?<textarea className={inp} rows={2} value={form.followUpNotes} onChange={(e) => setForm({ ...form, followUpNotes: e.target.value })} /></label>
          {settings.questions.map((q) => (
            <label key={q.id} className="block text-sm mb-2">{q.label}{q.required ? ' *' : ''}
              {q.kind === 'yes_no'
                ? <select className={inp} value={form.answers[q.id] ?? ''} onChange={(e) => answer(q, e.target.value)}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select>
                : <textarea className={inp} rows={2} value={form.answers[q.id] ?? ''} onChange={(e) => answer(q, e.target.value)} />}
            </label>
          ))}
          <div className="rounded-lg border p-3 mb-3 border-gray-200 dark:border-slate-700">
            <div className="text-sm font-semibold mb-2">Signatures{settings.requireSignatures ? ' (required)' : ' (optional)'}</div>
            <div className="flex flex-wrap gap-2 mb-2">
              <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setSigning('supervisorSignature')}>{form.supervisorSignature ? '✓ Supervisor signed' : 'Supervisor signs'}</button>
              <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" disabled={!!form.clientSignReason} onClick={() => setSigning('clientSignature')}>{form.clientSignature ? '✓ Client signed' : 'Client signs'}</button>
            </div>
            <label className="block text-sm">Or why the client could not sign
              <input className={inp} value={form.clientSignReason} disabled={!!form.clientSignature} placeholder={form.visitType === 'phone' ? 'Visit by phone' : ''} onChange={(e) => setForm({ ...form, clientSignReason: e.target.value })} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setRecording(null)}>Cancel</button>
            <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save visit'}</button>
          </div>
        </Modal>
      )}
      <SignaturePad open={!!signing} requireTypedName={false} documentName={signing === 'clientSignature' ? 'Client: supervisory visit' : 'Supervisor: supervisory visit'}
        onClose={() => setSigning(null)} onSign={async (uri) => { if (signing) setForm((f) => ({ ...f, [signing]: uri })); setSigning(null) }} />

      {editingSettings && (
        <Modal onClose={() => setEditingSettings(null)}>
          <h2 className="m-0 mb-3 text-lg font-semibold">Form settings</h2>
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={editingSettings.requireSignatures} onChange={(e) => setEditingSettings({ ...editingSettings, requireSignatures: e.target.checked })} />
            Require both signatures (the supervisor&apos;s, and the client&apos;s or why they could not sign)
          </label>
          <div className="text-sm font-semibold mb-1">Your own questions</div>
          <p className={`${muted} mb-2`}>Asked on every supervisory visit, after the standard ones.</p>
          {editingSettings.questions.map((q, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 mb-2">
              <input className={`${inp} flex-1 min-w-[12rem]`} value={q.label} maxLength={200} placeholder="The question" onChange={(e) => { const qs = [...editingSettings.questions]; qs[i] = { ...q, label: e.target.value }; setEditingSettings({ ...editingSettings, questions: qs }) }} />
              <select className={`${inp} !w-auto`} value={q.kind} onChange={(e) => { const qs = [...editingSettings.questions]; qs[i] = { ...q, kind: e.target.value as Question['kind'] }; setEditingSettings({ ...editingSettings, questions: qs }) }}>
                <option value="yes_no">Yes or no</option><option value="text">Written answer</option>
              </select>
              <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={q.required} onChange={(e) => { const qs = [...editingSettings.questions]; qs[i] = { ...q, required: e.target.checked }; setEditingSettings({ ...editingSettings, questions: qs }) }} />Required</label>
              <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" aria-label="Remove the question" onClick={() => setEditingSettings({ ...editingSettings, questions: editingSettings.questions.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          {editingSettings.questions.length < 20 && <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary mb-3" onClick={() => setEditingSettings({ ...editingSettings, questions: [...editingSettings.questions, { id: '', label: '', kind: 'yes_no', required: false }] })}>Add a question</button>}
          <div className="flex justify-end gap-2">
            <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setEditingSettings(null)}>Cancel</button>
            <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" disabled={saving} onClick={saveSettings}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}

      {history && (
        <Modal onClose={() => setHistory(null)}>
          <h2 className="m-0 mb-3 text-lg font-semibold">Past visits: {history.row.firstName} {history.row.lastName}</h2>
          {history.visits.length === 0 ? <p className="text-sm text-gray-600 dark:text-slate-400">None recorded yet.</p> : history.visits.map((v) => (
            <div key={v.id} className="mb-3 rounded-lg border p-3 text-sm border-gray-200 dark:border-slate-700">
              <div className="font-semibold">{formatAgencyDate(v.visitDate)} · {v.visitType === 'phone' ? 'By phone' : 'In the home'}{v.supervisorName ? ` · ${v.supervisorName}` : ''}{v.recordedFrom === 'phone' ? ' · from the phone' : ''}</div>
              {v.caregiverName && <div>Caregiver: {v.caregiverName}</div>}
              {v.clientFeedback && <div>Client said: {v.clientFeedback}</div>}
              {v.carePlanFollowed !== null && <div>Care plan followed: {v.carePlanFollowed ? 'Yes' : 'No'}</div>}
              {v.caregiverFeedback && <div>Caregiver: {v.caregiverFeedback}</div>}
              {v.concerns && <div>Concerns: {v.concerns}</div>}
              {v.followUpNotes && <div>Next: {v.followUpNotes}</div>}
              {(v.answers ?? []).filter((a) => a.answer !== null).map((a) => <div key={a.id}>{a.label} {a.answer === true ? 'Yes' : a.answer === false ? 'No' : a.answer}</div>)}
              {(v.supervisorSigned || v.clientSigned || v.clientSignReason) && (
                <div className="mt-1">
                  <span className={muted}>{v.supervisorSigned ? 'Supervisor signed' : 'Supervisor did not sign'} · {v.clientSigned ? 'Client signed' : v.clientSignReason ? `Client did not sign: ${v.clientSignReason}` : 'Client did not sign'}</span>
                  {(v.supervisorSigned || v.clientSigned) && <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary ml-2" onClick={() => openSignatures(v)}>See signatures</button>}
                </div>
              )}
            </div>
          ))}
          <div className="flex justify-end"><button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setHistory(null)}>Close</button></div>
        </Modal>
      )}

      {signatures && (
        <Modal onClose={() => setSignatures(null)}>
          <h2 className="m-0 mb-3 text-lg font-semibold">Signatures</h2>
          {signatures.supervisorSignature && <div className="mb-3"><div className="text-sm font-semibold">Supervisor</div><img src={signatures.supervisorSignature} alt="The supervisor's signature" className="max-w-full rounded bg-white p-2" /></div>}
          {signatures.clientSignature
            ? <div className="mb-3"><div className="text-sm font-semibold">Client</div><img src={signatures.clientSignature} alt="The client's signature" className="max-w-full rounded bg-white p-2" /></div>
            : signatures.clientSignReason && <p className="text-sm">The client did not sign: {signatures.clientSignReason}</p>}
          <div className="flex justify-end"><button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setSignatures(null)}>Close</button></div>
        </Modal>
      )}
    </div>
  )
}
