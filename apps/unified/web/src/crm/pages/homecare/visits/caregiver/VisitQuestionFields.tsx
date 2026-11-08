// The agency's clock-in / clock-out questions on the caregiver's web view (care_visit_questions; server
// crm/homecare/visits/visitQuestions.ts GET /active, enforced by time-entries clock-in/out). The phone app has its own
// (apps/mobile/src/care/components/VisitQuestions.tsx). Home care live test 11/08: a required clock-in question refused the
// web clock-in with nowhere to answer it. The list is kept in this browser, so a caregiver with no signal is still asked.
// Agency without the feature: the server answers 403/404 and nothing is shown.
import { useEffect, useState } from 'react'
import { api } from '../../lib/http'

export interface VisitQuestion { id: string; prompt: string; kind: string; options: unknown; required: boolean }
export type VisitAnswers = Record<string, string>

const KEY = (phase: string) => `homecare_visit_questions_${phase}_v1`

export function useVisitQuestions(phase: 'clock_in' | 'clock_out'): VisitQuestion[] {
  const [list, setList] = useState<VisitQuestion[]>([])
  useEffect(() => {
    let live = true
    api.get(`/api/visit-questions/active?phase=${phase}`).then((r: any) => {
      const got = Array.isArray(r?.data) ? r.data : []
      if (!live) return
      setList(got)
      try { localStorage.setItem(KEY(phase), JSON.stringify(got)) } catch { /* not kept */ }
    }).catch((e: any) => {
      if (!live) return
      const s = Number(e?.status ?? 0)
      if (s === 403 || s === 404) { try { localStorage.removeItem(KEY(phase)) } catch { /* none */ } return }
      try { const kept = JSON.parse(localStorage.getItem(KEY(phase)) || '[]'); if (Array.isArray(kept)) setList(kept) } catch { /* none kept */ }
    })
    return () => { live = false }
  }, [phase])
  return list
}

/** What the server takes: [{ questionId, answer }] for the answered ones. */
export const answersBody = (questions: VisitQuestion[], answers: VisitAnswers) =>
  questions.filter((q) => String(answers[q.id] ?? '').trim()).map((q) => ({ questionId: q.id, answer: String(answers[q.id]).trim() }))

/** The required questions still blank (ids). */
export const unanswered = (questions: VisitQuestion[], answers: VisitAnswers) =>
  questions.filter((q) => q.required && !String(answers[q.id] ?? '').trim()).map((q) => q.id)

const box = 'box-border w-full rounded-[10px] border-2 border-gray-300 bg-white p-3 text-base text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

export function VisitQuestionFields({ questions, answers, onChange, title, problems }: {
  questions: VisitQuestion[]; answers: VisitAnswers; onChange: (next: VisitAnswers) => void; title: string; problems?: Record<string, string>
}) {
  if (!questions.length) return null
  const set = (id: string, v: string) => onChange({ ...answers, [id]: v })
  return (
    <fieldset className="mb-4 rounded-lg border border-gray-200 p-3 text-left dark:border-slate-700" data-testid="visit-questions">
      <legend className="px-1 text-sm font-bold text-gray-900 dark:text-slate-100">{title}</legend>
      {questions.map((q) => {
        const problem = problems?.[q.id]
        const label = `${q.prompt}${q.required ? ' *' : ''}`
        const choices: [string, string][] = q.kind === 'yes_no' ? [['yes', 'Yes'], ['no', 'No']] : (Array.isArray(q.options) ? q.options.map((o) => [String(o), String(o)] as [string, string]) : [])
        return (
          <div key={q.id} className="mb-3">
            {q.kind === 'number' || q.kind === 'text' ? (
              <label className="block text-sm font-semibold text-gray-900 dark:text-slate-100">{label}
                {q.kind === 'number'
                  ? <input type="number" inputMode="decimal" step="any" value={answers[q.id] || ''} onChange={(e) => set(q.id, e.target.value)} className={`${box} mt-1`} />
                  : <textarea value={answers[q.id] || ''} onChange={(e) => set(q.id, e.target.value)} maxLength={1000} rows={2} className={`${box} mt-1`} />}
              </label>
            ) : (
              <div role="radiogroup" aria-label={q.prompt}>
                <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{label}</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {choices.map(([value, text]) => {
                    const on = (answers[q.id] || '').toLowerCase() === value.toLowerCase()
                    return (
                      <button key={value} type="button" role="radio" aria-checked={on} onClick={() => set(q.id, on && !q.required ? '' : value)}
                        className={`rounded-lg border-2 px-4 py-2 text-base ${on ? 'border-teal-700 bg-teal-50 font-extrabold text-teal-900 dark:border-teal-400 dark:bg-teal-950 dark:text-teal-100' : 'border-gray-300 bg-white font-semibold text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'}`}>
                        {text}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {problem && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">{problem}</p>}
          </div>
        )
      })}
    </fieldset>
  )
}
