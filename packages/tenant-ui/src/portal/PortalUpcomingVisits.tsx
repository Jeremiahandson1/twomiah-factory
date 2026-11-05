// Portal upcoming visits (field service, basic): the visits still to come, each with a Confirm button — Jobber's "confirm from the
// Client Hub". The same confirmation the link in a reminder and a text back of "Y" make (unified app crm/field/jobConfirm.ts).
import React, { useState, useEffect } from 'react'
import { CalendarCheck, Check } from 'lucide-react'
import { usePortal } from './PortalContext'
import { Spinner, PageTitle, Empty, card } from './common'

export interface PortalUpcomingVisit { jobId: string; title: string; when: string; address: string; confirmed: boolean; confirmedAt: string | null }

export function PortalUpcomingVisits() {
  const { config, fetch: portalFetch } = usePortal()
  const [visits, setVisits] = useState<PortalUpcomingVisit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  useEffect(() => { portalFetch('/upcoming-visits').then((d) => setVisits(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch])
  const confirmVisit = async (jobId: string) => {
    setBusy(jobId); setError('')
    try {
      const v = await portalFetch(`/upcoming-visits/${jobId}/confirm`, { method: 'POST', body: JSON.stringify({}) })
      setVisits((list) => list.map((x) => (x.jobId === jobId ? { ...x, confirmed: true, confirmedAt: v?.confirmedAt ?? new Date().toISOString() } : x)))
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  if (loading) return <Spinner />
  return (
    <div>
      <PageTitle title={config.labels.upcomingVisits} subtitle="Let us know you will be there." />
      {error && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {visits.length === 0 ? <Empty icon={CalendarCheck} text="No visits are scheduled right now." /> : (
        <div className="space-y-4">
          {visits.map((v) => (
            <div key={v.jobId} className={`${card} p-5`}>
              <h3 className="font-semibold text-gray-900 dark:text-slate-100">{v.title}</h3>
              <p className="mt-1 text-sm text-gray-700 dark:text-slate-300">{v.when}</p>
              {v.address && <p className="text-sm text-gray-600 dark:text-slate-400">{v.address}</p>}
              <div className="mt-3">
                {v.confirmed
                  ? <span className="inline-flex items-center gap-1 text-sm font-medium text-green-700 dark:text-green-400"><Check className="h-4 w-4" aria-hidden />You have confirmed this visit</span>
                  : <button type="button" disabled={busy === v.jobId} onClick={() => confirmVisit(v.jobId)} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50">{busy === v.jobId ? 'Confirming…' : 'Confirm this visit'}</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
