import { useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Care trial countdown banner. Unlike the react-router templates, Care
 * uses state-based navigation, so the upgrade button takes an onUpgrade
 * callback instead of a <Link>. AdminDashboard is expected to pass
 *   onUpgrade={() => setCurrentPage('subscription-pricing')}
 */
export function TrialBanner({ onUpgrade }: { onUpgrade?: () => void }) {
  const { company } = useAuth();

  const { daysRemaining, urgent, hidden } = useMemo(() => {
    if (!company) return { daysRemaining: 0, urgent: false, hidden: true };

    const settings = typeof company.settings === 'string'
      ? (() => { try { return JSON.parse(company.settings); } catch { return {}; } })()
      : (company.settings || {});

    const sub = settings.subscriptionStatus;
    if (sub === 'active' || sub === 'past_due') {
      return { daysRemaining: 0, urgent: false, hidden: true };
    }

    let trialEnd: Date | null = null;
    if (settings.trialEndsAt) {
      trialEnd = new Date(settings.trialEndsAt);
    } else if (company.createdAt) {
      trialEnd = new Date(company.createdAt);
      trialEnd.setDate(trialEnd.getDate() + 30);
    }
    if (!trialEnd || isNaN(trialEnd.getTime())) {
      return { daysRemaining: 0, urgent: false, hidden: true };
    }

    const msRemaining = trialEnd.getTime() - Date.now();
    const days = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));

    if (days > 7) return { daysRemaining: days, urgent: false, hidden: true };

    return { daysRemaining: days, urgent: days <= 3, hidden: false };
  }, [company]);

  if (hidden) return null;

  const copy =
    daysRemaining === 0
      ? 'Your free trial ends today'
      : daysRemaining === 1
      ? 'Only 1 day left in your free trial'
      : `${daysRemaining} days left in your free trial`;

  const bg = urgent ? '#fef2f2' : '#fefce8';
  const border = urgent ? '#fecaca' : '#fde68a';
  const text = urgent ? '#991b1b' : '#92400e';
  const btnBg = urgent ? '#dc2626' : '#ca8a04';

  return (
    <div
      style={{
        background: bg,
        borderBottom: `1px solid ${border}`,
        padding: '0.75rem 1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
      }}
    >
      <div style={{ color: text }}>
        <p style={{ margin: 0, fontWeight: 600 }}>{copy}</p>
        <p style={{ margin: 0, fontSize: '0.75rem', opacity: 0.75 }}>
          Upgrade now to keep uninterrupted access. Your data stays safe either way.
        </p>
      </div>
      <button
        onClick={onUpgrade}
        style={{
          background: btnBg,
          color: '#fff',
          padding: '0.5rem 1rem',
          borderRadius: '6px',
          border: 'none',
          fontWeight: 600,
          fontSize: '0.875rem',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        Upgrade
      </button>
    </div>
  );
}
