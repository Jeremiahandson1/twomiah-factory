import IntegrationsHub from '../components/admin/IntegrationsHub';
import { useAuth } from '../contexts/AuthContext';

export default function SettingsPage() {
  const { user } = useAuth();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '';

  const openSmsBilling = async () => {
    try {
      const res = await fetch('/api/messaging-billing/portal-link', { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json();
      if (res.ok && d.url) window.open(d.url, '_blank');
      else alert(d.error || 'Could not open billing');
    } catch { alert('Could not open billing'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, margin: 16 }}>
        <div>
          <div style={{ fontWeight: 600, color: '#111827' }}>SMS &amp; AI Usage</div>
          <div style={{ fontSize: 14, color: '#6b7280' }}>Enable texting &amp; AI and manage your at-cost usage wallet.</div>
        </div>
        <button onClick={openSmsBilling} style={{ padding: '9px 14px', fontWeight: 600, background: '#4f46e5', color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>Manage billing &rarr;</button>
      </div>
      <IntegrationsHub token={token} user={user} />
    </div>
  );
}
