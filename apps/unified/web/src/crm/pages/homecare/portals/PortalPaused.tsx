// The family and client portals while the agency's account is locked (cancelled in the Factory). Moved from
// templates/crm-homecare/frontend/src/components/portal/PortalPaused.tsx.
//
// The server refuses every portal data call 402 { error, code: 'ACCOUNT_LOCKED' } (server/crm/homecare/core/portalLock.ts;
// the template's reply also carried the lock kind as `lock`, which nothing here read). The portal's client
// (./portalHttp.ts) tells its portal, which shows this instead of a page of failed loads. A relative does not hold the
// subscription, so there is no Restart here — only who to call, and a way to sign out.
import { agencyNameFromPage } from './portalHttp'

export default function PortalPaused({ onLogout }: { onLogout: () => void }) {
  const agency = agencyNameFromPage() || 'the agency'
  return (
    <div className="login-container">
      {/* Ink and ground set together, so it reads the same whatever the page around it. */}
      <div className="login-card" role="status" style={{ background: '#FFFFFF', color: '#1F2937', textAlign: 'center' }}>
        <div style={{ fontSize: '2.25rem', marginBottom: '0.5rem' }} aria-hidden="true">⏸️</div>
        {/* The card is white in both themes, so its heading is too dark an ink to inherit the frame's (brand-200 in dark). */}
        <h1 style={{ fontSize: '1.5rem', color: '#1F2937' }}>{"This agency's account is paused"}</h1>
        <p style={{ color: '#374151' }}>
          {"The portal is unavailable for now. Nothing has been deleted — it opens again as soon as the agency's account is back on."}
        </p>
        <p style={{ color: '#374151' }}>
          For anything about care or visits in the meantime, please contact {agency} directly.
        </p>
        <button type="button" className="hc-btn" onClick={onLogout} style={{ marginTop: '0.5rem', background: '#F3F4F6', color: '#1F2937' }}>
          Sign out
        </button>
      </div>
    </div>
  )
}
