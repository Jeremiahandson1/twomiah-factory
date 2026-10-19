// The client portal once signed in: its header, its tabs and the tab's screen. Moved from
// templates/crm-homecare/frontend/src/components/portal/ClientPortal.tsx.
//
// Self-contained: it makes its own portal client from the token it is given (./portalHttp.ts), so the office's
// "View As → Client Portal" preview (a read-only token from POST /api/portal/admin/preview/:clientId) can mount it too,
// as the template's App.tsx did.
//
// Server: GET /api/portal/me (server/crm/homecare/portals/clientPortal.ts) — one record { firstName, lastName,
// agencyName, agencyState, agencyTimezone, summary: { unreadNotifications, unreadMessages, … }, … }. The template read
// first_name / agency_timezone / agency_state; the reply is camelCase. Polled each minute for the unread counts.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { setAgencyTimezone } from '../lib/agencyClock'
import { agencyNameFromPage, createPortalClient, PortalContext } from './portalHttp'
import PortalVisits from './PortalVisits'
import PortalHistory from './PortalHistory'
import PortalCaregivers from './PortalCaregivers'
import PortalInvoices from './PortalInvoices'
import PortalCarePlan from './PortalCarePlan'
import PortalMessages from './PortalMessages'
import PortalNotifications from './PortalNotifications'
import PortalDocuments from './PortalDocuments'
import './portals.css'

const NAV = [
  { key: 'visits', label: 'My Schedule', icon: '📅' },
  { key: 'history', label: 'Visit History', icon: '🕐' },
  { key: 'caregivers', label: 'My Caregivers', icon: '👤' },
  { key: 'care-plan', label: 'Care Plan', icon: '📋' },
  { key: 'invoices', label: 'Billing', icon: '📄' },
  { key: 'documents', label: 'Documents', icon: '📝' },
  { key: 'messages', label: 'Messages', icon: '💬' },
  { key: 'notifications', label: 'Notifications', icon: '🔔' },
] as const
type Tab = (typeof NAV)[number]['key']

interface Profile {
  firstName: string
  lastName: string
  agencyName: string | null
  agencyState: string | null
  agencyTimezone: string | null
  summary?: { unreadNotifications?: number; unreadMessages?: number }
}

export interface ClientPortalProps {
  /** The portal session's token (a sign-in, the emailed link's exchange, or the office's preview). */
  token: string
  /** Who signed in, as far as the sign-in said (shown until /me answers). */
  user?: { firstName?: string | null; lastName?: string | null } | null
  onLogout: () => void
  /** The agency's account is paused (402 ACCOUNT_LOCKED). */
  onPaused?: () => void
}

export default function ClientPortal({ token, user, onLogout, onPaused }: ClientPortalProps) {
  const portal = useMemo(() => createPortalClient(token, { expired: onLogout, paused: () => onPaused?.() }), [token, onLogout, onPaused])
  const [activeTab, setActiveTab] = useState<Tab>('visits')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 768)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  useEffect(() => {
    portal.get<Profile>('/api/portal/me')
      .then((data) => {
        if (!data) return
        setAgencyTimezone(data.agencyTimezone)
        setProfile(data)
        setUnreadCount(data.summary?.unreadNotifications || 0)
        setUnreadMessages(data.summary?.unreadMessages || 0)
      })
      .catch(() => {})

    // The unread counts, each minute.
    const interval = setInterval(() => {
      portal.get<Profile>('/api/portal/me')
        .then((data) => {
          if (!data) return
          setUnreadCount(data.summary?.unreadNotifications || 0)
          setUnreadMessages(data.summary?.unreadMessages || 0)
        })
        .catch(() => {})
    }, 60000)
    return () => clearInterval(interval)
  }, [portal])

  const renderView = () => {
    switch (activeTab) {
      case 'history': return <PortalHistory />
      case 'caregivers': return <PortalCaregivers agencyState={profile?.agencyState} />
      case 'care-plan': return <PortalCarePlan />
      case 'invoices': return <PortalInvoices />
      case 'documents': return <PortalDocuments />
      case 'messages': return <PortalMessages onRead={() => setUnreadMessages((prev) => Math.max(0, prev - 1))} />
      case 'notifications': return <PortalNotifications onRead={() => setUnreadCount(0)} />
      default: return <PortalVisits />
    }
  }

  const clientName = profile
    ? `${profile.firstName} ${profile.lastName}`
    : user?.firstName ? `${user.firstName} ${user.lastName ?? ''}` : 'Welcome'

  const pill = (n: number): CSSProperties => ({
    background: 'var(--hcp-pill)', color: '#fff', borderRadius: '10px', padding: '1px 6px', fontSize: '0.7rem', fontWeight: 700,
    position: isMobile ? 'absolute' : 'static', top: isMobile ? 4 : 'auto', right: isMobile ? 6 : 'auto',
    display: n > 0 ? undefined : 'none',
  })

  return (
    <PortalContext.Provider value={portal}>
      <div style={{ minHeight: '100vh', background: 'var(--hc-ground)' }}>

        {/* ── Header: white on a fixed navy gradient, in both themes ── */}
        <div style={{
          background: 'linear-gradient(135deg, #1a5276 0%, #2980b9 100%)', color: '#fff', padding: '0 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '60px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)', position: 'sticky', top: 0, zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>🏠</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>{profile?.agencyName || agencyNameFromPage()}</div>
              <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>Client Portal</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '0.85rem', opacity: 0.9 }}>{clientName}</span>
            <button
              onClick={onLogout}
              style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* ── Tabs. On a phone each tab stacks its icon over its label and the row scrolls sideways, so every tab is
             reachable in portrait without shrinking to nothing. ── */}
        <div style={{
          background: 'var(--hc-surface)', borderBottom: '1px solid var(--hc-line)', display: 'flex',
          padding: isMobile ? '0' : '0 20px', gap: isMobile ? 0 : '4px', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
        }}>
          {NAV.map((tab) => {
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  background: 'none', border: 'none', padding: isMobile ? '10px 4px' : '14px 18px', cursor: 'pointer',
                  fontSize: isMobile ? '0.7rem' : '0.88rem', fontWeight: active ? 600 : 400,
                  color: active ? 'var(--hcp-navy)' : 'var(--hc-ink-soft)',
                  borderBottom: active ? '3px solid var(--hcp-navy)' : '3px solid transparent',
                  whiteSpace: 'nowrap', display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center',
                  justifyContent: 'center', gap: isMobile ? '2px' : '6px', position: 'relative',
                  flex: isMobile ? '1 0 72px' : '0 0 auto', minWidth: isMobile ? '72px' : 0,
                }}
              >
                <span style={{ fontSize: isMobile ? '1.15rem' : 'inherit' }}>{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.key === 'notifications' && <span style={pill(unreadCount)}>{unreadCount}</span>}
                {tab.key === 'messages' && <span style={pill(unreadMessages)}>{unreadMessages}</span>}
              </button>
            )
          })}
        </div>

        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}>
          {renderView()}
        </div>
      </div>
    </PortalContext.Provider>
  )
}
