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

/**
 * A figure box (a number input, or one typed as a decimal) has its value selected when it is entered, so what is typed
 * replaces it. The caregiver form's pay rate held "15.00" with the cursor after it, so typing 18 made "15.0018" (live
 * test 2026-10-22); every rate, amount and hours box in the agency's screens edits a figure that is already there the
 * same way. One rule for all of them, here in the frame they render in. A click's own mouseup would put the cursor back,
 * so that one mouseup is told not to.
 */
function selectFigure(e: React.FocusEvent<HTMLDivElement>) {
  const el = e.target as HTMLInputElement
  if (el?.tagName !== 'INPUT' || !(el.type === 'number' || el.inputMode === 'decimal' || el.inputMode === 'numeric') || el.value === '') return
  try { el.select() } catch { return }
  const keep = (m: MouseEvent) => m.preventDefault()
  el.addEventListener('mouseup', keep, { once: true })
  // A focus from the keyboard has no mouseup coming: the listener is dropped before the next click.
  setTimeout(() => el.removeEventListener('mouseup', keep), 500)
}

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
    <div className="hc min-h-full" style={style} onFocus={selectFigure}>
      {ready ? (children ?? <Outlet />) : <div className="loading"><div className="spinner" /></div>}
    </div>
  )
}

export default HomecareFrame
