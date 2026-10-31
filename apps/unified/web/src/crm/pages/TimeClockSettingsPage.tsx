// Settings › Time Clock (server crm/field/clockExtras.ts, /api/time-clock): automatic timekeeping from the job's buttons,
// overtime alerts, and the kiosk tablet; and each person's own kiosk PIN. Every line here is what the server does.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

type Mode = 'off' | 'on_my_way' | 'arrive'
interface Cfg { automatic: { mode: Mode }; overtime: { enabled: boolean; dailyHours: number; weeklyHours: number; warnMinutes: number }; kiosk: { enabled: boolean } }

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const field = 'mt-1 w-28 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const label = 'block text-sm font-medium text-gray-800 dark:text-slate-200'
const hint = 'mt-1 text-xs text-gray-600 dark:text-slate-300'
const btn = 'rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50'
const ghost = 'rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800'

const MODES: Array<{ value: Mode; title: string; body: string }> = [
  { value: 'off', title: 'Off', body: 'People clock in and out themselves.' },
  { value: 'on_my_way', title: 'On my way starts the timesheet', body: 'When a tech taps On my way on a job they are on, they are clocked in; Complete clocks them out.' },
  { value: 'arrive', title: 'Arrive starts the timesheet', body: 'When a tech taps Start on a job they are on, they are clocked in; Complete clocks them out. Driving time is not counted.' },
]

export default function TimeClockSettingsPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('company:update')
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [daily, setDaily] = useState('')
  const [weekly, setWeekly] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [hasPin, setHasPin] = useState<boolean | null>(null)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')

  const take = (r: Cfg) => { setCfg(r); setDaily(String(r.overtime.dailyHours)); setWeekly(String(r.overtime.weeklyHours)) }
  useEffect(() => {
    api.get('/api/time-clock/settings').then(take).catch((e: Error) => setLoadError(e.message || 'The time clock settings could not be loaded.'))
    api.get('/api/time-clock/kiosk/pin').then((r: any) => setHasPin(!!r?.hasPin)).catch(() => setHasPin(null))
  }, [])

  if (loadError) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div>
  if (!cfg) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const save = async () => {
    setSaving(true); setErrors({})
    try {
      const next: Cfg = await api.put('/api/time-clock/settings', {
        automatic: cfg.automatic,
        overtime: { enabled: cfg.overtime.enabled, dailyHours: Number(daily === '' ? NaN : daily), weeklyHours: Number(weekly === '' ? NaN : weekly), warnMinutes: cfg.overtime.warnMinutes },
        kiosk: cfg.kiosk,
      })
      take(next); toast.success('Time clock settings saved')
    } catch (e: any) { setErrors(e?.data?.fields || {}); toast.error(e?.message || 'The settings could not be saved.') }
    finally { setSaving(false) }
  }
  const savePin = async () => {
    setPinError('')
    try { await api.put('/api/time-clock/kiosk/pin', { pin }); setHasPin(true); setPin(''); toast.success('Your PIN is set') }
    catch (e: any) { setPinError(e?.message || 'The PIN could not be saved.') }
  }
  const removePin = async () => {
    try { await api.delete('/api/time-clock/kiosk/pin'); setHasPin(false); toast.success('Your PIN is removed') }
    catch (e: any) { toast.error(e?.message || 'The PIN could not be removed.') }
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-slate-100">Time Clock</h1>
        <p className="mt-1 text-sm text-gray-700 dark:text-slate-300">How the clock starts and stops, who is told about overtime, and the shared tablet.</p>
      </div>

      <section className={box} aria-label="Automatic timekeeping">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Automatic timekeeping</h2>
        <div className="mt-3 grid gap-2" role="radiogroup" aria-label="When the timesheet starts">
          {MODES.map((m) => (
            <label key={m.value} className="flex items-start gap-3 text-sm text-gray-900 dark:text-slate-100">
              <input type="radio" name="automatic" className="mt-1" disabled={!mayEdit} checked={cfg.automatic.mode === m.value} onChange={() => setCfg({ ...cfg, automatic: { mode: m.value } })} />
              <span><span className="font-medium">{m.title}</span><span className="block text-gray-700 dark:text-slate-300">{m.body}</span></span>
            </label>
          ))}
        </div>
        <p className={hint}>Only the tech who is on the job and taps the button is clocked in, and only when they are not already on the clock. Complete ends a clock the job opened, never one started by hand.</p>
      </section>

      <section className={box} aria-label="Overtime alerts">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Overtime alerts</h2>
        <label className="mt-3 flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100">
          <input type="checkbox" disabled={!mayEdit} checked={cfg.overtime.enabled} onChange={(e) => setCfg({ ...cfg, overtime: { ...cfg.overtime, enabled: e.target.checked } })} />
          Tell people when they are close to, or reach, a limit
        </label>
        <div className="mt-3 flex flex-wrap gap-4">
          <label className={label}>Hours in a day<input className={field} inputMode="decimal" disabled={!mayEdit} value={daily} onChange={(e) => setDaily(e.target.value)} />{errors['overtime.dailyHours'] && <span className="mt-1 block text-xs text-red-700 dark:text-red-300">{errors['overtime.dailyHours']}</span>}</label>
          <label className={label}>Hours in a week<input className={field} inputMode="decimal" disabled={!mayEdit} value={weekly} onChange={(e) => setWeekly(e.target.value)} />{errors['overtime.weeklyHours'] && <span className="mt-1 block text-xs text-red-700 dark:text-red-300">{errors['overtime.weeklyHours']}</span>}</label>
          <label className={label}>Warn ahead
            <select className={field} disabled={!mayEdit} value={cfg.overtime.warnMinutes} onChange={(e) => setCfg({ ...cfg, overtime: { ...cfg.overtime, warnMinutes: Number(e.target.value) } })}>
              <option value={0}>Not at all</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option>
            </select>
          </label>
        </div>
        <p className={hint}>The person and the owner, admins and managers get a notification on their phones, once for each limit each day or week. Days and weeks (Monday to Sunday) are on your business’s clock; breaks are not counted.</p>
      </section>

      <section className={box} aria-label="Kiosk">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Kiosk</h2>
        <label className="mt-3 flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100">
          <input type="checkbox" disabled={!mayEdit} checked={cfg.kiosk.enabled} onChange={(e) => setCfg({ ...cfg, kiosk: { enabled: e.target.checked } })} />
          Let people clock in and out on a shared tablet with their own PIN
        </label>
        <p className={hint}>A manager signs in on the tablet and opens the kiosk; each person then types their PIN. Five wrong PINs and it waits a few minutes.</p>
        {cfg.kiosk.enabled && <p className="mt-2 text-sm"><Link className="text-blue-800 underline dark:text-blue-300" to="/crm/time-kiosk">Open the kiosk</Link></p>}
        {hasPin !== null && (
          <div className="mt-4 border-t border-gray-200 pt-4 dark:border-slate-700">
            <p className="text-sm font-medium text-gray-900 dark:text-slate-100">Your PIN: {hasPin ? 'set' : 'not set'}</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className={label}>{hasPin ? 'New PIN' : 'Choose a PIN'} (4 to 8 digits)<input className={field} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} /></label>
              <button type="button" className={ghost} disabled={pin.length < 4} onClick={savePin}>{hasPin ? 'Change PIN' : 'Set PIN'}</button>
              {hasPin && <button type="button" className={ghost} onClick={removePin}>Remove PIN</button>}
            </div>
            {pinError && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">{pinError}</p>}
          </div>
        )}
      </section>

      {mayEdit && <div><button type="button" className={btn} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button></div>}
    </div>
  )
}
