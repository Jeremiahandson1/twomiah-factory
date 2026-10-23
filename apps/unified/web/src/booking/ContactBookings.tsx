// A contact's bookings, on the contact's own page: each in the name its booker typed. One email is one contact (the
// booking engine links by email and never renames the record), so a household booking under one address shows here as
// several names — said plainly, rather than every visit looking like the account holder's. (Field service T24 L1)
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck } from 'lucide-react'
import { api } from '../api'
import { onClock, StatusPill, type Booking, type BookingSettings } from './common'

export function ContactBookings({ contactId, contactName }: { contactId: string; contactName?: string | null }) {
  const [settings, setSettings] = useState<BookingSettings | null>(null)
  const [rows, setRows] = useState<Booking[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    // The business's clock (every booking time is the business's), and this contact's bookings, newest first.
    Promise.all([api.get('/api/booking/settings'), api.get('/api/booking/bookings', { contactId, limit: 50 })])
      .then(([s, r]: [BookingSettings, { data: Booking[] }]) => { setSettings(s); setRows(r.data) })
      .catch((e: Error) => setError(e.message))
  }, [contactId])
  if (error || !rows || !rows.length || !settings) return null
  const clock = onClock(settings.timezone)
  const own = (contactName || rows[0].contactName || '').trim().toLowerCase()
  return (
    <section className="card" aria-labelledby="contact-bookings">
      <div className="p-4 border-b border-line flex items-center justify-between">
        <h2 id="contact-bookings" className="text-lg font-semibold text-ink flex items-center gap-2"><CalendarCheck className="w-4 h-4" aria-hidden="true" />Bookings</h2>
        <span className="text-sm text-muted">{rows.length}</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((b) => (
          <li key={b.id}>
            <Link to={`/crm/bookings/${b.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-paper">
              <div className="min-w-0">
                <p className="font-medium text-ink">{b.serviceName || 'Booking'} · {clock.day(b.startAt)} {clock.time(b.startAt)}</p>
                <p className="text-sm text-ink-soft">Booked as {b.customerName}{own && b.customerName.trim().toLowerCase() !== own ? ' (a different name from this contact’s)' : ''}{b.job ? ` · ${b.job.number}` : ''}</p>
              </div>
              <StatusPill status={b.status} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
