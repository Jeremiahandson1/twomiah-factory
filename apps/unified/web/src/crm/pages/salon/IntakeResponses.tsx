// A client's answers to the salon's intake and consent forms, on their chart (server crm/salon/intakeForms.ts GET /api/intake-forms/responses and
// /for-client; hidden feature `intake_forms`). Shown to whoever reads clients (contacts:read), as the server asks. Answers are kept as the client
// gave them: with the photos and files they attached, the signature they drew, and when an answer runs out. A form a client has not answered (or
// whose answer has run out) can be sent to them by a link, by whoever may update clients.
import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Send } from 'lucide-react'
import { api } from '../../../api'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'
import { useAuth, usePermissions, useToast } from '../../../shared'

interface Answer { label: string; type?: string; answer: string }
interface Response {
  id: string; formName: string; formKind: string; answers: Answer[]; signedName: string | null; createdAt: string
  expiresOn: string | null; expired: boolean; via: string
  files: Array<{ questionId: string; label: string; name: string; contentType: string; url: string }>; signatureUrl: string | null
}
interface Standing { formId: string; name: string; state: 'valid' | 'expired' | 'missing'; expiresOn: string | null; requested: boolean }

const VIA: Record<string, string> = { booking: 'on their booking', link: 'from a link we sent', desk: 'with us in the salon' }
/** "2026-11-30" → "Nov 30, 2026" without passing through the viewer's time zone. */
const calDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export function ClientIntakeResponses({ contactId }: { contactId: string }) {
  const { hasFeature } = useAuth()
  const { known, can } = usePermissions()
  const toast = useToast()
  const show = !!contactId && hasFeature('intake_forms') && known && can('contacts:read')
  const mayAsk = known && can('contacts:update')
  const [rows, setRows] = useState<Response[] | null>(null)
  const [standing, setStanding] = useState<Standing[]>([])
  const [busy, setBusy] = useState('')
  const load = useCallback(() => {
    api.get(`/api/intake-forms/responses?contactId=${encodeURIComponent(contactId)}`).then((r: any) => setRows((r?.data ?? r) || [])).catch(() => setRows(null))
    api.get(`/api/intake-forms/for-client?contactId=${encodeURIComponent(contactId)}`).then((r: any) => setStanding((r?.data ?? r) || [])).catch(() => setStanding([]))
  }, [contactId])
  useEffect(() => { if (show) load() }, [show, load])

  const ask = async (s: Standing) => {
    setBusy(s.formId)
    try {
      const r: any = await api.post(`/api/intake-forms/${s.formId}/send`, { audience: 'ids', contactIds: [contactId] })
      const out = r?.data ?? r
      if (out.queued) toast.success('The form is on its way to them')
      else toast.error(out.skipped?.[0]?.reason || 'The form could not be sent.')
      window.setTimeout(load, 1500)
    } catch (e: any) { toast.error(e?.message || 'The form could not be sent.') } finally { setBusy('') }
  }

  const todo = standing.filter((s) => s.state !== 'valid')
  if (!show || (!(rows && rows.length) && !standing.length)) return null
  return (
    <div className="mt-4 border-t border-gray-100 pt-4 dark:border-slate-800">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-slate-100"><ClipboardList className="h-4 w-4" aria-hidden="true" /> Forms</h3>
      {standing.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm" aria-label="Where they stand with each form">
          {standing.map((s) => (
            <li key={s.formId} className="flex flex-wrap items-center justify-between gap-2 text-gray-900 dark:text-slate-100">
              <span>{s.name}</span>
              <span className="flex items-center gap-2">
                <span className={s.state === 'valid' ? 'text-gray-600 dark:text-slate-300' : 'font-medium text-amber-800 dark:text-amber-300'}>
                  {s.state === 'valid' ? (s.expiresOn ? `Filled in — good until ${calDay(s.expiresOn)}` : 'Filled in') : s.state === 'expired' ? 'Answers have run out' : 'Not filled in'}{s.requested && s.state !== 'valid' ? ' · link sent' : ''}
                </span>
                {mayAsk && s.state !== 'valid' && <button onClick={() => ask(s)} disabled={busy === s.formId} className="flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"><Send className="h-3 w-3" aria-hidden="true" /> {s.requested ? 'Send again' : 'Send the form'}</button>}
              </span>
            </li>
          ))}
          {todo.length === 0 && <li className="text-gray-600 dark:text-slate-300">Every form that applies to them is filled in.</li>}
        </ul>
      )}
      <ul className="mt-3 space-y-3">
        {(rows || []).map((r) => (
          <li key={r.id} className="text-sm">
            <p className="font-medium text-gray-900 dark:text-slate-100">{r.formName} <span className="font-normal text-gray-600 dark:text-slate-300">— {momentDate(r.createdAt)}{r.signedName ? `, signed ${r.signedName}` : ''}{VIA[r.via] ? ` (${VIA[r.via]})` : ''}</span>
              {r.expiresOn && <span className={`ml-2 text-xs font-normal ${r.expired ? 'text-amber-800 dark:text-amber-300' : 'text-gray-600 dark:text-slate-400'}`}>{r.expired ? `ran out ${calDay(r.expiresOn)}` : `good until ${calDay(r.expiresOn)}`}</span>}
            </p>
            <dl className="mt-1 text-gray-700 dark:text-slate-300">
              {r.answers.map((a, i) => <div key={i} className="flex flex-wrap gap-x-2"><dt className="text-gray-600 dark:text-slate-400">{a.label}</dt><dd>{a.answer}</dd></div>)}
            </dl>
            {r.files.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-3" aria-label="Attached">
                {r.files.map((f, i) => (
                  <li key={i}>
                    <a href={f.url} target="_blank" rel="noreferrer" className="block text-xs text-teal-800 underline dark:text-teal-300">
                      {f.contentType === 'application/pdf' ? <span>{f.name} (PDF)</span> : <><img src={f.url} alt={f.label} className="h-20 w-20 rounded-lg border border-gray-200 object-cover dark:border-slate-700" /><span className="mt-0.5 block max-w-[5rem] truncate">{f.label}</span></>}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {r.signatureUrl && <div className="mt-2"><img src={r.signatureUrl} alt={`Signature of ${r.signedName || 'the client'}`} className="h-16 rounded border border-gray-200 bg-white dark:border-slate-700" /></div>}
          </li>
        ))}
      </ul>
    </div>
  )
}
