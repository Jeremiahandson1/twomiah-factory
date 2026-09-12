// Trial countdown banner: yellow within 7 days of trial expiry, red within 3. Hidden for paying tenants.
// Expiry = company.settings.trialEndsAt, falling back to createdAt + 30 days for tenants provisioned
// before the field existed.
import { useMemo } from 'react'
import { AlertTriangle, Clock } from 'lucide-react'
import { NavLink } from '../invoicing/ui'

export function TrialBanner({ company }: { company: any }) {
  const { daysRemaining, urgent, hidden } = useMemo(() => {
    if (!company) return { daysRemaining: 0, urgent: false, hidden: true }
    const sub = company.settings?.subscriptionStatus
    if (sub === 'active' || sub === 'past_due') return { daysRemaining: 0, urgent: false, hidden: true }
    let trialEnd: Date | null = null
    if (company.settings?.trialEndsAt) trialEnd = new Date(company.settings.trialEndsAt)
    else if (company.createdAt) { trialEnd = new Date(company.createdAt); trialEnd.setDate(trialEnd.getDate() + 30) }
    if (!trialEnd || isNaN(trialEnd.getTime())) return { daysRemaining: 0, urgent: false, hidden: true }
    const days = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86400000))
    if (days > 7) return { daysRemaining: days, urgent: false, hidden: true }
    return { daysRemaining: days, urgent: days <= 3, hidden: false }
  }, [company])

  if (hidden) return null
  const copy = daysRemaining === 0 ? 'Your free trial ends today' : daysRemaining === 1 ? 'Only 1 day left in your free trial' : `${daysRemaining} days left in your free trial`
  const Icon = urgent ? AlertTriangle : Clock
  return (
    <div className={`border-b px-4 py-3 ${urgent ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
      <div className="flex items-center justify-between gap-4 max-w-screen-2xl mx-auto">
        <div className={`flex items-center gap-2 ${urgent ? 'text-red-900' : 'text-yellow-900'}`}>
          <Icon className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">{copy}</p>
            <p className="text-xs opacity-75">Upgrade now to keep uninterrupted access. Your data stays safe either way.</p>
          </div>
        </div>
        <NavLink to="/crm/settings/billing" className={`px-4 py-2 rounded-lg text-sm font-semibold flex-shrink-0 text-white ${urgent ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}>Upgrade</NavLink>
      </div>
    </div>
  )
}
