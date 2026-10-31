// A checklist through the job's life, on the screens that already exist (server crm/field/checklistLife.ts):
//   · beside a job: the banner naming what stands between the job and "Complete", each checklist's state, and for a finished
//     one its PDF and an email to the customer;
//   · beside an invoice: the checklists attached to it (they go out with the invoice email) and the finished ones that could be;
//   · in the Job Checklists page: the report of who got which checklist done.
// All three are the feature `job_checklists` (not ready) and the same permissions as their API.
import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck, Download, Mail, Paperclip, X } from 'lucide-react'
import { api } from '../api'
import { useAuth, useToast, usePermissions } from '../shared'
import { downloadFile } from '@twomiah/tenant-ui/src/invoicing/ui'

const card = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900'
const ghost = 'inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800'
const said = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

interface Outstanding { templateId: string; name: string; why: string; required: boolean }
interface Sub { id: string; templateId: string; status: string; signed?: boolean }
interface JobView { templates: Array<{ id: string; name: string }>; submissions: Sub[]; outstanding: Outstanding[] }
const STATE: Record<string, string> = { submitted: 'Done', signed: 'Done and signed', awaiting_signature: 'Needs the customer to sign' }

/** Beside a job. Nothing when the business does not use job checklists or the job has none. */
export function JobChecklistsPanel({ job }: { job: Record<string, any> }) {
  const { hasFeature } = useAuth()
  const { can, known } = usePermissions()
  const toast = useToast()
  const on = hasFeature('job_checklists') && (!known || can('jobs:read'))
  const mayUpdate = !known || can('jobs:update')
  const [view, setView] = useState<JobView | null>(null)
  const [busy, setBusy] = useState('')
  const load = useCallback(() => { api.get(`/api/checklists/job/${job.id}`).then((r: any) => setView(r)).catch(() => setView(null)) }, [job.id])
  useEffect(() => { if (on && job?.id) load() }, [on, job?.id, load, job?.status])
  if (!on || !view || !view.templates.length) return null

  const must = view.outstanding.filter((o) => o.required)
  const names = new Map(view.templates.map((t) => [t.id, t.name]))
  const finished = view.submissions.filter((s) => s.status === 'submitted' || s.status === 'signed')
  const pdf = async (s: Sub) => { setBusy(s.id); try { await downloadFile(`/api/checklists/submissions/${s.id}/pdf`, `${names.get(s.templateId) || 'checklist'}.pdf`) } catch (e) { toast.error(said(e, 'The PDF could not be downloaded')) } finally { setBusy('') } }
  const mail = async (s: Sub) => {
    setBusy(s.id)
    try { const r: any = await api.post(`/api/checklists/submissions/${s.id}/email`, {}); toast.success(`Sent to ${r?.sentTo ?? 'the customer'}`) }
    catch (e) { toast.error(said(e, 'The email could not be sent')) } finally { setBusy('') }
  }
  return (
    <section className={card} aria-label="Checklists on this job">
      <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-slate-100"><ClipboardCheck className="h-5 w-5" aria-hidden />Checklists</h2>
      {job.status !== 'completed' && must.length > 0 && (
        <div role="alert" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          This job can’t be completed until {must.map((o) => `“${o.name}” ${o.why.startsWith('needs') ? o.why : `is ${o.why}`}`).join(', ')}.
        </div>
      )}
      <ul className="grid gap-2 text-sm text-gray-900 dark:text-slate-100">
        {view.outstanding.map((o) => (
          <li key={o.templateId} className="flex flex-wrap items-center justify-between gap-2">
            <span>{o.name}</span>
            <span className="text-gray-700 dark:text-slate-300">{o.why === 'needs the customer to sign' ? 'Needs the customer to sign' : 'Not filled in yet'}{o.required ? '' : ' (optional)'}</span>
          </li>
        ))}
        {finished.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{names.get(s.templateId) || 'Checklist'} <span className="text-gray-700 dark:text-slate-300">· {STATE[s.status] ?? 'Done'}</span></span>
            <span className="flex gap-2">
              <button type="button" className={ghost} disabled={busy === s.id} onClick={() => pdf(s)}><Download className="h-4 w-4" aria-hidden />PDF</button>
              {mayUpdate && <button type="button" className={ghost} disabled={busy === s.id} onClick={() => mail(s)}><Mail className="h-4 w-4" aria-hidden />Email to customer</button>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

interface InvoiceView { attached: Array<{ id: string; name: string }>; available: Array<{ submissionId: string; name: string }> }

/** Beside an invoice: the checklists attached to it, and the finished ones from its job that can be. */
export function InvoiceChecklistsPanel({ invoiceId }: { invoiceId: string }) {
  const { hasFeature } = useAuth()
  const { can, known } = usePermissions()
  const toast = useToast()
  const on = hasFeature('job_checklists') && (!known || can('invoices:read'))
  const mayEdit = !known || can('invoices:update')
  const [view, setView] = useState<InvoiceView | null>(null)
  const [busy, setBusy] = useState('')
  const load = useCallback(() => { api.get(`/api/checklists/invoice/${invoiceId}`).then((r: any) => setView(r)).catch(() => setView(null)) }, [invoiceId])
  useEffect(() => { if (on) load() }, [on, load])
  if (!on || !view || (!view.attached.length && !view.available.length)) return null
  const attach = async (submissionId: string) => {
    setBusy(submissionId)
    try { await api.post(`/api/checklists/submissions/${submissionId}/attach`, { invoiceId }); toast.success('Attached — it goes out with the invoice email'); load() }
    catch (e) { toast.error(said(e, 'It could not be attached')) } finally { setBusy('') }
  }
  const detach = async (id: string) => {
    setBusy(id)
    try { await api.delete(`/api/checklists/attached/${id}`); load() } catch (e) { toast.error(said(e, 'It could not be removed')) } finally { setBusy('') }
  }
  return (
    <section className={card} aria-label="Checklists on this invoice">
      <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-slate-100"><Paperclip className="h-5 w-5" aria-hidden />Checklists</h2>
      <ul className="grid gap-2 text-sm text-gray-900 dark:text-slate-100">
        {view.attached.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="text-blue-800 underline dark:text-blue-300" onClick={() => downloadFile(`/api/checklists/attached/${a.id}/file`, `${a.name}.pdf`).catch((e) => toast.error(said(e, 'The PDF could not be downloaded')))}>{a.name} (attached)</button>
            {mayEdit && <button type="button" aria-label={`Remove ${a.name} from this invoice`} className={ghost} disabled={busy === a.id} onClick={() => detach(a.id)}><X className="h-4 w-4" aria-hidden />Remove</button>}
          </li>
        ))}
        {view.available.map((a) => (
          <li key={a.submissionId} className="flex flex-wrap items-center justify-between gap-2">
            <span>{a.name}</span>
            {mayEdit && <button type="button" className={ghost} disabled={busy === a.submissionId} onClick={() => attach(a.submissionId)}><Paperclip className="h-4 w-4" aria-hidden />Attach to this invoice</button>}
          </li>
        ))}
      </ul>
    </section>
  )
}

interface ReportData {
  byChecklist: Array<{ templateId: string; name: string; added: number; filled: number; waitingSignature: number; notFilled: number }>
  notDone: Array<{ jobId: string; number: string | null; title: string; checklist: string; why: string; completedOn: string | null }>
}

/** The checklists report: per checklist, and the jobs that are done with a checklist still open. */
export function ChecklistReport() {
  const { can, known } = usePermissions()
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [data, setData] = useState<ReportData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (known && !can('reports:read')) return
    const q = new URLSearchParams(); if (start) q.set('startDate', start); if (end) q.set('endDate', end)
    api.get(`/api/checklists/report${q.toString() ? `?${q}` : ''}`).then((r: any) => { setData(r); setError('') }).catch((e: unknown) => { setData(null); setError(said(e, 'The report could not be loaded')) })
  }, [start, end, known, can])
  if (known && !can('reports:read')) return null
  const field = 'rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
  return (
    <section className={card} aria-label="Checklist report">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Report</h2>
        <div className="flex flex-wrap gap-2 text-sm text-gray-800 dark:text-slate-200">
          <label className="grid gap-1">From<input type="date" className={field} value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="grid gap-1">To<input type="date" className={field} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-300">{error}</p>}
      {data && (
        <div className="mt-3 grid gap-4 text-sm text-gray-900 dark:text-slate-100">
          {data.byChecklist.length === 0 ? <p className="text-gray-700 dark:text-slate-300">No jobs in this period have a checklist yet.</p> : (
            <table className="w-full text-left">
              <thead><tr className="text-gray-700 dark:text-slate-300"><th className="py-1 pr-2">Checklist</th><th className="pr-2">On jobs</th><th className="pr-2">Done</th><th className="pr-2">Needs signature</th><th>Not filled in</th></tr></thead>
              <tbody>{data.byChecklist.map((r) => <tr key={r.templateId} className="border-t border-gray-200 dark:border-slate-700"><td className="py-1 pr-2">{r.name}</td><td className="pr-2">{r.added}</td><td className="pr-2">{r.filled}</td><td className="pr-2">{r.waitingSignature}</td><td>{r.notFilled}</td></tr>)}</tbody>
            </table>
          )}
          <div>
            <h3 className="mb-1 font-semibold">Done jobs with a checklist still open</h3>
            {data.notDone.length === 0 ? <p className="text-gray-700 dark:text-slate-300">None.</p> : (
              <ul className="grid gap-1">{data.notDone.map((n, i) => <li key={`${n.jobId}-${i}`}>{n.number ? `${n.number} · ` : ''}{n.title} — “{n.checklist}”: {n.why}{n.completedOn ? ` (done ${n.completedOn})` : ''}</li>)}</ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
