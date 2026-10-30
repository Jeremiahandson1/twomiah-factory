// Settings › Automatic messages (server crm/salon/retention.ts, /api/retention; hidden feature `retention_sends`):
// rebooking on the due date, birthdays, win-back, a "book your next visit" prompt after a visit, and the follow-up sequences a visit starts.
// Every part is off until the owner switches it on, and nothing from before that moment is ever sent. A text goes only to a number that agreed to
// be texted and never to one that replied STOP; otherwise an email with its unsubscribe link; nothing goes in quiet hours.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, MessageSquareText } from 'lucide-react'
import { api } from '../../../api'
import { useToast, usePermissions } from '../../../shared'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const hint = 'mt-1 text-sm text-gray-600 dark:text-slate-300'
const fieldClass = 'mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

type Kind = 'rebook' | 'birthday' | 'win_back' | 'next_visit'
interface Settings {
  rebook: boolean; birthday: boolean; winBack: boolean; nextVisit: boolean; drips: boolean
  winBackDays: number; quietStart: string; quietEnd: string; since: string | null; templates: Partial<Record<Kind, string>>
}
interface LogRow { id: string; kind: string; channel: string | null; status: string; reason: string | null; createdAt: string; clientName: string | null }
interface Preview { quiet: boolean; wouldSend: Array<{ client: string | null; kind: string; via: string }> }

const PARTS: Array<{ key: 'rebook' | 'birthday' | 'winBack' | 'nextVisit' | 'drips'; kind?: Kind; title: string; words: string }> = [
  { key: 'rebook', kind: 'rebook', title: 'Rebook on the due date', words: 'When a client is due back for a service (the rebook rhythm on your Service Menu), they are sent a message with your booking link.' },
  { key: 'birthday', kind: 'birthday', title: 'Birthday', words: 'On the day, once a year, for clients with a birthday on their chart.' },
  { key: 'winBack', kind: 'win_back', title: 'Win back a lapsed client', words: 'When a client has not been in for the number of days below. Not sent to a client who has an appointment booked.' },
  { key: 'nextVisit', kind: 'next_visit', title: 'Book your next visit', words: 'Shortly after a visit is completed, a prompt to book the next one. Not sent to a client who already has an appointment booked.' },
  { key: 'drips', title: 'Start my follow-up sequences', words: 'A completed visit, or a lapse, starts your own follow-up sequences (Marketing › Sequences) that are set to begin on it. Email only.' },
]
const KIND_WORDS: Record<string, string> = { rebook: 'Rebook', birthday: 'Birthday', win_back: 'Win-back', next_visit: 'Next visit', drip_visit_completed: 'Follow-up after a visit', drip_lapsed: 'Follow-up after a lapse' }

export default function AutomaticMessagesSettingsPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = known && can('company:update')
  const [s, setS] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [log, setLog] = useState<LogRow[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState('')

  const load = useCallback(() => {
    api.get('/api/retention/settings').then((r: Settings) => { setS(r); setDraft(r) }).catch((e: Error) => setLoadError(e.message || 'The settings could not be loaded.'))
    api.get('/api/retention/log').then((r: any) => setLog(((r?.data ?? r) || []).slice(0, 50))).catch(() => setLog([]))
  }, [])
  useEffect(load, [load])

  if (loadError) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div>
  if (!s || !draft) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const save = async () => {
    setSaving(true); setErrors({})
    try {
      const r: Settings = await api.put('/api/retention/settings', {
        rebook: draft.rebook, birthday: draft.birthday, winBack: draft.winBack, nextVisit: draft.nextVisit, drips: draft.drips,
        winBackDays: Number(draft.winBackDays), quietStart: draft.quietStart, quietEnd: draft.quietEnd,
        templates: { rebook: draft.templates.rebook || '', birthday: draft.templates.birthday || '', win_back: draft.templates.win_back || '', next_visit: draft.templates.next_visit || '' },
      })
      setS(r); setDraft(r); setPreview(null)
      toast.success('Automatic messages saved')
    } catch (e: any) {
      setErrors(e?.data?.fields || {})
      toast.error(e?.message || 'The settings could not be saved.')
    } finally { setSaving(false) }
  }
  const dirty = JSON.stringify(s) !== JSON.stringify(draft)
  const check = async () => {
    try { setPreview(await api.post('/api/retention/run', { dryRun: true })) } catch (e: any) { toast.error(e?.message || 'The preview could not be made.') }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/crm/settings" className="text-sm text-gray-600 hover:underline dark:text-slate-300">Settings</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><MessageSquareText className="h-6 w-6 text-teal-700 dark:text-teal-300" aria-hidden="true" /> Automatic messages</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">Messages that go out by themselves to bring clients back. Everything here is off until you switch it on.</p>
      </div>
      {!mayEdit && <p className="text-sm text-gray-700 dark:text-slate-300">You can see these settings. Only an owner or admin can change them.</p>}

      <section className={box} aria-label="What is sent">
        <div className="space-y-4">
          {PARTS.map((p) => (
            <div key={p.key}>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
                <input type="checkbox" className="h-4 w-4" checked={draft[p.key]} disabled={!mayEdit} onChange={(e) => setDraft({ ...draft, [p.key]: e.target.checked })} /> {p.title}
              </label>
              <p className={hint}>{p.words}</p>
              {p.key === 'winBack' && draft.winBack && (
                <label className="mt-2 block text-sm font-medium text-gray-900 dark:text-slate-100">Days since their last visit
                  <input type="number" min={30} max={730} value={draft.winBackDays} disabled={!mayEdit} onChange={(e) => setDraft({ ...draft, winBackDays: Number(e.target.value) })} className={fieldClass + ' max-w-[8rem]'} aria-invalid={!!errors.winBackDays} />
                  {errors.winBackDays && <span role="alert" className="block text-xs text-red-700 dark:text-red-300">{errors.winBackDays}</span>}
                </label>
              )}
              {p.kind && draft[p.key] && (
                <label className="mt-2 block text-sm font-medium text-gray-900 dark:text-slate-100">Your own words (optional)
                  <textarea rows={2} maxLength={320} value={draft.templates[p.kind] || ''} disabled={!mayEdit} onChange={(e) => setDraft({ ...draft, templates: { ...draft.templates, [p.kind!]: e.target.value } })} className={fieldClass} placeholder="Leave empty to use the standard message." />
                  <span className="block text-xs font-normal text-gray-600 dark:text-slate-400">You can use {'{firstName}'}, {'{salon}'}, {'{service}'} and {'{link}'}.</span>
                </label>
              )}
            </div>
          ))}
          {errors.templates && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{errors.templates}</p>}
        </div>
      </section>

      <section className={box} aria-label="Quiet hours">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Quiet hours</h2>
        <p className={hint}>Nothing is sent between these times, by your salon&rsquo;s clock. It waits and goes out afterwards.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-900 dark:text-slate-100">
          <input aria-label="Quiet hours start" type="time" value={draft.quietStart} disabled={!mayEdit} onChange={(e) => setDraft({ ...draft, quietStart: e.target.value })} className={fieldClass + ' max-w-[9rem] mt-0'} />
          <span>to</span>
          <input aria-label="Quiet hours end" type="time" value={draft.quietEnd} disabled={!mayEdit} onChange={(e) => setDraft({ ...draft, quietEnd: e.target.value })} className={fieldClass + ' max-w-[9rem] mt-0'} />
        </div>
        {(errors.quietStart || errors.quietEnd) && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">{errors.quietStart || errors.quietEnd}</p>}
      </section>

      <section className={box} aria-label="Who is messaged">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Who is messaged, and how</h2>
        <ul className={hint + ' list-disc pl-5'}>
          <li>A <strong>text</strong> goes only to a client who agreed to be texted (the &ldquo;Text me&rdquo; box when they book online, or by texting you first) and never to one who replied STOP. Every text ends with &ldquo;Reply STOP to opt out.&rdquo;</li>
          <li>Anyone else with an email address gets an <strong>email</strong> with an unsubscribe link, unless they have unsubscribed.</li>
          <li>A client is sent one rebooking, birthday or win-back message a week at most, and each thing once.</li>
          <li>Nothing from before you switched a part on is sent.</li>
        </ul>
      </section>

      {mayEdit && (
        <div className="flex flex-wrap gap-2">
          <button onClick={save} disabled={saving || !dirty} className="flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-white hover:bg-teal-800 disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Save</button>
          <button onClick={check} disabled={dirty} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800">Who would be messaged now?</button>
        </div>
      )}
      {preview && (
        <section className={box} aria-label="Preview">
          <p className="text-sm text-gray-900 dark:text-slate-100">{preview.wouldSend.length === 0 ? 'Nobody would be messaged right now.' : `${preview.wouldSend.length} message${preview.wouldSend.length === 1 ? '' : 's'} would go out${preview.quiet ? ' once quiet hours end' : ' on the next pass'}. Nothing was sent.`}</p>
          <ul className="mt-2 text-sm text-gray-700 dark:text-slate-300">{preview.wouldSend.map((w, i) => <li key={i}>{w.client || 'A client'} — {KIND_WORDS[w.kind] || w.kind}, by {w.via === 'sms' ? 'text' : w.via}</li>)}</ul>
        </section>
      )}

      <section className={box} aria-label="What went out">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">What went out</h2>
        {log.length === 0 ? <p className={hint}>Nothing yet.</p> : (
          <ul className="mt-2 divide-y divide-gray-100 text-sm dark:divide-slate-800">
            {log.map((l) => (
              <li key={l.id} className="py-2 text-gray-900 dark:text-slate-100">
                <span className="font-medium">{l.clientName || 'A client'}</span> — {KIND_WORDS[l.kind] || l.kind}, {l.status === 'sent' ? `sent by ${l.channel === 'sms' ? 'text' : l.channel === 'drip' ? 'a follow-up sequence' : 'email'}` : l.status === 'skipped' ? 'not sent' : 'failed'}
                <span className="text-gray-600 dark:text-slate-400"> · {momentDate(l.createdAt)}</span>
                {l.reason && <span className="block text-xs text-gray-600 dark:text-slate-400">{l.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
