// Portal appointments (salon): the client's upcoming appointments — when, what and with whom — read-only. One booked online
// carries a link to its own page, where the salon's rules decide whether it can still be moved or cancelled; one made at the
// desk says to call. No prices, notes or formulas ever reach this page (portal.ts GET /p/:token/appointments).
import React, { useState, useEffect } from 'react'
import { CalendarCheck } from 'lucide-react'
import { usePortal } from './PortalContext'
import { Spinner, PageTitle, Empty, card } from './common'

export interface PortalAppointment {
  id: string; startTime: string; endTime?: string | null; status: string
  service: string | null; with: string | null; manageUrl: string | null
}

const when = (iso: string, tz?: string | null) => {
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(tz ? { timeZone: tz } : {}) }) } catch { return iso }
}

export function PortalAppointments() {
  const { config, company, fetch: portalFetch } = usePortal()
  const [rows, setRows] = useState<PortalAppointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { portalFetch('/appointments').then((d) => setRows(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch])
  if (loading) return <Spinner />
  return (
    <div>
      <PageTitle title={config.labels.appointments} subtitle="What you have booked with us." />
      {error && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {rows.length === 0 ? <Empty icon={CalendarCheck} text="You have no upcoming appointments." /> : (
        <ul className="space-y-3">
          {rows.map((a) => (
            <li key={a.id} className={`${card} p-5`}>
              <p className="font-semibold text-gray-900 dark:text-slate-100">{a.service || 'Appointment'}{a.with ? ` with ${a.with}` : ''}</p>
              <p className="text-sm text-gray-600 dark:text-slate-300">{when(a.startTime, (company as any)?.timeZone)}</p>
              <p className="mt-2 text-sm">
                {a.manageUrl
                  ? <a href={a.manageUrl} className="text-teal-700 underline dark:text-teal-300">Move or cancel</a>
                  : <span className="text-gray-600 dark:text-slate-300">To change this one, please call us.</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
