// Clock-in and clock-out questions (care_visit_questions): the agency writes what the caregiver is asked at the door and on the
// way out, and reads the answers (a worrying one is marked). Row 3: a number question with a lowest / highest and flag levels; a
// flagged answer stays under "Needs a look" until someone acknowledges it (who and when are kept), as AxisCare's Care Vision does.
//   GET|POST /api/visit-questions, PUT|DELETE /api/visit-questions/:id, GET /api/visit-questions/answers,
//   POST /api/visit-questions/answers/:id/acknowledge
//   (server/crm/homecare/visits/visitQuestions.ts)
import { useCallback, useEffect, useState } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, rows, errorMessage } from '../lib/http'
import { formatDateTime } from '../lib/datetime'
import { useMay } from '../lib/useMay'

interface NumberRules { min: number | null; max: number | null; flagBelow: number | null; flagAbove: number | null }
interface Question { id: string; prompt: string; kind: 'yes_no' | 'text' | 'choice' | 'number'; options: string[] | NumberRules | null; phase: 'clock_in' | 'clock_out' | 'both'; required: boolean; flagOn: string | null; sortOrder: number; isActive: boolean }
interface Answer { id: string; timeEntryId: string; prompt: string; phase: 'clock_in' | 'clock_out'; answer: string; flagged: boolean; createdAt: string; clientFirst: string; clientLast: string; caregiverFirst: string; caregiverLast: string; acknowledgedAt: string | null; acknowledgedByFirst: string | null; acknowledgedByLast: string | null }

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const KIND: Record<Question['kind'], string> = { yes_no: 'Yes or no', text: 'Short written answer', choice: 'Pick one', number: 'A number' }
const PHASE: Record<Question['phase'] | 'clock_in' | 'clock_out', string> = { clock_in: 'Clock-in', clock_out: 'Clock-out', both: 'Clock-in and clock-out' }
const EMPTY = { prompt: '', kind: 'yes_no' as Question['kind'], phase: 'clock_in' as Question['phase'], required: false, optionsText: '', flagOn: '', min: '', max: '', flagBelow: '', flagAbove: '' }
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
const rulesText = (o: NumberRules) => [o.min !== null ? `from ${o.min}` : '', o.max !== null ? `to ${o.max}` : '', o.flagBelow !== null ? `tells the office below ${o.flagBelow}` : '', o.flagAbove !== null ? `tells the office above ${o.flagAbove}` : ''].filter(Boolean).join(', ')

type Tab = 'questions' | 'answers'

export default function VisitQuestions() {
  const may = useMay('care-clients')
  const toast = useToast()
  const confirm = useConfirm()
  const [tab, setTab] = useState<Tab>('questions')
  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [answers, setAnswers] = useState<Answer[] | null>(null)
  const [flaggedOnly, setFlaggedOnly] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const loadQuestions = useCallback(() => {
    api.get('/api/visit-questions').then((r) => setQuestions(rows<Question>(r))).catch((e) => toast.error(errorMessage(e, 'Could not load the questions')))
  }, [toast])
  const loadAnswers = useCallback(() => {
    api.get(`/api/visit-questions/answers?days=30${flaggedOnly ? '&unacknowledged=true' : ''}`).then((r) => setAnswers(rows<Answer>(r))).catch((e) => toast.error(errorMessage(e, 'Could not load the answers')))
  }, [toast, flaggedOnly])
  useEffect(() => { loadQuestions() }, [loadQuestions])
  useEffect(() => { if (tab === 'answers') loadAnswers() }, [tab, loadAnswers])

  const options = form.optionsText.split('\n').map((s) => s.trim()).filter(Boolean)
  const save = async () => {
    setErrors({})
    const body = {
      prompt: form.prompt, kind: form.kind, phase: form.phase, required: form.required,
      options: form.kind === 'choice' ? options : form.kind === 'number' ? { min: numOrNull(form.min), max: numOrNull(form.max), flagBelow: numOrNull(form.flagBelow), flagAbove: numOrNull(form.flagAbove) } : null,
      flagOn: form.kind === 'text' || form.kind === 'number' ? null : form.flagOn || null,
    }
    try {
      if (editing) await api.put(`/api/visit-questions/${editing}`, body)
      else await api.post('/api/visit-questions', { ...body, sortOrder: (questions?.length ?? 0) + 1 })
      setForm(EMPTY); setEditing(null); loadQuestions(); toast.success('Question saved')
    } catch (e: any) {
      setErrors(e?.fields || e?.data?.fields || {})
      toast.error(errorMessage(e))
    }
  }
  const edit = (q: Question) => {
    setEditing(q.id); setErrors({})
    const n = q.kind === 'number' && q.options && !Array.isArray(q.options) ? q.options : null
    const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))
    setForm({ prompt: q.prompt, kind: q.kind, phase: q.phase, required: q.required, optionsText: Array.isArray(q.options) ? q.options.join('\n') : '', flagOn: q.flagOn || '', min: s(n?.min), max: s(n?.max), flagBelow: s(n?.flagBelow), flagAbove: s(n?.flagAbove) })
  }
  const patch = async (q: Question, body: Partial<Question>) => {
    try { await api.put(`/api/visit-questions/${q.id}`, body); loadQuestions() } catch (e) { toast.error(errorMessage(e)) }
  }
  const move = async (i: number, dir: -1 | 1) => {
    if (!questions) return
    const a = questions[i], b = questions[i + dir]
    if (!a || !b) return
    try {
      await api.put(`/api/visit-questions/${a.id}`, { sortOrder: i + dir + 1 })
      await api.put(`/api/visit-questions/${b.id}`, { sortOrder: i + 1 })
      loadQuestions()
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const remove = async (q: Question) => {
    if (!(await confirm(`Delete "${q.prompt}"? Answers already given keep their wording.`, { danger: true }))) return
    try { await api.delete(`/api/visit-questions/${q.id}`); if (editing === q.id) { setEditing(null); setForm(EMPTY) } loadQuestions() } catch (e) { toast.error(errorMessage(e)) }
  }
  const acknowledge = async (a: Answer) => {
    try { await api.post(`/api/visit-questions/answers/${a.id}/acknowledge`, {}); toast.success('Acknowledged'); loadAnswers() }
    catch (e) { toast.error(errorMessage(e)) }
  }
  const flagChoices = form.kind === 'yes_no' ? ['yes', 'no'] : form.kind === 'choice' ? options : []

  const tabBtn = (t: Tab, label: string) => (
    <button type="button" role="tab" aria-selected={tab === t} className={`hc-btn hc-btn-sm ${tab === t ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setTab(t)}>{label}</button>
  )

  return (
    <div className="p-4 max-w-4xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Clock-in and clock-out questions</h1>
      <p className="text-sm mb-4 text-gray-600 dark:text-slate-400">What the caregiver is asked when they start and finish a visit: safety, how the client is, breaks. A required question must be answered before the clock-in or clock-out goes through. A punch saved on a phone with no signal is never refused.</p>
      <div role="tablist" className="flex gap-2 mb-4">{tabBtn('questions', 'Questions')}{tabBtn('answers', 'Answers')}</div>

      {tab === 'questions' && (
        <div>
          {questions && questions.length === 0 && <p className="text-sm text-gray-600 dark:text-slate-400 mb-3">No questions yet. Caregivers clock in and out without being asked anything.</p>}
          <ul className="mb-4 divide-y divide-gray-200 dark:divide-slate-700 rounded-md border border-gray-200 dark:border-slate-700">
            {(questions || []).map((q, i) => (
              <li key={q.id} className="p-3 flex flex-wrap items-center gap-2" style={{ opacity: q.isActive ? 1 : 0.6 }}>
                <div className="flex-1 min-w-[14rem]">
                  <div className="font-medium">{q.prompt}</div>
                  <div className="text-xs text-gray-600 dark:text-slate-400">
                    {PHASE[q.phase]} · {KIND[q.kind]}{q.kind === 'choice' && Array.isArray(q.options) ? ` (${q.options.join(', ')})` : ''}{q.kind === 'number' && q.options && !Array.isArray(q.options) && rulesText(q.options) ? ` (${rulesText(q.options)})` : ''}
                    {q.required ? ' · Required' : ''}{q.flagOn ? ` · Tells the office if “${q.flagOn}”` : ''}{q.isActive ? '' : ' · Switched off'}
                  </div>
                </div>
                {may.update && (
                  <div className="flex gap-1">
                    <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" aria-label={`Move “${q.prompt}” up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" aria-label={`Move “${q.prompt}” down`} disabled={i === (questions?.length ?? 0) - 1} onClick={() => move(i, 1)}>↓</button>
                    <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => patch(q, { isActive: !q.isActive })}>{q.isActive ? 'Switch off' : 'Switch on'}</button>
                    <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => edit(q)}>Edit</button>
                    <button type="button" className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => remove(q)}>Delete</button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {may.update && (
            <div className="rounded-md border border-gray-200 dark:border-slate-700 p-3">
              <h2 className="font-semibold mb-2">{editing ? 'Edit the question' : 'Add a question'}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm sm:col-span-2">Question<br /><input className={`${inp} w-full`} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="e.g. Was the home safe to enter?" maxLength={200} />
                  {errors.prompt && <span role="alert" className="text-red-700 dark:text-red-300 text-xs">{errors.prompt}</span>}</label>
                <label className="text-sm">Answer is<br />
                  <select className={inp} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Question['kind'], flagOn: '' })}>
                    {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></label>
                <label className="text-sm">Asked at<br />
                  <select className={inp} value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value as Question['phase'] })}>
                    {(['clock_in', 'clock_out', 'both'] as const).map((p) => <option key={p} value={p}>{PHASE[p]}</option>)}
                  </select></label>
                {form.kind === 'choice' && (
                  <label className="text-sm sm:col-span-2">Choices (one per line)<br /><textarea className={`${inp} w-full`} rows={4} value={form.optionsText} onChange={(e) => setForm({ ...form, optionsText: e.target.value })} />
                    {errors.options && <span role="alert" className="text-red-700 dark:text-red-300 text-xs">{errors.options}</span>}</label>
                )}
                {form.kind === 'number' && (
                  <div className="sm:col-span-2 grid gap-2 grid-cols-2 sm:grid-cols-4">
                    <label className="text-sm">Lowest allowed<br /><input type="number" className={`${inp} w-full`} value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} /></label>
                    <label className="text-sm">Highest allowed<br /><input type="number" className={`${inp} w-full`} value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} /></label>
                    <label className="text-sm">Tell the office below<br /><input type="number" className={`${inp} w-full`} value={form.flagBelow} onChange={(e) => setForm({ ...form, flagBelow: e.target.value })} /></label>
                    <label className="text-sm">Tell the office above<br /><input type="number" className={`${inp} w-full`} value={form.flagAbove} onChange={(e) => setForm({ ...form, flagAbove: e.target.value })} /></label>
                    {errors.options && <span role="alert" className="col-span-full text-red-700 dark:text-red-300 text-xs">{errors.options}</span>}
                  </div>
                )}
                {form.kind !== 'text' && form.kind !== 'number' && (
                  <label className="text-sm">Tell the office if the answer is<br />
                    <select className={inp} value={form.flagOn} onChange={(e) => setForm({ ...form, flagOn: e.target.value })}>
                      <option value="">Never</option>
                      {flagChoices.map((c) => <option key={c} value={c}>{c === 'yes' ? 'Yes' : c === 'no' ? 'No' : c}</option>)}
                    </select>
                    {errors.flagOn && <span role="alert" className="text-red-700 dark:text-red-300 text-xs">{errors.flagOn}</span>}</label>
                )}
                <label className="text-sm flex items-center gap-2 self-end"><input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} />Must be answered to clock {form.phase === 'clock_out' ? 'out' : form.phase === 'clock_in' ? 'in' : 'in or out'}</label>
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" className="hc-btn hc-btn-primary" onClick={save}>{editing ? 'Save changes' : 'Add question'}</button>
                {editing && <button type="button" className="hc-btn hc-btn-secondary" onClick={() => { setEditing(null); setForm(EMPTY); setErrors({}) }}>Cancel</button>}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'answers' && (
        <div>
          <label className="text-sm flex items-center gap-2 mb-3"><input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />Only answers that need a look and nobody has acknowledged</label>
          {answers && answers.length === 0 && <p className="text-sm text-gray-600 dark:text-slate-400">{flaggedOnly ? 'Nothing needs a look.' : 'No answers in the last 30 days.'}</p>}
          {answers && answers.length > 0 && (
            <table className="hc-table">
              <thead><tr><th>When</th><th>Caregiver</th><th>Client</th><th>Question</th><th>Answer</th></tr></thead>
              <tbody>
                {answers.map((a) => (
                  <tr key={a.id}>
                    <td>{formatDateTime(a.createdAt)}<div className="text-xs text-gray-600 dark:text-slate-400">{PHASE[a.phase]}</div></td>
                    <td>{a.caregiverFirst} {a.caregiverLast}</td>
                    <td>{a.clientFirst} {a.clientLast}</td>
                    <td>{a.prompt}</td>
                    <td>
                      {a.flagged ? <span className="hc-badge hc-badge-danger">{a.answer} — needs a look</span> : a.answer}
                      {a.flagged && a.acknowledgedAt && <div className="text-xs text-gray-600 dark:text-slate-400">Acknowledged by {a.acknowledgedByFirst} {a.acknowledgedByLast}, {formatDateTime(a.acknowledgedAt)}</div>}
                      {a.flagged && !a.acknowledgedAt && may.update && <div><button type="button" className="hc-btn hc-btn-sm hc-btn-secondary mt-1" onClick={() => acknowledge(a)}>Acknowledge</button></div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
