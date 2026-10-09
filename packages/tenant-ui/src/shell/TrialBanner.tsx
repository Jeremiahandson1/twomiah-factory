// Trial countdown banner: yellow within 7 days of trial expiry, red within 3. Hidden for paying tenants.
// Expiry comes from trialEndDate — the same function the paywall gate uses, so the banner can never
// count down to a lock that will not happen, or stay silent before one that will. (T60)
import { useMemo } from 'react'
import { AlertTriangle, Clock } from 'lucide-react'
import { NavLink } from '../invoicing/ui'
import { trialEndDate } from '../auth/trialStatus'
import { useAuth } from '../auth/AuthContext'
import { meetsRole } from './types'

export function TrialBanner({ company }: { company: any }) {
  // Upgrade opens Billing, which is the owner's and the admins' (/api/billing is requireAdmin). Offering it to
  // anyone else led to a "no access" page (T60); they are told who can upgrade instead.
  const { user } = useAuth() as any
  const mayUpgrade = meetsRole(user?.role, 'admin')
  const { daysRemaining, urgent, hidden } = useMemo(() => {
    const trialEnd = trialEndDate(company)
    if (!trialEnd) return { daysRemaining: 0, urgent: false, hidden: true }
    const days = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86400000))
    if (days > 7) return { daysRemaining: days, urgent: false, hidden: true }
    return { daysRemaining: days, urgent: days <= 3, hidden: false }
  }, [company])

  if (hidden) return null
  const copy = daysRemaining === 0 ? 'Your free trial ends today' : daysRemaining === 1 ? 'Only 1 day left in your free trial' : `${daysRemaining} days left in your free trial`
  const Icon = urgent ? AlertTriangle : Clock
  return (
    <div className={`border-b px-4 py-3 ${urgent ? 'bg-red-50 border-red-200 dark:bg-red-950/40 dark:text-slate-100' : 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/40 dark:text-slate-100'}`}>
      <div className="flex items-center justify-between gap-4 max-w-screen-2xl mx-auto">
        <div className={`flex items-center gap-2 ${urgent ? 'text-red-900 dark:text-red-400' : 'text-yellow-900 dark:text-yellow-300'}`}>
          <Icon className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">{copy}</p>
            <p className="text-xs">{mayUpgrade ? 'Upgrade now to keep uninterrupted access.' : 'Ask the account owner to upgrade to keep uninterrupted access.'} Your data stays safe either way.</p>
          </div>
        </div>
        {mayUpgrade && <NavLink to="/crm/settings/billing" className={`px-4 py-2 rounded-lg text-sm font-semibold flex-shrink-0 text-white ${urgent ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-700 hover:bg-yellow-800'}`}>Upgrade</NavLink>}
      </div>
    </div>
  )
}
