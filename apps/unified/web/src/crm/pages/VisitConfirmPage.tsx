// /confirm-visit/<token>: the page behind the link in a visit reminder (server crm/field/jobConfirm.ts, /api/visit-confirm/<token>).
// The customer sees the one visit and presses Confirm — no sign-in, nothing else of theirs is reachable from here.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarCheck, Check, Loader2 } from 'lucide-react'

interface Visit { jobId: string; title: string; when: string; address: string; companyName: string; confirmed: boolean; confirmedAt: string | null; open: boolean }

const call = async (token: string, method: 'GET' | 'POST'): Promise<Visit> => {
  const r = await fetch(`/api/visit-confirm/${encodeURIComponent(token)}`, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'POST' ? '{}' : undefined })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body?.error || body?.message || 'This link is not valid any more.')
  return (body?.data ?? body) as Visit
}

export default function VisitConfirmPage() {
  const { token = '' } = useParams()
  const [visit, setVisit] = useState<Visit | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { call(token, 'GET').then(setVisit).catch((e) => setError((e as Error).message)) }, [token])
  const confirm = async () => {
    setBusy(true); setError('')
    try { setVisit(await call(token, 'POST')) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12 dark:bg-slate-950">
      <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <CalendarCheck className="h-8 w-8 text-orange-600" aria-hidden />
        {!visit && !error && <p className="mt-4 flex items-center gap-2 text-gray-700 dark:text-slate-300"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading your visit…</p>}
        {error && <p role="alert" className="mt-4 text-red-700 dark:text-red-300">{error}</p>}
        {visit && (
          <>
            <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">{visit.companyName}</p>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">{visit.title}</h1>
            <p className="mt-2 text-gray-800 dark:text-slate-200">{visit.when}</p>
            {visit.address && <p className="text-sm text-gray-600 dark:text-slate-400">{visit.address}</p>}
            <div className="mt-6">
              {visit.confirmed
                ? <p className="inline-flex items-center gap-2 font-medium text-green-700 dark:text-green-400"><Check className="h-5 w-5" aria-hidden />Thank you — your visit is confirmed.</p>
                : !visit.open
                  ? <p className="text-gray-700 dark:text-slate-300">This visit has already happened or was cancelled.</p>
                  : <button type="button" onClick={confirm} disabled={busy} className="w-full rounded-lg bg-orange-600 px-4 py-3 font-medium text-white hover:bg-orange-700 disabled:opacity-50">{busy ? 'Confirming…' : 'Confirm this visit'}</button>}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
