// Visit messages (landscaping parity rows 26 and 31; visit_message_tools and visit_survey, both not ready): the office's side of the
// visit-done message — Yardbook shows "Email Notification Sent" with the date, clickable, and lets the office edit the wording and skip
// a service; Jobber adds the customer's rating.
//
//   GET  /api/visit-reports                    every visit's message: sent / queued / skipped / couldn't reach / failed, when, how,
//                                              the copy the customer got, their rating          (jobs:read; a crew seat sees its own)
//   GET  /api/visit-reports/job/:id/preview    what they would get now, nothing sent            (jobs:dispatch)
//   POST /api/visit-reports/job/:id/send       send (again) now                                  (jobs:update + jobs:dispatch)
//   GET|PUT /api/visit-reports/settings        the wording with {placeholders}, services never messaged, the rating alert line
//                                              (PUT: settings:update)
// A route stop's own "no visit message" is on the Route Board.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageSquareText, Send, Eye, Star, Settings2 } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useConfirm, useMayWrite, useAuth } from '../../../shared'
import { whenDate } from '@twomiah/tenant-ui/src/time/companyClock'

const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback
const when = (v: string | null | undefined) => (v ? whenDate(v, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

const STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Not sent yet', tone: 'text-gray-600 dark:text-slate-300' },
  queued: { label: 'Waiting to send', tone: 'text-blue-700 dark:text-blue-300' },
  sent: { label: 'Sent', tone: 'text-green-700 dark:text-green-400' },
  skipped: { label: 'Not messaged', tone: 'text-gray-600 dark:text-slate-300' },
  nothing: { label: 'Could not reach them', tone: 'text-amber-700 dark:text-amber-300' },
  failed: { label: 'Failed', tone: 'text-red-700 dark:text-red-400' },
}
const CHANNEL: Record<string, string> = { text: 'by text', email: 'by email' }

interface Report {
  id: string; jobId: string; title: string | null; number: string | null; customer: string | null; completedAt: string | null
  status: string; channel: string | null; sendAt: string | null; sentAt: string | null; error: string | null; photoCount: number; skip: boolean
  note: string | null; messageSubject: string | null; messageText: string | null
  rating: number | null; ratingComment: string | null; ratedAt: string | null
}
interface Preview { channel: 'text' | 'email' | null; to: string | null; skip: string | null; photos: number; subject: string; text: string; email: string; note: string | null }
interface Settings {
  text: string; subject: string; email: string; custom: { text: boolean; subject: boolean; email: boolean }
  skipServices: string[]; alertBelow: number; placeholders: string[]; defaults: { text: string; subject: string; email: string }; limits: { text: number; subject: number; email: number }
}

function Stars({ n }: { n: number }) {
  return <span className="inline-flex items-center gap-0.5" aria-label={`${n} of 5`}>{[1, 2, 3, 4, 5].map((i) => <Star key={i} aria-hidden="true" className={`w-3.5 h-3.5 ${i <= n ? 'fill-amber-400 text-amber-400' : 'text-gray-300 dark:text-slate-600'}`} />)}</span>
}

function WordingSettings({ survey }: { survey: boolean }) {
  const toast = useToast()
  const mayEdit = useMayWrite('settings:update')
  const [s, setS] = useState<Settings | null>(null)
  const [form, setForm] = useState({ text: '', subject: '', email: '', skipServices: '', alertBelow: '3' })
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/visit-reports/settings') as Settings
      setS(r)
      setForm({ text: r.text, subject: r.subject, email: r.email, skipServices: (r.skipServices || []).join(', '), alertBelow: String(r.alertBelow) })
    } catch (e) { toast.error(errorText(e, 'Could not load the message wording')) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  if (!s) return <p className="text-sm text-gray-500 dark:text-slate-400"><Loader2 className="inline w-4 h-4 animate-spin mr-1" />Loading…</p>
  const save = async () => {
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        text: form.text === s.defaults.text ? null : form.text, subject: form.subject === s.defaults.subject ? null : form.subject,
        email: form.email === s.defaults.email ? null : form.email,
        skipServices: form.skipServices.split(',').map((x) => x.trim()).filter(Boolean),
      }
      if (survey) body.alertBelow = Number(form.alertBelow)
      await api.put('/api/visit-reports/settings', body)
      toast.success('Message wording saved')
      await load()
    } catch (e) { toast.error(errorText(e, 'Could not save the wording')) }
    finally { setBusy(false) }
  }
  const field = 'input w-full'
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-slate-300">
        Words in braces are filled in for each visit: {s.placeholders.map((p) => <code key={p} className="mx-0.5 rounded bg-gray-100 px-1 dark:bg-slate-700">{`{${p}}`}</code>)}.
        {survey ? ' Without {feedback_link}, the rating link goes at the end of the text.' : ''} Clear a box to go back to our words.
      </p>
      <label className="block text-sm font-medium">Text message
        <textarea className={`${field} mt-1`} rows={3} maxLength={s.limits.text} value={form.text} disabled={!mayEdit} onChange={(e) => setForm({ ...form, text: e.target.value })} />
      </label>
      <label className="block text-sm font-medium">Email subject
        <input className={`${field} mt-1`} maxLength={s.limits.subject} value={form.subject} disabled={!mayEdit} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
      </label>
      <label className="block text-sm font-medium">Email opening (the crew’s note and the photos follow it)
        <textarea className={`${field} mt-1`} rows={4} maxLength={s.limits.email} value={form.email} disabled={!mayEdit} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </label>
      <label className="block text-sm font-medium">Services never messaged (a route stop’s service, separated by commas)
        <input className={`${field} mt-1`} placeholder="e.g. aeration, fertilization" value={form.skipServices} disabled={!mayEdit} onChange={(e) => setForm({ ...form, skipServices: e.target.value })} />
      </label>
      {survey && (
        <label className="block text-sm font-medium">Email the office when a rating is under
          <select className="input mt-1 ml-2" value={form.alertBelow} disabled={!mayEdit} onChange={(e) => setForm({ ...form, alertBelow: e.target.value })}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 1 ? 'Never' : `${n} of 5`}</option>)}
          </select>
        </label>
      )}
      {mayEdit && <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save wording'}</button>}
    </div>
  )
}

export default function VisitMessagesPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const { hasFeature } = useAuth()
  const on = hasFeature('visit_reports') && hasFeature('visit_message_tools')
  const survey = hasFeature('visit_survey')
  const mayDispatch = useMayWrite('jobs:dispatch')
  const maySend = useMayWrite('jobs:update') && mayDispatch
  const [rows, setRows] = useState<Report[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [preview, setPreview] = useState<Record<string, Preview>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<'list' | 'wording'>('list')
  // The business's alert line (Wording › "Email the office when a rating is under"): a rating under it is flagged here too
  // (landscaping live test 11/08: a 2 of 5 showed only as small stars).
  const [alertBelow, setAlertBelow] = useState(3)
  useEffect(() => { if (on && survey) api.get('/api/visit-reports/settings').then((r: any) => { if (Number(r?.alertBelow)) setAlertBelow(Number(r.alertBelow)) }).catch(() => {}) }, [on, survey])

  const load = useCallback(async () => {
    try { const r: any = await api.get('/api/visit-reports?limit=200'); setRows(Array.isArray(r?.data) ? r.data : []) }
    catch (e) { toast.error(errorText(e, 'Could not load the visit messages')); setRows([]) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (on) load() }, [on, load])
  if (!on) return <div className="p-6 text-gray-600 dark:text-slate-300">Visit messages are not turned on for this business.</div>

  const showPreview = async (r: Report) => {
    setBusy(r.jobId)
    try { const p = await api.get(`/api/visit-reports/job/${r.jobId}/preview`) as Preview; setPreview((x) => ({ ...x, [r.jobId]: p })) }
    catch (e) { toast.error(errorText(e, 'Could not show the preview')) }
    finally { setBusy(null) }
  }
  const sendNow = async (r: Report) => {
    const again = r.status === 'sent' || r.status === 'queued'
    if (again && !(await confirm('The customer gets the message a second time.', { title: 'Send it again?', confirmText: 'Send again' }))) return
    setBusy(r.jobId)
    try {
      const out: any = await api.post(`/api/visit-reports/job/${r.jobId}/send`, {})
      toast.success(out?.status === 'queued' ? 'Queued — the text goes out in the sending hours' : 'Sent')
      await load()
    } catch (e) { toast.error(errorText(e, 'Could not send the message')) }
    finally { setBusy(null) }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><MessageSquareText className="w-6 h-6" /> Visit messages</h1>
        <div className="flex gap-1" role="tablist">
          <button role="tab" aria-selected={tab === 'list'} className={`btn ${tab === 'list' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('list')}>Messages</button>
          <button role="tab" aria-selected={tab === 'wording'} className={`btn ${tab === 'wording' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('wording')}><Settings2 className="inline w-4 h-4 mr-1" />Wording</button>
        </div>
      </div>

      {tab === 'wording' ? <WordingSettings survey={survey} /> : rows === null ? (
        <p className="text-gray-500 dark:text-slate-400"><Loader2 className="inline w-4 h-4 animate-spin mr-1" />Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500 dark:text-slate-400">No visit messages yet. One is made when a visit is finished.</p>
      ) : (
        <>
        {survey && rows.some((r) => r.rating != null && r.rating < alertBelow) && (
          <div role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
            <p className="font-semibold">Low ratings (under {alertBelow} of 5)</p>
            <ul className="mt-1 list-disc pl-5">
              {rows.filter((r) => r.rating != null && r.rating < alertBelow).map((r) => (
                <li key={r.id}><button type="button" className="underline" onClick={() => setOpen(r.id)}>{r.customer || 'A customer'} · {r.title || 'Visit'}{r.number ? ` #${r.number}` : ''}</button>: {r.rating} of 5{r.ratingComment ? ` — “${r.ratingComment}”` : ''}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="divide-y rounded border dark:divide-slate-700 dark:border-slate-700">
          {rows.map((r) => {
            const st = STATUS[r.status] || { label: 'Unknown', tone: '' }
            const isOpen = open === r.id
            const p = preview[r.jobId]
            return (
              <div key={r.id} className="p-3">
                <button className="w-full text-left flex flex-wrap items-center justify-between gap-2" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                  <span>
                    <span className="font-medium">{r.customer || 'No customer'}</span>
                    <span className="text-gray-500 dark:text-slate-400"> · {r.title || 'Visit'}{r.number ? ` #${r.number}` : ''}{r.completedAt ? ` · done ${when(r.completedAt)}` : ''}</span>
                  </span>
                  <span className="flex items-center gap-3 text-sm">
                    {r.rating != null && <span className="inline-flex items-center gap-1"><Stars n={r.rating} /><span>{r.rating} of 5</span>{r.rating < alertBelow && <span className="rounded bg-red-100 px-1.5 text-xs font-semibold text-red-800 dark:bg-red-950/60 dark:text-red-200">Low rating</span>}</span>}
                    <span className={st.tone}>{st.label}{r.channel && (r.status === 'sent' || r.status === 'queued') ? ` ${CHANNEL[r.channel] || ''}` : ''}{r.status === 'sent' && r.sentAt ? ` · ${when(r.sentAt)}` : r.status === 'queued' && r.sendAt ? ` · ${when(r.sendAt)}` : ''}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="mt-3 space-y-3 text-sm">
                    {r.error && <p className="text-red-700 dark:text-red-400" role="alert">{r.error}</p>}
                    {r.messageText ? (
                      <div className="rounded bg-gray-50 p-3 dark:bg-slate-800">
                        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">What the customer got{r.photoCount ? ` (with ${r.photoCount} photo${r.photoCount === 1 ? '' : 's'})` : ''}</p>
                        {r.channel === 'email' && r.messageSubject && <p className="font-medium mb-1">{r.messageSubject}</p>}
                        <p className="whitespace-pre-wrap">{r.messageText}</p>
                      </div>
                    ) : r.status === 'sent' || r.status === 'queued' ? <p className="text-gray-500 dark:text-slate-400">This message was sent before copies were kept.</p> : null}
                    {r.rating != null && (
                      <div className="rounded border border-amber-200 p-3 dark:border-amber-800">
                        <p className="flex items-center gap-2"><Stars n={r.rating} /> <span>{r.rating} of 5{r.ratedAt ? ` · ${when(r.ratedAt)}` : ''}</span></p>
                        {r.ratingComment && <p className="mt-1 whitespace-pre-wrap">“{r.ratingComment}”</p>}
                      </div>
                    )}
                    {p && (
                      <div className="rounded border border-dashed p-3 dark:border-slate-600">
                        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">Preview — nothing sent</p>
                        {p.skip ? <p className="text-amber-700 dark:text-amber-300">{p.skip}</p> : !p.channel ? <p className="text-amber-700 dark:text-amber-300">No way to reach this customer: no phone or email, or they opted out.</p> : (
                          <>
                            <p className="text-gray-500 dark:text-slate-400">{CHANNEL[p.channel]} to {p.to}{p.photos ? ` · ${p.photos} photo${p.photos === 1 ? '' : 's'}` : ''}</p>
                            {p.channel === 'email' && <p className="font-medium mt-1">{p.subject}</p>}
                            <p className="whitespace-pre-wrap mt-1">{p.channel === 'email' ? [p.email, p.note].filter(Boolean).join('\n\n') : p.text}</p>
                          </>
                        )}
                      </div>
                    )}
                    {mayDispatch && (
                      <div className="flex flex-wrap gap-2">
                        <button className="btn btn-secondary" disabled={busy === r.jobId} onClick={() => showPreview(r)}><Eye className="inline w-4 h-4 mr-1" />Preview</button>
                        {maySend && !r.skip && r.status !== 'skipped' && (
                          <button className="btn btn-primary" disabled={busy === r.jobId} onClick={() => sendNow(r)}><Send className="inline w-4 h-4 mr-1" />{r.status === 'sent' || r.status === 'queued' ? 'Send again' : 'Send now'}</button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        </>
      )}
    </div>
  )
}
