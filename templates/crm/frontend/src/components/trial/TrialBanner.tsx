import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Trial countdown banner.
 *
 * Shows a yellow "7 days left" banner when the tenant is within 7 days of
 * trial expiry, a red "3 days left" / "1 day left" / "today" banner as
 * urgency escalates. Hidden entirely when the tenant has a paying
 * subscription or the trial is more than 7 days out.
 *
 * Expiry is taken from company.settings.trialEndsAt. If that is missing,
 * we fall back to (company.createdAt + 30 days) so legacy tenants that
 * were provisioned before the trial field existed still get the banner.
 */
export function TrialBanner() {
  const { company } = useAuth();

  const { daysRemaining, urgent, hidden } = useMemo(() => {
    if (!company) return { daysRemaining: 0, urgent: false, hidden: true };

    const sub = company.settings?.subscriptionStatus;
    if (sub === 'active' || sub === 'past_due') {
      // Paying customer — no banner
      return { daysRemaining: 0, urgent: false, hidden: true };
    }

    let trialEnd: Date | null = null;
    if (company.settings?.trialEndsAt) {
      trialEnd = new Date(company.settings.trialEndsAt);
    } else if ((company as any).createdAt) {
      trialEnd = new Date((company as any).createdAt);
      trialEnd.setDate(trialEnd.getDate() + 30);
    }
    if (!trialEnd || isNaN(trialEnd.getTime())) {
      return { daysRemaining: 0, urgent: false, hidden: true };
    }

    const msRemaining = trialEnd.getTime() - Date.now();
    const days = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));

    if (days > 7) return { daysRemaining: days, urgent: false, hidden: true };

    return {
      daysRemaining: days,
      urgent: days <= 3,
      hidden: false,
    };
  }, [company]);

  if (hidden) return null;

  const copy =
    daysRemaining === 0
      ? 'Your free trial ends today'
      : daysRemaining === 1
      ? 'Only 1 day left in your free trial'
      : `${daysRemaining} days left in your free trial`;

  const bg = urgent ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200';
  const text = urgent ? 'text-red-900' : 'text-yellow-900';
  const Icon = urgent ? AlertTriangle : Clock;
  const btn = urgent
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-yellow-600 hover:bg-yellow-700 text-white';

  return (
    <div className={`border-b ${bg} px-4 py-3`}>
      <div className="flex items-center justify-between gap-4 max-w-screen-2xl mx-auto">
        <div className={`flex items-center gap-2 ${text}`}>
          <Icon className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">{copy}</p>
            <p className="text-xs opacity-75">
              Upgrade now to keep uninterrupted access. Your data stays safe either way.
            </p>
          </div>
        </div>
        <Link
          to="/crm/settings/billing"
          className={`px-4 py-2 rounded-lg text-sm font-semibold flex-shrink-0 ${btn}`}
        >
          Upgrade
        </Link>
      </div>
    </div>
  );
}
