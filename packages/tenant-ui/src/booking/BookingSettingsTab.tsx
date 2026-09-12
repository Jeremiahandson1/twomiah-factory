// Booking settings — the master switch, hours, scheduling rules (slot length, notice, window, capacity,
// timezone), messages and owner notifications. One tab for every CRM.
import React, { useEffect, useState } from 'react'
import { Button, Field, errMsg, inputCls } from '../invoicing/ui'
import type { BookingApi, BookingConfig, BookingSettings, BookingToast } from './types'
import { resolveBookingConfig } from './types'

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
type Day = typeof DAYS[number]
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

const TIMEZONES: Array<{ value: string; label: string }> = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (Phoenix, no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
]

function normalize(s: any): BookingSettings {
  const hours: BookingSettings['workingHours'] = {}
  const src = (s?.workingHours && typeof s.workingHours === 'object' ? s.workingHours : {}) as Record<string, any>
  for (const d of DAYS) hours[d] = { start: typeof src[d]?.start === 'string' ? src[d].start : '09:00', end: typeof src[d]?.end === 'string' ? src[d].end : '17:00', enabled: src[d]?.enabled === true }
  return {
    enabled: s?.enabled !== false,
    slotDurationMinutes: Number(s?.slotDurationMinutes ?? 60),
    leadTimeDays: Number(s?.leadTimeDays ?? 1),
    maxDaysOut: Number(s?.maxDaysOut ?? 30),
    concurrentBookings: Number(s?.concurrentBookings ?? 1),
    timezone: s?.timezone || 'America/Chicago',
    workingHours: hours,
    welcomeMessage: s?.welcomeMessage || '',
    confirmationMessage: s?.confirmationMessage || '',
    notifyEmail: s?.notifyEmail !== false,
    notifySms: s?.notifySms === true,
  }
}

export function BookingSettingsTab({ api, toast, config, onSaved }: { api: BookingApi; toast: BookingToast; config?: BookingConfig; onSaved?: (s: BookingSettings) => void }) {
  const cfg = resolveBookingConfig(config)
  const [settings, setSettings] = useState<BookingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    api.get('/api/booking/settings').then(s => setSettings(normalize(s))).catch(e => setLoadError(errMsg(e, 'Could not load booking settings.'))).finally(() => setLoading(false))
  }, [api])

  const set = <K extends keyof BookingSettings>(k: K, v: BookingSettings[K]) => { setSettings(s => (s ? { ...s, [k]: v } : s)); setDirty(true) }
  const setDay = (d: Day, patch: Partial<{ start: string; end: string; enabled: boolean }>) => {
    setSettings(s => (s ? { ...s, workingHours: { ...s.workingHours, [d]: { ...s.workingHours[d], ...patch } } } : s)); setDirty(true)
  }

  const save = async () => {
    if (!settings) return
    for (const d of DAYS) {
      const h = settings.workingHours[d]
      if (h.enabled && h.start >= h.end) { toast.error(`${cap(d)}: opening time must be before closing time.`); return }
    }
    setSaving(true)
    try {
      const saved = await api.put('/api/booking/settings', settings)
      setSettings(normalize(saved)); setDirty(false)
      toast.success('Booking settings saved — the booking page updates immediately.')
      onSaved?.(normalize(saved))
    } catch (e) { toast.error(errMsg(e, 'Could not save settings.')) } finally { setSaving(false) }
  }

  if (loading) return <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-12 text-center text-gray-400">Loading settings…</div>
  if (!settings) return <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-12 text-center text-red-500">{loadError || 'Could not load booking settings.'}</div>

  const tzOptions = TIMEZONES.some(z => z.value === settings.timezone) ? TIMEZONES : [{ value: settings.timezone, label: settings.timezone }, ...TIMEZONES]
  const card = 'bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5'
  const check = 'w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-orange-600 focus:ring-orange-500'

  return (
    <div className="space-y-4 max-w-3xl">
      <div className={`${card} flex items-center justify-between`}>
        <div>
          <div className="font-semibold text-gray-900 dark:text-slate-100">Online booking is {settings.enabled ? 'ON' : 'OFF'}</div>
          <p className="text-sm text-gray-500 dark:text-slate-400">{settings.enabled ? 'Customers can book from your website and the booking page.' : 'The public booking page tells customers booking is unavailable.'}</p>
        </div>
        <button role="switch" aria-checked={settings.enabled} onClick={() => set('enabled', !settings.enabled)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${settings.enabled ? 'bg-orange-500' : 'bg-gray-300 dark:bg-slate-600'}`}>
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      <div className={card}>
        <h2 className="font-semibold text-gray-900 dark:text-slate-100 mb-1">Booking hours</h2>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">Days switched off never appear on the public date picker. Times are in your timezone below.</p>
        <div className="space-y-2">
          {DAYS.map(d => {
            const h = settings.workingHours[d]
            return (
              <div key={d} className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 w-32 cursor-pointer">
                  <input type="checkbox" checked={h.enabled} onChange={e => setDay(d, { enabled: e.target.checked })} className={check} />
                  <span className="text-sm font-medium text-gray-700 dark:text-slate-200 capitalize">{d}</span>
                </label>
                {h.enabled ? (
                  <div className="flex items-center gap-2">
                    <input type="time" value={h.start} onChange={e => setDay(d, { start: e.target.value })} className={`${inputCls} w-auto py-1.5`} />
                    <span className="text-gray-400 text-sm">to</span>
                    <input type="time" value={h.end} onChange={e => setDay(d, { end: e.target.value })} className={`${inputCls} w-auto py-1.5`} />
                  </div>
                ) : <span className="text-sm text-gray-400">Closed</span>}
              </div>
            )
          })}
        </div>
      </div>

      <div className={card}>
        <h2 className="font-semibold text-gray-900 dark:text-slate-100 mb-4">Scheduling rules</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Slot length" hint="A service's own duration overrides this.">
            <select value={settings.slotDurationMinutes} onChange={e => set('slotDurationMinutes', Number(e.target.value))} className={inputCls}>
              {[15, 30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </Field>
          <Field label="Notice needed">
            <select value={settings.leadTimeDays} onChange={e => set('leadTimeDays', Number(e.target.value))} className={inputCls}>
              <option value={0}>Same-day OK</option><option value={1}>1 day ahead</option><option value={2}>2 days ahead</option><option value={3}>3 days ahead</option><option value={7}>1 week ahead</option>
            </select>
          </Field>
          <Field label="Book up to">
            <select value={settings.maxDaysOut} onChange={e => set('maxDaysOut', Number(e.target.value))} className={inputCls}>
              <option value={14}>2 weeks out</option><option value={30}>30 days out</option><option value={60}>60 days out</option><option value={90}>90 days out</option>
            </select>
          </Field>
          <Field label={cfg.concurrentLabel} hint={cfg.concurrentHelp}>
            <input type="number" min={1} max={20} value={settings.concurrentBookings} onChange={e => set('concurrentBookings', Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className={inputCls} />
          </Field>
          <Field label="Timezone" hint="Slot times are shown to customers in this zone.">
            <select value={settings.timezone} onChange={e => set('timezone', e.target.value)} className={inputCls}>
              {tzOptions.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <div className={`${card} space-y-4`}>
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">Messages</h2>
        <Field label="Booking page heading"><input value={settings.welcomeMessage} onChange={e => set('welcomeMessage', e.target.value)} placeholder="Book an appointment" className={inputCls} /></Field>
        <Field label="Confirmation message"><input value={settings.confirmationMessage} onChange={e => set('confirmationMessage', e.target.value)} placeholder="You're booked — see you soon!" className={inputCls} /></Field>
        <div className="flex items-center gap-6 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={settings.notifyEmail} onChange={e => set('notifyEmail', e.target.checked)} className={check} /><span className="text-sm text-gray-700 dark:text-slate-200">Email me on each booking</span></label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={settings.notifySms} onChange={e => set('notifySms', e.target.checked)} className={check} /><span className="text-sm text-gray-700 dark:text-slate-200">Text me on each booking</span></label>
        </div>
        <p className="text-xs text-gray-500 dark:text-slate-400">Sent to the company email and phone on Settings → Company.</p>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save settings'}</Button>
        {dirty && <span className="text-sm text-gray-400">Unsaved changes</span>}
      </div>
    </div>
  )
}
