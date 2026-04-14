import { useAuth } from '../contexts/AuthContext';

/**
 * Care paywall — shown when the 30-day trial has expired and the agency
 * has no paying subscription. Uses state-based nav via onUpgrade prop
 * (AdminDashboard switches currentPage → 'subscription-pricing' on click).
 */
export default function PaywallPage({ onUpgrade }: { onUpgrade?: () => void }) {
  const { company, logout } = useAuth();

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f9fafb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        style={{
          maxWidth: '32rem',
          width: '100%',
          background: '#fff',
          borderRadius: '1rem',
          boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: 'linear-gradient(135deg, #dc2626 0%, #ea580c 100%)',
            padding: '2.5rem 2rem',
            color: '#fff',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '4rem',
              height: '4rem',
              background: 'rgba(255,255,255,0.2)',
              borderRadius: '9999px',
              marginBottom: '1rem',
              fontSize: '2rem',
            }}
          >
            🔒
          </div>
          <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.5rem', fontWeight: 700 }}>
            Your free trial has ended
          </h1>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.9)' }}>
            {company?.name ? `${company.name}'s agency ` : 'Your agency '}is locked until you upgrade.
          </p>
        </div>

        <div style={{ padding: '2rem' }}>
          <div
            style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '0.5rem',
              padding: '1rem',
              marginBottom: '1.5rem',
              display: 'flex',
              gap: '0.75rem',
            }}
          >
            <div style={{ fontSize: '1.25rem' }}>🛡️</div>
            <div>
              <p style={{ margin: 0, fontWeight: 600, color: '#166534' }}>Your data is safe</p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#166534' }}>
                Every client, caregiver, visit, care plan, claim, and document you created
                during your trial is still here. Upgrade at any time and everything unlocks
                exactly as you left it.
              </p>
            </div>
          </div>

          <p style={{ fontSize: '0.875rem', color: '#4b5563', marginBottom: '1rem' }}>
            Pick a plan that fits your agency and you&apos;re back in business in under a minute.
          </p>
          <button
            onClick={onUpgrade}
            style={{
              display: 'block',
              width: '100%',
              background: '#7c3aed',
              color: '#fff',
              fontWeight: 600,
              padding: '0.75rem',
              borderRadius: '0.5rem',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Upgrade to unlock →
          </button>

          <div
            style={{
              paddingTop: '1rem',
              marginTop: '1rem',
              borderTop: '1px solid #f3f4f6',
              textAlign: 'center',
            }}
          >
            <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: 0 }}>
              Questions?{' '}
              <a href="mailto:support@twomiah.com" style={{ color: '#7c3aed' }}>
                Contact support
              </a>{' '}
              or{' '}
              <button
                onClick={logout}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#7c3aed',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                  fontSize: 'inherit',
                }}
              >
                sign out
              </button>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
