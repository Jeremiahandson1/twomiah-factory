// The client portal's Notifications: the office's notices about visits, caregivers and billing. Moved from
// templates/crm-homecare/frontend/src/components/portal/PortalNotifications.tsx.
//
// Server (server/crm/homecare/portals/clientPortal.ts): GET /api/portal/notifications — a list (the last 50) of { id,
// type, title, message, isRead, createdAt }; PUT /api/portal/notifications/read-all and PUT …/:id/read → { success }.
import { useEffect, useState } from 'react'
import { formatAgencyDate } from '../lib/agencyClock'
import { listRows, usePortal } from './portalHttp'

interface Notice { id: string; type: string | null; title: string; message: string | null; isRead: boolean; createdAt: string }

const ICONS: Record<string, string> = {
  caregiver_late: '⏰',
  caregiver_no_show: '⚠️',
  visit_cancelled: '❌',
  visit_rescheduled: '📅',
  visit_scheduled: '📅',
  invoice_ready: '📄',
  payment_due: '💳',
  payment_received: '✅',
  caregiver_assigned: '👤',
  caregiver_removed: '👋',
}
const typeIcon = (type: string | null) => (type && ICONS[type]) || '🔔'

const formatRelativeTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  // An instant's day on the agency's clock.
  return formatAgencyDate(iso, { month: 'short', day: 'numeric' })
}

export default function PortalNotifications({ onRead }: { onRead?: () => void }) {
  const portal = usePortal()
  const [notifications, setNotifications] = useState<Notice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    portal.get('/api/portal/notifications')
      .then((reply) => { if (reply) setNotifications(listRows<Notice>(reply)) })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [portal])

  const markAllRead = async () => {
    try {
      await portal.send('PUT', '/api/portal/notifications/read-all')
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
      onRead?.()
    } catch { /* stays unread */ }
  }

  const markRead = async (id: string) => {
    try {
      await portal.send('PUT', `/api/portal/notifications/${id}/read`)
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
    } catch { /* stays unread */ }
  }

  const unreadCount = notifications.filter((n) => !n.isRead).length

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--hc-muted)' }}>Loading notifications...</div>
  if (error) return <div className="alert alert-error">{error}</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '1.3rem', color: 'var(--hcp-navy)' }}>
          🔔 Notifications
          {unreadCount > 0 && (
            <span style={{ background: 'var(--hcp-pill)', color: '#fff', borderRadius: '10px', padding: '2px 8px', fontSize: '0.75rem', marginLeft: '10px', verticalAlign: 'middle' }}>
              {unreadCount} new
            </span>
          )}
        </h2>

        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            style={{ background: 'none', border: '1px solid var(--hc-blue-ink)', color: 'var(--hc-blue-ink)', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem' }}
          >
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div style={{ background: 'var(--hc-surface)', borderRadius: '12px', padding: '48px', textAlign: 'center', color: 'var(--hc-muted)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🔔</div>
          <div>No notifications yet.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => { if (!n.isRead) markRead(n.id) }}
              style={{
                background: n.isRead ? 'var(--hc-surface)' : 'var(--hcp-unread)',
                borderRadius: '12px', padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                cursor: n.isRead ? 'default' : 'pointer',
                borderLeft: n.isRead ? '4px solid var(--hc-line)' : '4px solid var(--hcp-mark)',
                display: 'flex', gap: '14px', alignItems: 'flex-start', transition: 'background 0.2s',
              }}
            >
              <span style={{ fontSize: '1.4rem', flexShrink: 0, marginTop: '2px' }}>{typeIcon(n.type)}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ fontWeight: n.isRead ? 500 : 700, color: 'var(--hcp-navy)', fontSize: '0.92rem' }}>{n.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--hc-muted)', flexShrink: 0 }}>{formatRelativeTime(n.createdAt)}</div>
                </div>
                {n.message && <div style={{ fontSize: '0.85rem', color: 'var(--hc-ink-soft)', marginTop: '3px', lineHeight: 1.5 }}>{n.message}</div>}
              </div>
              {!n.isRead && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--hcp-mark)', flexShrink: 0, marginTop: '6px' }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
