// Home care's public pages that are the portals group's: the client portal (/portal and below: its sign-in, the emailed
// link's exchange, invite setup at /portal/setup, the paused state), the family portal (/family and below, with its
// sign-in), paying a visit invoice (/pay/:invoiceId) and its receipt (/payment-success). Rendered by ../publicApp.tsx,
// which has already put them in the frame (staff={false}: each portal learns the agency's clock from its own replies).
// It reads the address itself (useLocation): there is one level of routes, App.tsx's PUBLIC_PATHS.
//
// Moved from templates/crm-homecare/frontend/src/App.tsx (its PortalApp, FamilyApp and the public routes' titles).
// The portals keep their own sign-ins in localStorage, as the template did: 'portal_token' (the client portal) and
// 'family_token' + 'family_user' (the family portal). See ./portalHttp.ts for how they are sent.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { usePageTitle } from '../lib/usePageTitle'
import { agencyNameFromPage, publicCall, store, tokenClaims } from './portalHttp'
import PortalLogin, { type PortalLoginClient } from './PortalLogin'
import PortalSetup from './PortalSetup'
import ClientPortal from './ClientPortal'
import FamilyPortalLogin from './FamilyPortalLogin'
import FamilyPortal, { type FamilyMember } from './FamilyPortal'
import PortalPaused from './PortalPaused'
import PaymentPage, { PaymentSuccess } from './PaymentPage'
import './portals.css'

const Spinner = () => <div className="loading"><div className="spinner" /></div>

// ── The client portal ─────────────────────────────────────────────────────────
function PortalApp() {
  const [client, setClient] = useState<{ firstName?: string | null; lastName?: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [token, setToken] = useState<string | null>(() => store.get('portal_token'))
  const [linkError, setLinkError] = useState('')
  const [paused, setPaused] = useState(false)
  // An emailed portal link arrives as /portal?token=<the client's link token>, which is not a JWT. It is redeemed once
  // for a session, then taken out of the address so it does not sit in browser history or get pasted into a share.
  const [redeeming] = useState(() => new URLSearchParams(window.location.search).has('token'))

  useEffect(() => {
    const linkToken = new URLSearchParams(window.location.search).get('token')
    if (!linkToken) return
    let cancelled = false
    ;(async () => {
      try {
        // POST /api/portal/exchange { token } → { token, client } (server/crm/homecare/portals/clientPortal.ts).
        const r = await publicCall<{ token?: string }>('POST', '/api/portal/exchange', { token: linkToken })
        if (cancelled) return
        if (r.ok && r.data.token) {
          store.set('portal_token', r.data.token)
          setToken(r.data.token)
        } else {
          setLinkError(r.error || 'This link is no longer valid. Please contact your care coordinator.')
        }
      } catch {
        if (!cancelled) setLinkError('We could not open your portal. Please check your connection and try again.')
      } finally {
        if (!cancelled) {
          window.history.replaceState({}, '', window.location.pathname)
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleLogout = useCallback(() => {
    store.remove('portal_token')
    setToken(null)
    setClient(null)
  }, [])

  const handlePaused = useCallback(() => setPaused(true), [])

  useEffect(() => {
    if (token) {
      const claims = tokenClaims(token)
      if (!claims || (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) || claims.role !== 'client') {
        handleLogout()
        return
      }
      setClient({ firstName: claims.firstName as string | undefined, lastName: claims.lastName as string | undefined })
    }
    // While a link is being redeemed the exchange owns `loading`, so the sign-in does not flash before the portal opens.
    if (!redeeming || token) setLoading(false)
  }, [token, handleLogout, redeeming])

  const handleLogin = (newToken: string, clientData: PortalLoginClient) => {
    store.set('portal_token', newToken)
    setToken(newToken)
    const claims = tokenClaims(newToken) || {}
    setClient({ ...claims, firstName: clientData.firstName, lastName: clientData.lastName })
  }

  if (loading) return <Spinner />

  if (!client || !token) {
    return (
      <>
        {linkError && (
          <div style={{
            maxWidth: '520px', margin: '24px auto -8px', padding: '0.85rem 1rem', borderRadius: '8px', textAlign: 'center',
            background: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)',
          }}>
            {linkError}
          </div>
        )}
        <PortalLogin onLogin={handleLogin} />
      </>
    )
  }

  if (paused) return <PortalPaused onLogout={handleLogout} />

  return <ClientPortal user={client} token={token} onLogout={handleLogout} onPaused={handlePaused} />
}

// ── The family portal ─────────────────────────────────────────────────────────
// A relative's own sign-in (family_members), separate from the client portal.
function FamilyApp() {
  const [familyUser, setFamilyUser] = useState<FamilyMember | null>(null)
  const [loading, setLoading] = useState(true)
  const [token, setToken] = useState<string | null>(() => store.get('family_token'))
  const [paused, setPaused] = useState(false)

  const handleLogout = useCallback(() => {
    store.remove('family_token')
    store.remove('family_user')
    setToken(null)
    setFamilyUser(null)
  }, [])

  const handlePaused = useCallback(() => setPaused(true), [])

  useEffect(() => {
    if (token) {
      const claims = tokenClaims(token)
      if (!claims || (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) || claims.role !== 'family') {
        handleLogout()
      } else {
        let stored: FamilyMember | null = null
        try { stored = JSON.parse(store.get('family_user') || 'null') as FamilyMember | null } catch { stored = null }
        setFamilyUser(stored || { id: String(claims.familyMemberId ?? '') })
      }
    }
    setLoading(false)
  }, [token, handleLogout])

  const handleLogin = (newToken: string, userData: FamilyMember) => {
    store.set('family_token', newToken)
    store.set('family_user', JSON.stringify(userData || {}))
    setToken(newToken)
    setFamilyUser(userData || ({} as FamilyMember))
  }

  if (loading) return <Spinner />
  if (!familyUser || !token) return <FamilyPortalLogin onLogin={handleLogin} />
  if (paused) return <PortalPaused onLogout={handleLogout} />

  return <FamilyPortal user={familyUser} token={token} onLogout={handleLogout} onPaused={handlePaused} />
}

/** The browser tab's title for a public page, which has no CRM around it. */
function Titled({ title, children }: { title: string; children: ReactNode }) {
  usePageTitle(title)
  return <>{children}</>
}

export default function PortalsPublic() {
  const { pathname } = useLocation()
  const agency = agencyNameFromPage()
  const name = (what: string) => (agency ? `${what} — ${agency}` : what)

  const pay = /^\/pay\/([^/]+)\/?$/.exec(pathname)
  if (pay) return <Titled title={name('Pay your invoice')}><PaymentPage invoiceId={decodeURIComponent(pay[1])} /></Titled>
  if (pathname === '/payment-success' || pathname === '/payment-success/') return <Titled title={name('Payment received')}><PaymentSuccess /></Titled>
  if (pathname === '/portal/setup' || pathname === '/portal/setup/') return <Titled title={name('Client portal')}><PortalSetup /></Titled>
  if (pathname === '/family' || pathname.startsWith('/family/')) return <Titled title={name('Family portal')}><FamilyApp /></Titled>
  // /portal and anything under it (the template's /portal/*).
  return <Titled title={name('Client portal')}><PortalApp /></Titled>
}
