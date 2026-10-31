// A "Cost code" box for the forms that record cost (expenses, time) — shown only where the business has `cost_by_code`.
// It is a plain text box that suggests the codes on the chosen project's budget, so the cost files under a budget line
// (project budget by cost code, ProjectBudgets.tsx). Nothing is required: a cost with no code is "Uncoded".
import React, { useEffect, useState } from 'react'
import { Field, inputCls } from '../invoicing/ui'

export function CostCodeField({ api, projectId, value, onChange }: { api: { get: (u: string, p?: any) => Promise<any> }; projectId?: string | null; value: string; onChange: (v: string) => void }) {
  const [codes, setCodes] = useState<string[]>([])
  useEffect(() => {
    let live = true
    setCodes([])
    if (!projectId) return
    Promise.resolve(api.get(`/api/job-costing/budget/${projectId}`))
      .then((r: any) => { if (live) setCodes(((r?.data ?? r)?.lines || []).map((l: any) => String(l.costCode))) })
      .catch(() => { /* suggestions are a convenience: a failure leaves a plain box */ })
    return () => { live = false }
  }, [api, projectId])
  const listId = 'cost-codes-' + (projectId || 'none')
  return (
    <Field label="Cost code (optional)">
      <input value={value} onChange={(e) => onChange(e.target.value)} list={listId} maxLength={60} placeholder="e.g. 06-Framing" className={inputCls} />
      <datalist id={listId}>{codes.map((c) => <option key={c} value={c} />)}</datalist>
    </Field>
  )
}

export default CostCodeField
