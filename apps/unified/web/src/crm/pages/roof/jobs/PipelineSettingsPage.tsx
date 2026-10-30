// Settings › Pipeline stages (roofing depth, gap 8; server/crm/roof/pipeline.ts, behind the not-ready feature
// pipeline_boards): what the company calls each stage, and what its Retail and Insurance boards call them.
//
// DISPLAY NAMES ONLY — a job keeps the same stage underneath, so the texts a homeowner gets at each stage, the review
// request and "paid → Collected" are exactly as before. A blank box is today's name. Saving is whoever may change the company
// (company:update, what PUT /api/roof-pipeline asks); anyone else sees the names and no Save.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../../api'
import { useMayWrite, useToast, errorText } from '../../../../shared'
import { setPipelineNames } from './model'
import type { PipelineNames } from './model'

type BoardId = 'retail' | 'insurance'
interface Reply extends PipelineNames {
  stages: Array<{ key: string; defaultLabel: string }>
  overrides: Record<string, string>
  boards: Array<{ id: BoardId; name: string; defaultName: string; stageLabels: Record<string, string>; overrides: Record<string, string> }>
}
type Form = { company: Record<string, string>; boards: Record<BoardId, { name: string; labels: Record<string, string> }> }

const formOf = (r: Reply): Form => ({
  company: { ...r.overrides },
  boards: Object.fromEntries(r.boards.map((b) => [b.id, { name: b.name === b.defaultName ? '' : b.name, labels: { ...b.overrides } }])) as Form['boards'],
})

const INPUT = 'w-full text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900 disabled:opacity-60'

export default function PipelineSettingsPage() {
  const maySave = useMayWrite('company:update')
  const toast = useToast()
  const [reply, setReply] = useState<Reply | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try { const r = await api.get('/api/roof-pipeline') as Reply; setReply(r); setForm(formOf(r)) } catch { setFailed(true) }
  }, [])
  useEffect(() => { load() }, [load])

  if (failed) return <div className="p-6 text-sm text-red-600">The pipeline names could not be loaded. Try again.</div>
  if (!reply || !form) return <div className="p-6 text-sm text-gray-500">Loading…</div>

  const save = async () => {
    setSaving(true)
    try {
      const r = await api.put('/api/roof-pipeline', {
        stageLabels: form.company,
        boards: Object.fromEntries((['retail', 'insurance'] as BoardId[]).map((id) => [id, { name: form.boards[id].name, stageLabels: form.boards[id].labels }])),
      }) as Reply
      setReply(r); setForm(formOf(r)); setPipelineNames(r)
      toast.success('Pipeline names saved')
    } catch (e) { toast.error(errorText(e, 'Could not save the names')) } finally { setSaving(false) }
  }
  const setCompany = (key: string, v: string) => setForm({ ...form, company: { ...form.company, [key]: v } })
  const setBoard = (id: BoardId, patch: Partial<Form['boards'][BoardId]>) => setForm({ ...form, boards: { ...form.boards, [id]: { ...form.boards[id], ...patch } } })

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Pipeline stages</h1>
        <p className="text-sm text-gray-600 dark:text-slate-400 mt-1 max-w-prose">
          Rename the stages your jobs move through. Only the name changes: the texts your homeowners get at each stage, the review request and
          “paid means Collected” work exactly as before. Leave a box empty to keep the standard name. A board’s own name for a stage is used for that board’s
          jobs only (insurance jobs on the Insurance board, everything else on Retail).
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-slate-400 border-b">
              <th className="p-3 font-medium">Stage</th>
              <th className="p-3 font-medium">Everywhere</th>
              {reply.boards.map((b) => (
                <th key={b.id} className="p-3 font-medium">
                  <input aria-label={`${b.defaultName} board name`} className={INPUT} disabled={!maySave} placeholder={`${b.defaultName} board`} maxLength={30}
                    value={form.boards[b.id].name} onChange={(e) => setBoard(b.id, { name: e.target.value })} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reply.stages.map((s) => (
              <tr key={s.key} className="border-b last:border-0">
                <td className="p-3 text-gray-700 dark:text-slate-200 whitespace-nowrap">{s.defaultLabel}</td>
                <td className="p-3">
                  <input aria-label={`Name for ${s.defaultLabel}`} className={INPUT} disabled={!maySave} placeholder={s.defaultLabel} maxLength={40}
                    value={form.company[s.key] ?? ''} onChange={(e) => setCompany(s.key, e.target.value)} />
                </td>
                {reply.boards.map((b) => (
                  <td key={b.id} className="p-3">
                    <input aria-label={`${b.defaultName} board name for ${s.defaultLabel}`} className={INPUT} disabled={!maySave} maxLength={40}
                      placeholder={form.company[s.key] || s.defaultLabel}
                      value={form.boards[b.id].labels[s.key] ?? ''} onChange={(e) => setBoard(b.id, { labels: { ...form.boards[b.id].labels, [s.key]: e.target.value } })} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {maySave
        ? <button type="button" onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save names'}</button>
        : <p className="text-sm text-gray-500 dark:text-slate-400">Only the owner or an admin can change these names.</p>}
    </div>
  )
}
