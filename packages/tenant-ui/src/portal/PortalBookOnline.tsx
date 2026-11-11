// Portal: book a visit online (parity tier 2 #5, 11/10 — ServiceTitan's and Housecall Pro's customer self-scheduling; feature
// portal_booking, not ready). The business's own booking pages, with the customer's name, email, phone and address already in the
// form (the booking script reads them through this portal's own link — site scripts/book-flow.ts), and the bookings they have made,
// each with the page that moves or cancels it.
import React, { useEffect, useState } from 'react'
import { CalendarPlus, ExternalLink } from 'lucide-react'
import { usePortal } from './PortalContext'
import { Spinner, PageTitle, Empty, card, formatWhenTime } from './common'

interface Booked { id: string; service: string | null; startAt: string; status: string; manageUrl: string | null }

export function PortalBookOnline() {
  const { config, fetch: portalFetch, company } = usePortal()
  const [data, setData] = useState<{ bookUrl: string; bookings: Booked[] } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { portalFetch('/book-online').then((d) => setData(d)).catch((e) => setError((e as Error).message)) }, [portalFetch])
  if (!data && !error) return <Spinner />
  return (
    <div>
      <PageTitle title={config.labels.bookOnline} subtitle="Pick a time that suits you. Your details are already filled in." />
      {error && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {data && (
        <>
          <a href={data.bookUrl} className="mb-6 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700">
            <CalendarPlus className="h-4 w-4" aria-hidden />Book a visit
          </a>
          <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-slate-100">Your bookings</h2>
          {!data.bookings.length ? <Empty icon={CalendarPlus} text="No bookings coming up." /> : (
            <div className="space-y-3">
              {data.bookings.map((b) => (
                <div key={b.id} className={`${card} flex flex-wrap items-center justify-between gap-3 p-4`}>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-slate-100">{b.service || 'Visit'}</p>
                    <p className="text-sm text-gray-600 dark:text-slate-400">{formatWhenTime(b.startAt, (company as any)?.timeZone)}{b.status === 'pending' ? ' · waiting to be confirmed' : ''}</p>
                  </div>
                  {b.manageUrl && <a href={b.manageUrl} className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-200">Change or cancel<ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
