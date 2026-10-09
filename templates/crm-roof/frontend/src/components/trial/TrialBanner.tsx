import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { trialEndDate } from '../auth/trialStatus';
import { meetsRole } from '../../shared';

/**
 * Trial countdown banner.
 *
 * Shows a yellow "7 days left" banner when the tenant is within 7 days of
 * trial expiry, a red "3 days left" / "1 day left" / "today" banner as
 * urgency escalates. Hidden entirely when the tenant has a paying
 * subscription or the trial is more than 7 days out.
 *
 * Expiry comes from trialEndDate — the function the paywall gate uses — so the banner never counts
 * down to a lock that will not happen. (T60: it guessed createdAt + 30 days, and lied to managers.)
 */
export function TrialBanner() {
  // Upgrade opens Billing, which is the owner's and the admins' (/api/billing is requireAdmin). Offering it to
  // anyone else led to a "no access" page (T60); they are told who can upgrade instead.
  const { company, user } = useAuth();
  const mayUpgrade = meetsRole((user as any)?.role, 'admin');

  const { daysRemaining, urgent, hidden } = useMemo(() => {
    const trialEnd = trialEndDate(company as any);
    if (!trialEnd) {
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
    : 'bg-yellow-700 hover:bg-yellow-800 text-white';

  return (
    <div className={`border-b ${bg} px-4 py-3`}>
      <div className="flex items-center justify-between gap-4 max-w-screen-2xl mx-auto">
        <div className={`flex items-center gap-2 ${text}`}>
          <Icon className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">{copy}</p>
            <p className="text-xs">
              {mayUpgrade ? 'Upgrade now to keep uninterrupted access.' : 'Ask the account owner to upgrade to keep uninterrupted access.'} Your data stays safe either way.
            </p>
          </div>
        </div>
        {mayUpgrade && (
          <Link
            to="/crm/settings/billing"
            className={`px-4 py-2 rounded-lg text-sm font-semibold flex-shrink-0 ${btn}`}
          >
            Upgrade
          </Link>
        )}
      </div>
    </div>
  );
}
