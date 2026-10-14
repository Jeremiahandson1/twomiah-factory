// The lock page — one implementation for every CRM; each template's pages/PaywallPage.tsx hands it that template's
// signed-in company and sign-out. Every protected route sends a locked company here (ProtectedRoute), and every API
// refusal with ACCOUNT_LOCKED does too (api/client.ts).
//
// It used to say "Your free trial has ended" to everyone. A company that paid and then cancelled was never sent here
// at all (10/14), and once it is, telling it its trial ended would be wrong — so the words follow WHY it is locked.
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Shield, ArrowRight } from 'lucide-react'
import { accountLockReason } from './trialStatus'

type PaywallCompany = { name?: string | null; settings?: { accountLock?: string | null; trialEndsAt?: string; subscriptionStatus?: string } | null } | null | undefined

export function PaywallScreen({ company, onSignOut }: { company: PaywallCompany; onSignOut: () => void }) {
  const navigate = useNavigate()
  const ended = accountLockReason(company as any) === 'subscription_ended'
  const whose = company?.name ? `${company.name}'s CRM` : 'Your CRM'

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 dark:bg-slate-900">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl overflow-hidden dark:bg-slate-800">
        <div className="bg-gradient-to-br from-red-600 to-orange-600 px-8 py-10 text-white text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-full mb-4">
            <Lock className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold mb-2">{ended ? 'Your subscription has ended' : 'Your free trial has ended'}</h1>
          <p className="text-white/90">{whose} is locked until {ended ? 'the subscription is restarted' : 'you choose a plan'}.</p>
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

          {ended ? (
            <div>
              <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">
                The account owner can restart it — email Twomiah support and we will set it up again.
              </p>
              <a
                href="mailto:support@twomiah.com?subject=Restart%20my%20subscription"
                className="flex items-center justify-center gap-2 w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                Email support to restart
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">
                Pick a plan that fits your team and you&apos;re back in business in under a minute.
              </p>
              <button
                type="button"
                onClick={() => navigate('/crm/settings/billing')}
                className="flex items-center justify-center gap-2 w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                Upgrade to unlock
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="pt-4 border-t border-gray-100 text-center dark:border-slate-700">
            <p className="text-xs text-gray-500 dark:text-slate-400">
              Questions?{' '}
              <a href="mailto:support@twomiah.com" className="text-orange-600 hover:underline dark:text-orange-300">Contact support</a>
              {' '}or{' '}
              <button type="button" onClick={onSignOut} className="text-orange-600 hover:underline dark:text-orange-300">sign out</button>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
