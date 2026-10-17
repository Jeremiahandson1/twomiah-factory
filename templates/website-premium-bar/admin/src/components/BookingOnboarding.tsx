import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Circle, Calendar, Settings, Clock, Link2, X } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'

/**
 * Bookings onboarding banner. Surfaces at the top of BookingsPage
 * until the tenant has at minimum:
 *   1. One active service
 *   2. At least one availability rule
 * Then it stays as a soft checklist showing the optional next steps
 * (connect calendar, set drive time, etc.) for ~7 days; admin can
 * dismiss anytime.
 */
const DISMISS_KEY = 'twomiah_bookings_onboarding_dismissed'

export function BookingOnboarding() {
  const [step, setStep] = useState<{ services: boolean; availability: boolean; calendar: boolean } | null>(null)
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })

  useEffect(() => {
    if (dismissed) return
    Promise.all([
      api.get<{ services: any[] }>('/api/admin/booking-services').catch(() => ({ services: [] })),
      api.get<{ rules: any[] }>('/api/admin/booking-availability').catch(() => ({ rules: [] })),
      api.get<{ connections: any[] }>('/api/admin/calendar/connections').catch(() => ({ connections: [] })),
    ]).then(([s, r, c]) => {
      setStep({
        services: (s.services || []).some(x => x.isActive),
        availability: (r.rules || []).length > 0,
        calendar: (c.connections || []).length > 0,
      })
    })
  }, [dismissed])

  if (dismissed || !step) return null

  const allRequired = step.services && step.availability
  // Hide entirely once required + calendar are done
  if (allRequired && step.calendar) return null

  const dismiss = () => {
    setDismissed(true)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
  }

  return (
    <div className="card card-padding mb-6 border-2 border-brand/30 bg-brand/5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">{allRequired ? 'Almost done' : 'Welcome — set up bookings'}</h2>
          <p className="text-muted text-sm mt-0.5">
            {allRequired
              ? 'Bookings are live. Finish the optional step below to make your calendar app aware of new bookings.'
              : 'Three quick steps and customers can start booking. Takes about 2 minutes.'}
          </p>
        </div>
        <button onClick={dismiss} className="text-muted hover:text-ink" aria-label="Dismiss"><X className="w-4 h-4" /></button>
      </div>
      <ul className="space-y-2">
        <Step done={step.services} icon={<Settings className="w-4 h-4" />} label="Add at least one bookable service" to="/booking-settings" />
        <Step done={step.availability} icon={<Clock className="w-4 h-4" />} label="Set your weekly availability" to="/booking-settings" />
        <Step done={step.calendar} icon={<Link2 className="w-4 h-4" />} label="Connect Google or Outlook calendar (optional)" to="/booking-settings" optional />
      </ul>
    </div>
  )
}

function Step({ done, icon, label, to, optional }: { done: boolean; icon: React.ReactNode; label: string; to: string; optional?: boolean }) {
  return (
    <li className="flex items-center gap-3">
      {done
        ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
        : <Circle className="w-5 h-5 text-muted shrink-0" />}
      <span className={clsx('flex items-center gap-2 text-sm', done ? 'text-muted line-through' : 'text-ink')}>
        {icon}
        {label}
      </span>
      {!done && (
        <Link to={to} className="ml-auto text-xs text-brand hover:underline">
          {optional ? 'Set up' : 'Go →'}
        </Link>
      )}
    </li>
  )
}
