// The View As picker and the client-portal preview, loaded when the header's View As button is pressed (./ViewAs.tsx).
//
//   · A member of staff: POST /api/auth/impersonate/:userId sets the View As cookie (server/crm/homecare/office/
//     signIn.ts) and the page loads afresh as them — their menu, their screens, read-only, with the strip that offers
//     Exit. Nothing here holds their session.
//   · A client's portal: POST /api/portal/admin/preview/:clientId answers a short-lived, read-only portal token
//     (portals/clientPortal.ts). The portal is a separate sign-in that always travels as a Bearer token (its own client,
//     portals/portalHttp.ts), so the preview opens the portal over this page with that token kept in memory only — never
//     stored — and Close drops it. The template did the same (App.tsx: ClientPortal on impersonationToken).
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { HomecareFrame } from '../lib/HomecareFrame'
import ImpersonationModal, { type ViewAsUser } from './ImpersonationModal'
import { reloadAsSession } from './ViewAs'

const ClientPortal = lazy(() => import('../portals/ClientPortal'))

interface Props { onClose: () => void }

export default function ViewAsPanel({ onClose }: Props) {
  const [preview, setPreview] = useState<{ token: string; user: ViewAsUser } | null>(null)
  const closePreview = useCallback(() => { setPreview(null); onClose() }, [onClose])

  // Escape closes whichever is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') (preview ? closePreview : onClose)() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [preview, closePreview, onClose])

  if (preview) {
    return (
      <div role="dialog" aria-modal="true" aria-label="Client portal preview" className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-slate-950">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-emerald-300 bg-emerald-100 px-4 py-2 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          <p className="min-w-0 flex-1">
            Previewing <strong>{preview.user.name}</strong>'s client portal — read-only: nothing can be sent, signed or paid.
          </p>
          <button
            type="button"
            onClick={closePreview}
            className="shrink-0 rounded-md bg-emerald-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 dark:bg-emerald-200 dark:text-emerald-950 dark:hover:bg-emerald-100"
          >
            Close preview
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <HomecareFrame staff={false}>
            <Suspense fallback={<div className="loading"><div className="spinner" /></div>}>
              <ClientPortal token={preview.token} user={preview.user} onLogout={closePreview} />
            </Suspense>
          </HomecareFrame>
        </div>
      </div>
    )
  }

  // The frame's stylesheet and tokens (lib/homecare.css), without its wait for the agency's clock: nothing here prints a time.
  return (
    <div className="hc">
      <ImpersonationModal
        onClose={onClose}
        onStaff={() => reloadAsSession()}
        onPortal={(token, user) => setPreview({ token, user })}
      />
    </div>
  )
}
