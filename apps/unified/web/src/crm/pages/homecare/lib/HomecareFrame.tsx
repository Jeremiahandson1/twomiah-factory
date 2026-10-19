// The frame every home-care screen renders in: the .hc wrapper its stylesheet is scoped to (./homecare.css, light and
// dark), the company's second colour, and the agency's clock. As a layout route around the agency's screens
// (crm/verticals/homecare.tsx) and around its public pages (the portals, paying an invoice, onboarding, careers).
//
// The clock: every home-care screen prints an instant (a clock-in, a message, a signature) on the agency's clock, not
// the browser's (templates/crm-homecare contexts/AuthContext.tsx adoptClock, Run 5). The office and caregivers learn it
// from GET /api/company (effectiveTimezone: server/crm/homecare/office/companyFields.ts); the portals from their own
// replies (./agencyClock.ts setAgencyTimezone). Children render once it has answered, so no time prints on the
// browser's zone first.
import { useEffect, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { useBrandPalette } from '../../../../shared'
import { api } from './http'
import { setAgencyTimezone } from './agencyClock'
import './homecare.css'

interface FrameProps {
  /** Learn the zone from /api/company (signed-in staff). The public pages pass false: their portals name it themselves. */
  staff?: boolean
  /** The company's second colour, when known (company.secondaryColor). */
  secondaryColor?: string | null
  children?: ReactNode
}

/** A colour the server wrote into the page (server/http/adminScreens.ts), or undefined. */
const metaColour = (name: string): string | undefined =>
  (typeof document !== 'undefined' && document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')) || undefined

export function HomecareFrame({ staff = true, secondaryColor, children }: FrameProps) {
  const [ready, setReady] = useState(!staff)
  const [second, setSecond] = useState<string | null>(secondaryColor ?? (staff ? null : metaColour('brand-secondary') ?? null))
  // A public page has no shell to colour it from the company: the agency's colour comes with the page. Staff pages
  // leave it to the shell (undefined changes nothing).
  useBrandPalette(staff ? undefined : metaColour('brand-primary'))

  useEffect(() => {
    if (!staff) return
    let live = true
    api.get('/api/company')
      .then((co: { effectiveTimezone?: string; secondaryColor?: string | null }) => {
        setAgencyTimezone(co?.effectiveTimezone)
        if (live && co?.secondaryColor) setSecond(co.secondaryColor)
      })
      // No zone (a refusal, a cold server): the browser's is used, as the template did.
      .catch(() => {})
      .finally(() => { if (live) setReady(true) })
    return () => { live = false }
  }, [staff])

  const style = second && /^#[0-9a-f]{3,8}$/i.test(second) ? ({ '--hc-secondary': second } as React.CSSProperties) : undefined
  return (
    <div className="hc min-h-full" style={style}>
      {ready ? (children ?? <Outlet />) : <div className="loading"><div className="spinner" /></div>}
    </div>
  )
}

export default HomecareFrame
