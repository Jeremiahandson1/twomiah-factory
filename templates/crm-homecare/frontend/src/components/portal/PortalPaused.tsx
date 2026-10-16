// The family and client portals while the agency's account is locked (cancelled in the Factory). (Run 4, blocker 3)
// The server refuses every portal data call 402 ACCOUNT_LOCKED (backend helpers/portalLock.ts); services/sessionFetch.ts
// raises PORTAL_PAUSED_EVENT for a portal request, and the portal app shows this instead of a page of failed loads.
// A relative does not hold the subscription, so there is no Restart here — only who to call, and a way to sign out.
import React, { useEffect, useState } from 'react';
import { PORTAL_PAUSED_EVENT } from '../../services/api';

/** True once any portal request has been refused because the agency is locked. */
export function usePortalPaused(): boolean {
  const [paused, setPaused] = useState(() => typeof window !== 'undefined' && (window as any).__portalPaused === true);
  useEffect(() => {
    const on = () => setPaused(true);
    window.addEventListener(PORTAL_PAUSED_EVENT, on);
    if ((window as any).__portalPaused === true) setPaused(true);
    return () => window.removeEventListener(PORTAL_PAUSED_EVENT, on);
  }, []);
  return paused;
}

const PortalPaused = ({ onLogout }: { onLogout: () => void }) => (
  <div className="login-container">
    {/* Ink and ground set together, so it reads the same whatever the page around it. */}
    <div className="login-card" role="status" style={{ background: '#FFFFFF', color: '#1F2937', textAlign: 'center' }}>
      <div style={{ fontSize: '2.25rem', marginBottom: '0.5rem' }} aria-hidden="true">⏸️</div>
      <h1 style={{ fontSize: '1.5rem' }}>{"This agency's account is paused"}</h1>
      <p style={{ color: '#374151' }}>
        {"The portal is unavailable for now. Nothing has been deleted — it opens again as soon as the agency's account is back on."}
      </p>
      <p style={{ color: '#374151' }}>
        For anything about care or visits in the meantime, please contact {"{{COMPANY_NAME}}"} directly.
      </p>
      <button type="button" className="btn btn-secondary" onClick={onLogout} style={{ marginTop: '0.5rem' }}>Sign out</button>
    </div>
  </div>
);

export default PortalPaused;
