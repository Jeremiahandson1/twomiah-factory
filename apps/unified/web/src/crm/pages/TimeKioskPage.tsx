// The time clock kiosk (server crm/field/clockExtras.ts, POST /api/time-clock/kiosk/punch): a shared tablet that a manager
// has signed in. Each person types their own PIN to clock in or out, or to start or end a break. No dialogs: the answer is
// written on the screen and clears itself.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Delete as Backspace } from 'lucide-react'
import { api } from '../../api'
import { useAuth, useMayWrite } from '../../shared'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const key = 'h-16 rounded-xl border border-gray-300 bg-white text-2xl font-semibold text-gray-900 hover:bg-gray-50 active:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
const MANAGER = new Set(['owner', 'admin', 'manager'])

const said = (r: { name: string; action: string; hours?: number; message?: string }) => {
  switch (r.action) {
    case 'in': return `${r.name} is clocked in.`
    case 'out': return `${r.name} is clocked out — ${(r.hours ?? 0).toFixed(2)} hours.`
    case 'break_start': return `${r.name} is on a break.`
    case 'break_end': return `${r.name} is back from the break.`
    default: return r.message || `${r.name}: nothing was recorded.`
  }
}

export default function TimeKioskPage() {
  const { user } = useAuth() as any
  // The kiosk punches through POST /api/time-clock/kiosk/punch (time:create): the signed-in manager must hold it.
  const mayPunch = useMayWrite('time:create')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  if ((user && !MANAGER.has(String(user.role))) || !mayPunch) {
    return <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">A manager has to sign in on this tablet to run the kiosk.</div>
  }

  const show = (text: string, bad: boolean) => {
    setNote({ text, bad })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setNote(null), 5000)
  }
  const send = async (onBreak: boolean) => {
    if (pin.length < 4 || busy) return
    setBusy(true)
    try { show(said(await api.post('/api/time-clock/kiosk/punch', { pin, ...(onBreak ? { break: true } : {}) })), false); setPin('') }
    catch (e: any) { show(e?.message || 'That did not work.', true); setPin('') }
    finally { setBusy(false) }
  }

  return (
    <div className="mx-auto grid max-w-sm gap-4 text-center">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-slate-100">Time clock</h1>
      <p className="text-sm text-gray-700 dark:text-slate-300">Type your PIN.</p>
      <div aria-label="PIN" className="rounded-xl border border-gray-300 bg-white py-3 text-3xl tracking-[0.5em] text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" data-testid="kiosk-pin">{pin ? '•'.repeat(pin.length) : ' '}</div>
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => <button key={k} type="button" className={key} onClick={() => setPin((p) => (p.length < 8 ? p + k : p))}>{k}</button>)}
        <button type="button" className={key} aria-label="Clear" onClick={() => setPin('')}>C</button>
        <button type="button" className={key} onClick={() => setPin((p) => (p.length < 8 ? p + '0' : p))}>0</button>
        <button type="button" className={key} aria-label="Remove the last digit" onClick={() => setPin((p) => p.slice(0, -1))}><Backspace className="mx-auto h-6 w-6" aria-hidden /></button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="h-14 rounded-xl bg-blue-700 text-lg font-semibold text-white hover:bg-blue-800 disabled:opacity-50" disabled={pin.length < 4 || busy} onClick={() => send(false)}>Clock in / out</button>
        <button type="button" className="h-14 rounded-xl border border-gray-300 text-lg font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800" disabled={pin.length < 4 || busy} onClick={() => send(true)}>Break</button>
      </div>
      <p role={note?.bad ? 'alert' : 'status'} className={`min-h-[2.5rem] text-base ${note?.bad ? 'text-red-800 dark:text-red-300' : 'text-green-800 dark:text-green-300'}`} data-testid="kiosk-note">{note?.text}</p>
      <p className="text-xs text-gray-600 dark:text-slate-400"><Link className="underline" to="/crm/settings/time-clock">Time clock settings</Link></p>
    </div>
  )
}
