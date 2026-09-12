// Portal context — shared implementation (packages/tenant-ui/src/portal), vendored as ../shared.
// This file hands the shared provider this template's portal config.
import React from 'react';
import { PortalProvider as SharedPortalProvider, usePortal } from '../shared';
import { PORTAL } from '../portalConfig';

export function PortalProvider({ children }: { children: React.ReactNode }) {
  return <SharedPortalProvider config={PORTAL}>{children}</SharedPortalProvider>;
}

export { usePortal };
