// Project budgets, under Job Costing (brief item 5): pick a project and see the budget its approved quotes set, by cost code,
// beside what its jobs have cost so far. Shows only where the business has the `job_budgets` feature and the seat reads reports
// (JobCostingPage decides); the server (apps/unified crm/field/jobCosting.ts /budget/:projectId) checks the same two things.
// Nothing here changes a quote, a budget or a payment — it only reads.
import React, { useEffect, useState } from 'react'
import { money } from '../invoicing/ui'
import type { ReportingApi } from './types'

type Line = { costCode: string; estimatedCost: number; estimatedPrice: number; uncostedLines: number; actualCost?: number; overBy?: number; profit?: number; margin?: number | null }
type Budget = { projectName: string; lines: Line[]; totalCost: number; totalPrice: number; uncostedLines: number; actualCost: number; remainingCost: number; jobCount: number; byCode?: boolean; unbudgeted?: Array<{ costCode: string; actualCost: number }>; totalProfit?: number }
type Proj = { id: string; name: string; number?: string }

const card = 'bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6'
const muted = 'text-gray-500 dark:text-slate-400'
const th = 'py-2 pr-3 text-right text-xs uppercase text-gray-600 dark:text-slate-400'
const td = 'py-2 pr-3 text-right tabular-nums text-gray-700 dark:text-slate-300 whitespace-nowrap'

export function ProjectBudgets({ api }: { api: ReportingApi }) {
  const [projects, setProjects] = useState<Proj[] | null>(null)
  const [listError, setListError] = useState('')
  const [projectId, setProjectId] = useState('')
  const [budget, setBudget] = useState<Budget | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    Promise.resolve(api.get('/api/projects', { limit: 100 }))
      .then((r: any) => { if (live) setProjects(Array.isArray(r) ? r : r?.data || []) })
      .catch((e: Error) => { if (live) { setProjects([]); setListError(e?.message || 'Could not load your projects') } })
    return () => { live = false }
  }, [api])

  useEffect(() => {
    if (!projectId) { setBudget(null); setError(''); return }
    let live = true
    setBudget(null); setError('')
    Promise.resolve(api.get(`/api/job-costing/budget/${projectId}`))
      .then((r: any) => { if (live) setBudget((r?.data ?? r) as Budget) })
      .catch((e: Error) => { if (live) setError(e?.message || 'Could not load this budget') })
    return () => { live = false }
  }, [api, projectId])

  const over = budget ? budget.remainingCost < 0 : false

  return (
    <div className={card} data-project-budgets>
      <h3 className="font-semibold text-gray-900 dark:text-slate-100">Project budgets</h3>
      <p className={`text-xs ${muted} mt-1 mb-4`}>What a project's approved quotes budgeted, by cost code, against what its jobs have cost so far.</p>

      {projects === null ? (
        <p className={`text-sm ${muted}`}>Loading your projects…</p>
      ) : (
        <>
          {listError && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-2">{listError}</p>}
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project"
            className="w-full sm:w-80 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 dark:text-slate-100">
            <option value="">{projects.length ? 'Pick a project' : 'No projects yet'}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.number ? `${p.number} · ` : ''}{p.name}</option>)}
          </select>
        </>
      )}

      {projectId && !budget && !error && <p className={`text-sm ${muted} mt-4`}>Loading this budget…</p>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mt-4">{error}</p>}

      {budget && budget.lines.length === 0 && (
        <p className={`text-sm ${muted} mt-4`}>No budget yet. When a quote on {budget.projectName} is approved, its cost codes appear here.</p>
      )}

      {budget && budget.lines.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700">
                <th className="py-2 pr-3 text-left text-xs uppercase text-gray-600 dark:text-slate-400">Cost code</th>
                <th className={th}>Budgeted cost</th>
                <th className={th}>Priced at</th>
                {budget.byCode && <th className={th}>Actual cost</th>}
                {budget.byCode && <th className={th}>Expected profit</th>}
              </tr>
            </thead>
            <tbody>
              {budget.lines.map((l) => (
                <tr key={l.costCode} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="py-2 pr-3 text-gray-900 dark:text-slate-100">{l.costCode}</td>
                  <td className={td}>{money(l.estimatedCost)}</td>
                  <td className={td}>{money(l.estimatedPrice)}</td>
                  {budget.byCode && <td className={`${td} ${(l.overBy || 0) > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{money(l.actualCost || 0)}</td>}
                  {budget.byCode && <td className={`${td} ${(l.profit || 0) < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{money(l.profit || 0)}{l.margin != null ? ` (${l.margin}%)` : ''}</td>}
                </tr>
              ))}
              {budget.byCode && (budget.unbudgeted || []).map((u) => (
                <tr key={'u-' + u.costCode} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="py-2 pr-3 text-gray-900 dark:text-slate-100">{u.costCode} <span className={`text-xs ${muted}`}>(not on the budget)</span></td>
                  <td className={td}>{money(0)}</td><td className={td}>{money(0)}</td>
                  <td className={`${td} text-red-600 dark:text-red-400`}>{money(u.actualCost)}</td>
                  <td className={`${td} text-red-600 dark:text-red-400`}>{money(-u.actualCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div><dt className={muted}>Budget (cost)</dt><dd className="font-semibold text-gray-900 dark:text-slate-100 tabular-nums">{money(budget.totalCost)}</dd></div>
            <div><dt className={muted}>Spent so far{budget.jobCount ? ` (${budget.jobCount} ${budget.jobCount === 1 ? 'job' : 'jobs'})` : ''}</dt><dd className="font-semibold text-gray-900 dark:text-slate-100 tabular-nums">{money(budget.actualCost)}</dd></div>
            <div>
              <dt className={muted}>{over ? 'Over budget by' : 'Left to spend'}</dt>
              <dd className={`font-semibold tabular-nums ${over ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>{money(Math.abs(budget.remainingCost))}</dd>
            </div>
          </dl>
          {budget.byCode && (
            <p className={`text-xs ${muted} mt-3`}>
              Expected profit is the price less the larger of the budget and what the line has cost so far. Cost with no cost code files under "Uncoded".
              {typeof budget.totalProfit === 'number' && <> Expected profit on the whole project: <span className="font-semibold">{money(budget.totalProfit)}</span>.</>}
            </p>
          )}
          {budget.uncostedLines > 0 && (
            <p className={`text-xs ${muted} mt-3`}>
              {budget.uncostedLines} quote {budget.uncostedLines === 1 ? 'line has' : 'lines have'} no cost entered, so the budget may be lower than the work will really cost.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default ProjectBudgets
