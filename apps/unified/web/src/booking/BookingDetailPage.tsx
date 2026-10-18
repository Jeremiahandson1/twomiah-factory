// One booking: what, when, who; move it, give it to someone, mark what happened, or cancel it — each through its
// own rule on the server (a move is checked against the free times unless staff say otherwise; "completed" only
// once the visit has started).
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Mail, Phone, MapPin, Repeat, FileText } from 'lucide-react'
import { api } from '../api'
import { PageError, useConfirm, useMayWrite, useToast } from '../shared'
import { useBookingBasics, onClock, StatusPill, dollars, type Booking } from './common'
import { TimePicker, type PickedTime } from './TimePicker'

export function BookingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { settings, people } = useBookingBasics()
  const mayUpdate = useMayWrite('bookings:update')
  const confirm = useConfirm()
  const toast = useToast()
  const [b, setB] = useState<Booking | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [moving, setMoving] = useState(false)
  const [when, setWhen] = useState<PickedTime | null>(null)

  useEffect(() => {
    api.get(`/api/booking/bookings/${id}`).then(setB).catch((e: Error) => setError(e.message))
  }, [id])

  const patch = async (body: Record<string, unknown>, said: string) => {
    setBusy(true); setError(null)
    try { setB(await api.patch(`/api/booking/bookings/${id}`, body)); toast.success(said); return true }
    catch (e: any) { setError(e.message); return false }
    finally { setBusy(false) }
  }

  if (!b || !settings) return error ? <PageError message={error} /> : <div className="text-muted text-sm">Loading…</div>
  const clock = onClock(settings.timezone)
  const live = b.status === 'confirmed' || b.status === 'pending'
  const started = new Date(b.startAt).getTime() <= Date.now() + 60_000

  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/crm/bookings" className="text-muted hover:text-ink inline-flex items-center gap-1.5 text-sm mb-5"><ArrowLeft className="w-4 h-4" />All bookings</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">{b.customerName}</h1>
          <p className="text-muted text-sm mt-1">{b.serviceName || 'Service removed'} · booked {clock.day(b.createdAt)} {b.source === 'public' ? 'online' : b.source === 'series' ? 'as part of a series' : 'at the desk'}</p>
          {b.seriesId && <Link to={`/crm/bookings/series/${b.seriesId}`} className="inline-flex items-center gap-1 mt-2 text-sm text-brand-700 dark:text-brand-300 underline"><Repeat className="w-3.5 h-3.5" aria-hidden="true" />Visit {b.seriesIndex} of a repeating booking</Link>}
        </div>
        <StatusPill status={b.status} />
      </div>

      <PageError message={error} className="mb-4" />

      <section className="card card-padding mb-4">
        <h2 className="text-sm font-semibold text-ink mb-2">When</h2>
        <p className="text-lg text-ink">{clock.longDay(b.startAt)}</p>
        <p className="text-sm text-muted">{clock.time(b.startAt)} – {clock.time(b.endAt)} {clock.zone(b.startAt)}</p>
        {mayUpdate && live && !moving && <button type="button" onClick={() => setMoving(true)} className="btn-secondary btn-sm mt-3" disabled={!b.serviceId}>Move</button>}
        {moving && b.serviceId && (
          <div className="mt-4 border-t border-line pt-4 space-y-3">
            <TimePicker serviceId={b.serviceId} exceptBookingId={b.id} value={when} onChange={setWhen} zone={clock.zone()} />
            <div className="flex gap-2">
              <button type="button" className="btn-primary btn-sm" disabled={busy || !when?.date || !when.time}
                onClick={async () => { if (await patch({ date: when!.date, time: when!.time, override: when!.override }, 'Moved — the customer has been emailed the new time.')) { setMoving(false); setWhen(null) } }}>Move it here</button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => { setMoving(false); setWhen(null) }}>Keep the time</button>
            </div>
          </div>
        )}
      </section>

      <section className="card card-padding mb-4">
        <h2 className="text-sm font-semibold text-ink mb-3">Customer</h2>
        <div className="space-y-2 text-sm text-ink">
          <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-muted" aria-hidden="true" /><a href={`mailto:${b.customerEmail}`} className="underline">{b.customerEmail}</a></div>
          {b.customerPhone && <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted" aria-hidden="true" /><a href={`tel:${b.customerPhone}`} className="underline">{b.customerPhone}</a></div>}
          {b.customerAddress && <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-muted" aria-hidden="true" />{b.customerAddress}{b.customerZip ? ` ${b.customerZip}` : ''}</div>}
        </div>
        {b.customerNotes && <div className="mt-3 pt-3 border-t border-line"><h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1 flex items-center gap-1"><FileText className="w-3 h-3" aria-hidden="true" />Notes</h3><p className="text-sm text-ink whitespace-pre-wrap">{b.customerNotes}</p></div>}
        {(b.depositAmount || b.tipAmount) && (
          <p className="mt-3 pt-3 border-t border-line text-sm text-ink-soft">
            {b.depositAmount && <>Deposit {dollars(b.depositAmount)} — {b.depositStatus}. </>}
            {b.tipAmount && <>Tip {dollars(b.tipAmount)}.</>}
          </p>
        )}
      </section>

      {people.length === 0 && b.assignedName && <p className="text-sm text-ink-soft mb-4">With {b.assignedName}.</p>}
      {people.length > 0 && (
        <section className="card card-padding mb-4">
          <label htmlFor="bd-who" className="text-sm font-semibold text-ink block mb-2">Who's doing it</label>
          <select id="bd-who" className="input" disabled={!mayUpdate || busy} value={b.assignedUserId || ''} onChange={(e) => patch({ assignedUserId: e.target.value || null }, 'Saved.')}>
            <option value="">Anyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </section>
      )}

      {mayUpdate && live && (
        <section className="card card-padding">
          <h2 className="text-sm font-semibold text-ink mb-3">What happened</h2>
          <div className="flex flex-wrap gap-2">
            {b.status === 'pending' && <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => patch({ status: 'confirmed' }, 'Confirmed.')}>Confirm (deposit taken in person)</button>}
            <button type="button" className="btn-secondary btn-sm" disabled={busy || !started} title={started ? '' : 'Once the visit has started'} onClick={() => patch({ status: 'completed' }, 'Marked completed.')}>Completed</button>
            <button type="button" className="btn-secondary btn-sm" disabled={busy || !started} title={started ? '' : 'Once the visit has started'} onClick={() => patch({ status: 'no_show' }, 'Marked as a no-show.')}>No-show</button>
            <button type="button" className="btn-secondary btn-sm text-red-700 dark:text-red-300" disabled={busy}
              onClick={async () => { if (await confirm('The customer is emailed that it is cancelled, and the time is freed for others.', { title: 'Cancel this booking?', confirmText: 'Cancel booking' })) patch({ status: 'cancelled' }, 'Cancelled — the customer has been told.') }}>Cancel booking</button>
          </div>
          {!started && <p className="text-xs text-muted mt-2">Completed and no-show open once the visit has started.</p>}
        </section>
      )}
      {b.status === 'cancelled' && b.cancelledReason && <p className="text-sm text-muted mt-2">Cancelled: {b.cancelledReason === 'customer' ? 'by the customer' : b.cancelledReason === 'deposit_not_paid' ? 'the deposit wasn’t paid in time' : b.cancelledReason}.</p>}
    </div>
  )
}
