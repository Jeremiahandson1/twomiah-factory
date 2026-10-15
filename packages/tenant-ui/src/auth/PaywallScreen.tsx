// The lock page — one implementation for every CRM; each template's pages/PaywallPage.tsx hands it that template's
// signed-in company, sign-out and API client. Every protected route sends a locked company here (ProtectedRoute), and
// every API refusal with ACCOUNT_LOCKED does too (api/client.ts).
//
// The words follow WHY it is locked — an ended subscription is not a trial that ran out (10/14). And the way back is a
// payment, not an email: "shouldnt they just be able to make a payment and restart it? why email?" (owner, 10/14).
// The owner presses Restart → the Factory opens a Stripe checkout for the company's own plan → Stripe sends them back
// here with ?restarted=1 → this page waits for the payment to reach the CRM, then opens it. Anyone else is told to ask
// the owner, because changing what the business pays for is theirs (billing:manage, server-enforced).
import React, { useEffect, useRef, useState } from 'react'
import { Lock, Shield, ArrowRight, Loader2 } from 'lucide-react'
import { accountLockReason } from './trialStatus'

type PaywallCompany = { name?: string | null; settings?: { accountLock?: string | null; trialEndsAt?: string; subscriptionStatus?: string } | null } | null | undefined
/** The template's API client, as one call: resolves the parsed body, throws an error carrying .message on a refusal. */
type Request = (method: 'GET' | 'POST', path: string) => Promise<any>

const WAIT_MS = 90_000
const POLL_MS = 3_000

/**
 * Still locked, by /api/auth/me? The CRMs answer it in company.settings.accountLock; crm-store, which has no company
 * row, answers it at the top level (accountLock). A /me that did not answer is "don't know" → keep waiting.
 */
function stillLocked(me: any): boolean | null {
  if (!me?.user) return null
  return !!(me.company ? me.company.settings?.accountLock : me.accountLock)
}

export function PaywallScreen({ company, onSignOut, request, homePath = '/crm' }: { company: PaywallCompany; onSignOut: () => void; request: Request; /** Where the CRM opens once unlocked: /crm, or / in crm-store. */ homePath?: string }) {
  const ended = accountLockReason(company as any) === 'subscription_ended'
  const whose = company?.name ? `${company.name}'s CRM` : 'Your CRM'
  const restarted = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('restarted') === '1'

  // May this person restart it? Settings → Billing answers mayManage; anyone it refuses (a manager, a technician) may not.
  const [mayManage, setMayManage] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [waiting, setWaiting] = useState<'polling' | 'slow' | null>(restarted ? 'polling' : null)
  const stopped = useRef(false)

  useEffect(() => {
    request('GET', '/api/billing/subscription').then((r) => setMayManage(!!r?.mayManage), () => setMayManage(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Back from Stripe: ask until the CRM says it is open. /api/billing/subscription pulls the Factory's summary afresh
  // (the owner's way, if the Factory's push was missed); /api/auth/me says whether the company is still locked.
  useEffect(() => {
    if (!restarted) return
    stopped.current = false
    const started = Date.now()
    const tick = async () => {
      if (stopped.current) return
      await request('GET', '/api/billing/subscription').catch(() => null)
      const me = await request('GET', '/api/auth/me').catch(() => null)
      if (stillLocked(me) === false) { window.location.assign(homePath); return }
      if (Date.now() - started > WAIT_MS) { setWaiting('slow'); return }
      setTimeout(tick, POLL_MS)
    }
    tick()
    return () => { stopped.current = true }
  }, [restarted]) // eslint-disable-line react-hooks/exhaustive-deps

  const restart = async () => {
    setBusy(true); setError('')
    try {
      const r = await request('POST', '/api/billing/restart-checkout')
      if (r?.url) { window.location.assign(r.url); return }
      setError('The checkout did not open. Try again in a moment.')
    } catch (e: any) {
      setError(e?.message || 'The checkout did not open. Try again in a moment.')
    }
    setBusy(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 dark:bg-slate-900">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl overflow-hidden dark:bg-slate-800">
        <div className="bg-gradient-to-br from-red-600 to-orange-600 px-8 py-10 text-white text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-full mb-4">
            <Lock className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold mb-2">{ended ? 'Your subscription has ended' : 'Your free trial has ended'}</h1>
          <p className="text-white/90">{whose} is locked until {ended ? 'the subscription is restarted' : 'a plan is chosen'}.</p>
        </div>

        <div className="p-8 space-y-6">
          <div className="flex gap-3 bg-green-50 border border-green-200 rounded-lg p-4 dark:bg-green-950/40 dark:border-green-800">
            <Shield className="w-5 h-5 text-green-700 flex-shrink-0 mt-0.5 dark:text-green-300" />
            <div>
              <p className="font-semibold text-green-900 dark:text-green-300">Your data is safe</p>
              <p className="text-sm text-green-800 mt-1 dark:text-green-300">
                Every contact, job, quote, invoice, document and file is still here.
                {ended ? ' Restart the subscription and everything unlocks exactly as you left it.' : ' Choose a plan and everything unlocks exactly as you left it.'}
              </p>
            </div>
          </div>

          {waiting === 'polling' && (
            <div role="status" className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
              <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
              <span>Payment received — unlocking your CRM. This usually takes a few seconds.</span>
            </div>
          )}
          {waiting === 'slow' && (
            <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Your payment went through, but the CRM has not unlocked yet. Refresh this page in a minute — if it is still locked, email support@twomiah.com and we will open it straight away.
            </div>
          )}

          {!waiting && (
            <div>
              {mayManage === null && <p className="text-sm text-gray-600 dark:text-slate-400">Checking your account…</p>}
              {mayManage === true && (
                <>
                  <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">
                    {ended ? 'Restart it on the same plan — pay by card and you are back in straight away.' : 'Choose your plan — pay by card and you are back in straight away.'}
                  </p>
                  <button
                    type="button"
                    onClick={restart}
                    disabled={busy}
                    className="flex items-center justify-center gap-2 w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {busy ? 'Opening checkout…' : ended ? 'Restart subscription' : 'Choose a plan'}
                    {!busy && <ArrowRight className="w-4 h-4" />}
                  </button>
                  {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
                </>
              )}
              {mayManage === false && (
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  Only the account owner can {ended ? 'restart the subscription' : 'choose a plan'}. Ask them to sign in — the CRM opens again for everyone as soon as they do.
                </p>
              )}
            </div>
          )}

          <div className="pt-4 border-t border-gray-100 text-center dark:border-slate-700">
            <p className="text-xs text-gray-500 dark:text-slate-400">
              Questions?{' '}
              <a href="mailto:support@twomiah.com" className="text-orange-700 hover:underline dark:text-orange-300">Contact support</a>
              {' '}or{' '}
              <button type="button" onClick={onSignOut} className="text-orange-700 hover:underline dark:text-orange-300">sign out</button>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
