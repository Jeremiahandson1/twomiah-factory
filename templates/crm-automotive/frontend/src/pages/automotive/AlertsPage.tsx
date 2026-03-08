import { useState, useEffect, useCallback } from 'react';
import { Bell, BellOff, Phone, Eye, X, Loader2, Clock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const API = import.meta.env.VITE_API_URL || '';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function AlertsPage() {
  const { token } = useAuth();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [dismissing, setDismissing] = useState<number | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = showAll ? '?all=true' : '';
      const res = await fetch(`${API}/api/alerts${params}`, { headers });
      const data = await res.json();
      setAlerts(data.data || data || []);
    } catch { /* */ } finally { setLoading(false); }
  }, [showAll, token]);

  const loadCount = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/alerts/count`, { headers });
      const data = await res.json();
      setUnreadCount(data.count || 0);
    } catch { /* */ }
  }, [token]);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);
  useEffect(() => { loadCount(); }, [loadCount]);

  const handleDismiss = async (id: number) => {
    setDismissing(id);
    try {
      await fetch(`${API}/api/alerts/${id}/dismiss`, { method: 'POST', headers });
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, dismissed: true } : a));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* */ } finally { setDismissing(null); }
  };

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Service-to-Sales Alerts</h1>
          {unreadCount > 0 && (
            <span style={{ background: '#ef4444', color: '#fff', fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 10, minWidth: 20, textAlign: 'center' }}>
              {unreadCount}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowAll(!showAll)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: showAll ? '#f3f4f6' : '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          {showAll ? <Bell size={15} /> : <BellOff size={15} />}
          {showAll ? 'Show unread only' : 'Show all'}
        </button>
      </div>

      {/* Alert list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Loader2 size={24} className="animate-spin" /></div>
      ) : alerts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <Bell size={44} style={{ margin: '0 auto 16px', opacity: 0.4 }} />
          <p style={{ fontSize: 16, fontWeight: 500 }}>No alerts</p>
          <p style={{ fontSize: 14, marginTop: 4 }}>
            When a customer with an active lead checks into service, you'll see it here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {alerts.map((alert: any) => (
            <div
              key={alert.id}
              style={{
                background: alert.dismissed ? '#f9fafb' : '#fff',
                border: `1px solid ${alert.dismissed ? '#e5e7eb' : '#fbbf24'}`,
                borderRadius: 10,
                padding: 18,
                opacity: alert.dismissed ? 0.7 : 1,
              }}
            >
              {/* Top row: customer + time */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{alert.customerName || 'Unknown Customer'}</span>
                  {alert.customerPhone && (
                    <span style={{ marginLeft: 10, color: '#6b7280', fontSize: 13 }}>{alert.customerPhone}</span>
                  )}
                </div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#9ca3af', fontSize: 12, whiteSpace: 'nowrap' }}>
                  <Clock size={12} /> {timeAgo(alert.createdAt)}
                </span>
              </div>

              {/* Message */}
              <p style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>{alert.message || alert.alertMessage}</p>

              {/* Meta */}
              <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                {alert.roNumber && <span>RO #{alert.roNumber}</span>}
                {alert.vehicleInterest && <span>Interested in: {alert.vehicleInterest}</span>}
              </div>

              {/* Actions */}
              {!alert.dismissed && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => handleDismiss(alert.id)}
                    disabled={dismissing === alert.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer', opacity: dismissing === alert.id ? 0.6 : 1 }}
                  >
                    {dismissing === alert.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Dismiss
                  </button>
                  {alert.customerPhone && (
                    <a
                      href={`tel:${alert.customerPhone}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 6, border: 'none', background: '#059669', color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}
                    >
                      <Phone size={14} /> Call
                    </a>
                  )}
                  <a
                    href="/leads"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 6, border: '1px solid #2563eb', background: '#fff', color: '#2563eb', fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}
                  >
                    <Eye size={14} /> View Lead
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
