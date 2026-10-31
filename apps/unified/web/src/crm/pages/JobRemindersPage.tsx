// Settings › Job Reminders (server crm/field/jobReminders.ts, /api/job-reminders/settings): the reminder text and email sent
// before a job the office booked. Every word here is what the engine does — nothing is a promise the pass does not keep.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellRing, Loader2, Plus, X } from 'lucide-react'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

interface Rules {
  enabled: boolean
  hoursBefore: number[]
  sms: boolean
  email: boolean
  sendFromHour: number
  sendUntilHour: number
  message: string
  maxMessage: number
  maxEmailBody: number
  variables: string[]
  timing: 'hours_before' | 'fixed_time'
  fixed: Array<{ daysBefore: number; time: string }>
  emailSubject: string
  emailBody: string
  askConfirm: boolean
  movedMessage: string
}
type Form = {
  enabled: boolean; hoursBefore: string[]; sms: boolean; email: boolean; sendFromHour: string; sendUntilHour: string; message: string
  timing: 'hours_before' | 'fixed_time'; fixed: Array<{ daysBefore: string; time: string }>
  emailSubject: string; emailBody: string; askConfirm: boolean; movedMessage: string
}

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const field = 'mt-1 w-full max-w-[12rem] rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const label = 'block text-sm font-medium text-gray-800 dark:text-slate-200'
const hint = 'mt-1 text-xs text-gray-600 dark:text-slate-300'
const errText = 'mt-1 text-xs text-red-700 dark:text-red-300'

const toForm = (r: Rules): Form => ({
  enabled: r.enabled, hoursBefore: r.hoursBefore.map(String), sms: r.sms, email: r.email,
  sendFromHour: String(r.sendFromHour), sendUntilHour: String(r.sendUntilHour), message: r.message,
  timing: r.timing, fixed: r.fixed.map((f) => ({ daysBefore: String(f.daysBefore), time: f.time })),
  emailSubject: r.emailSubject, emailBody: r.emailBody, askConfirm: r.askConfirm, movedMessage: r.movedMessage,
})
const hourWords = (h: number) => (h === 0 || h === 24 ? 'midnight' : h === 12 ? 'noon' : `${h % 12}${h < 12 ? 'am' : 'pm'}`)

export default function JobRemindersPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('company:update')
  const [rules, setRules] = useState<Rules | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    api.get('/api/job-reminders/settings')
      .then((r: Rules) => { setRules(r); setForm(toForm(r)) })
      .catch((e: Error) => setLoadError(e.message || 'The reminder settings could not be loaded.'))
  }, [])

  if (loadError) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div>
  if (!form || !rules) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch })

  const save = async () => {
    setSaving(true); setErrors({})
    try {
      const next: Rules = await api.put('/api/job-reminders/settings', {
        enabled: form.enabled,
        hoursBefore: form.hoursBefore.filter((h) => h.trim() !== '').map(Number),
        sms: form.sms, email: form.email,
        sendFromHour: Number(form.sendFromHour === '' ? NaN : form.sendFromHour),
        sendUntilHour: Number(form.sendUntilHour === '' ? NaN : form.sendUntilHour),
        message: form.message,
        timing: form.timing,
        fixed: form.fixed.map((f) => ({ daysBefore: Number(f.daysBefore === '' ? NaN : f.daysBefore), time: f.time })),
        emailSubject: form.emailSubject, emailBody: form.emailBody, askConfirm: form.askConfirm, movedMessage: form.movedMessage,
      })
      setRules(next); setForm(toForm(next))
      toast.success('Job reminders saved')
    } catch (e: any) {
      setErrors(e?.data?.fields || {})
      toast.error(e?.message || 'The reminder settings could not be saved.')
    } finally { setSaving(false) }
  }

  const left = rules.maxMessage - form.message.length

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/crm/settings" className="text-sm text-gray-600 hover:underline dark:text-slate-300">Settings</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><BellRing className="h-6 w-6 text-orange-600 dark:text-orange-300" aria-hidden="true" /> Job Reminders</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">
          Text and email customers a reminder before a job you booked for them, automatically, each once. Jobs customers book online already get
          their own reminder. Nothing is sent outside the sending hours below, on your business&rsquo;s clock (the time zone in Settings › Company).
          A customer who replied STOP is never texted, and one who unsubscribed is never emailed.
        </p>
      </div>

      {!mayEdit && <p className="text-sm text-gray-700 dark:text-slate-300">You can see these settings. Only an owner or admin can change them.</p>}

      <section className={box} aria-label="Reminders">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
          <input type="checkbox" checked={form.enabled} disabled={!mayEdit} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4" />
          Send automatic job reminders
        </label>
        <p className={hint}>Off by default. Off, nothing is sent.</p>

        <fieldset className="mt-4">
          <legend className={label}>When reminders go out</legend>
          <div className="mt-1 flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100"><input type="radio" name="timing" checked={form.timing === 'hours_before'} disabled={!mayEdit} onChange={() => set({ timing: 'hours_before' })} className="h-4 w-4" />A set number of hours before the job</label>
            <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100"><input type="radio" name="timing" checked={form.timing === 'fixed_time'} disabled={!mayEdit} onChange={() => set({ timing: 'fixed_time' })} className="h-4 w-4" />At a fixed time of day, some days before</label>
          </div>
          {errors.timing && <p className={errText}>{errors.timing}</p>}
        </fieldset>

        {form.timing === 'fixed_time' && (
          <div className="mt-4">
            <span className={label}>Send a reminder at this time, this many days before the job</span>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {form.fixed.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <input aria-label={`Reminder ${i + 1}, days before`} type="number" min="0" max="14" inputMode="numeric" className="w-16 rounded-lg border border-gray-300 bg-white px-2 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={f.daysBefore} disabled={!mayEdit}
                    onChange={(e) => set({ fixed: form.fixed.map((x, j) => (j === i ? { ...x, daysBefore: e.target.value } : x)) })} />
                  <span className="text-sm text-gray-700 dark:text-slate-300">days before, at</span>
                  <input aria-label={`Reminder ${i + 1}, time of day`} type="time" className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={f.time} disabled={!mayEdit}
                    onChange={(e) => set({ fixed: form.fixed.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)) })} />
                  {mayEdit && form.fixed.length > 1 && <button type="button" aria-label={`Remove reminder ${i + 1}`} onClick={() => set({ fixed: form.fixed.filter((_, j) => j !== i) })} className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>}
                </span>
              ))}
              {mayEdit && form.fixed.length < 2 && (
                <button type="button" onClick={() => set({ fixed: [...form.fixed, { daysBefore: '0', time: '08:00' }] })} className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-200"><Plus className="h-4 w-4" />Add a second reminder</button>
              )}
            </div>
            <p className={hint}>0 days before is the morning of the job. Times are on your business&rsquo;s clock.</p>
            {Object.entries(errors).filter(([k]) => k.startsWith('fixed')).map(([k, v]) => <p key={k} className={errText}>{v}</p>)}
          </div>
        )}

        <div className={form.timing === 'hours_before' ? 'mt-4' : 'hidden'}>
          <span className={label}>Send a reminder this many hours before the job</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {form.hoursBefore.map((h, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <input aria-label={`Reminder ${i + 1}, hours before`} type="number" min="1" max="168" inputMode="numeric" className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={h} disabled={!mayEdit}
                  onChange={(e) => set({ hoursBefore: form.hoursBefore.map((x, j) => (j === i ? e.target.value : x)) })} />
                {mayEdit && form.hoursBefore.length > 1 && <button type="button" aria-label={`Remove reminder ${i + 1}`} onClick={() => set({ hoursBefore: form.hoursBefore.filter((_, j) => j !== i) })} className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>}
              </span>
            ))}
            {mayEdit && form.hoursBefore.length < 2 && (
              <button type="button" onClick={() => set({ hoursBefore: [...form.hoursBefore, ''] })} className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-200"><Plus className="h-4 w-4" />Add a second reminder</button>
            )}
          </div>
          <p className={hint}>24 is the day before. A job with no time set is treated as starting when your sending hours open that day. A job booked after a reminder&rsquo;s moment has passed gets only the latest one it has reached.</p>
          {Object.entries(errors).filter(([k]) => k.startsWith('hoursBefore')).map(([k, v]) => <p key={k} className={errText}>{v}</p>)}
        </div>

        <fieldset className="mt-4">
          <legend className={label}>How to send it</legend>
          <div className="mt-1 flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100"><input type="checkbox" checked={form.sms} disabled={!mayEdit} onChange={(e) => set({ sms: e.target.checked })} className="h-4 w-4" />Text message</label>
            <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100"><input type="checkbox" checked={form.email} disabled={!mayEdit} onChange={(e) => set({ email: e.target.checked })} className="h-4 w-4" />Email</label>
          </div>
          <p className={hint}>Texts go to the customer&rsquo;s mobile number, or their phone number if there is no mobile. They use your texting number and count toward your texting usage.</p>
          {errors.sms && <p className={errText}>{errors.sms}</p>}
        </fieldset>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="from-hour" className={label}>Sending hours: from</label>
            <input id="from-hour" type="number" min="0" max="23" inputMode="numeric" className={field} value={form.sendFromHour} disabled={!mayEdit} onChange={(e) => set({ sendFromHour: e.target.value })} />
            <p className={hint}>Hour of the day, 0–23 (8 is {hourWords(8)}).</p>
            {errors.sendFromHour && <p className={errText}>{errors.sendFromHour}</p>}
          </div>
          <div>
            <label htmlFor="until-hour" className={label}>Sending hours: until</label>
            <input id="until-hour" type="number" min="1" max="24" inputMode="numeric" className={field} value={form.sendUntilHour} disabled={!mayEdit} onChange={(e) => set({ sendUntilHour: e.target.value })} />
            <p className={hint}>Hour of the day, 1–24 (20 is {hourWords(20)}). A reminder that comes due overnight goes out when the hours open.</p>
            {errors.sendUntilHour && <p className={errText}>{errors.sendUntilHour}</p>}
          </div>
        </div>
      </section>

      <section className={box} aria-label="Text message">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">The text message</h2>
        <label htmlFor="msg" className="sr-only">Text message wording</label>
        <textarea id="msg" rows={3} maxLength={rules.maxMessage} className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={form.message} disabled={!mayEdit} onChange={(e) => set({ message: e.target.value })} />
        <p className={hint}>{left} characters left. Fill-ins you can use: {rules.variables.map((v) => `{{${v}}}`).join(' ')}.</p>
        {errors.message && <p className={errText}>{errors.message}</p>}
        <label className="mt-3 flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
          <input type="checkbox" checked={form.askConfirm} disabled={!mayEdit} onChange={(e) => set({ askConfirm: e.target.checked })} className="h-4 w-4" />
          Ask the customer to confirm
        </label>
        <p className={hint}>Adds &ldquo;Reply Y to confirm.&rdquo; to the text and a Confirm button to the email. A confirmed visit shows on the job and in the customer portal; moving the visit clears it.</p>
      </section>

      <section className={box} aria-label="Email">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">The email</h2>
        <label htmlFor="email-subject" className="mt-2 block text-sm font-medium text-gray-800 dark:text-slate-200">Subject</label>
        <input id="email-subject" maxLength={200} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={form.emailSubject} disabled={!mayEdit} onChange={(e) => set({ emailSubject: e.target.value })} />
        {errors.emailSubject && <p className={errText}>{errors.emailSubject}</p>}
        <label htmlFor="email-body" className="mt-3 block text-sm font-medium text-gray-800 dark:text-slate-200">Message</label>
        <textarea id="email-body" rows={7} maxLength={rules.maxEmailBody} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={form.emailBody} disabled={!mayEdit} onChange={(e) => set({ emailBody: e.target.value })} />
        <p className={hint}>Same fill-ins as the text. Your logo and colors are added around it.</p>
        {errors.emailBody && <p className={errText}>{errors.emailBody}</p>}
      </section>

      <section className={box} aria-label="Visit moved">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">When a visit is moved</h2>
        <p className={hint}>After you reschedule a visit you are asked whether to tell the customer. This is the text they get; the email uses the same words.</p>
        <label htmlFor="moved-msg" className="sr-only">Visit moved wording</label>
        <textarea id="moved-msg" rows={3} maxLength={rules.maxMessage} className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={form.movedMessage} disabled={!mayEdit} onChange={(e) => set({ movedMessage: e.target.value })} />
        {errors.movedMessage && <p className={errText}>{errors.movedMessage}</p>}
      </section>

      {mayEdit && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-orange-700 px-4 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save
          </button>
        </div>
      )}
    </div>
  )
}
