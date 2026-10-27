/**
 * The look a visitor chose for their site, before they signed up (the three looks on twomiah.com: Foundry, Heritage,
 * Studio). The unified app owns which designs exist and which of them a visitor may choose (SITE_DESIGN_SPECS: `choosable`),
 * so the Factory asks it rather than keeping a list of its own: a fourth look is one row there and works here.
 *
 * Nothing sent: no choice, and the business gets its vertical's own default look. Anything sent that is not a choosable
 * design is refused (ok: false), never quietly turned into the default.
 */
import { SITE_LOOKS, siteLookOf, type SiteDesign } from '../../../unified/server/core/vertical'

export { SITE_LOOKS }

export function requestedLook(v: unknown): { ok: true; design: SiteDesign | null } | { ok: false } {
  if (v === undefined || v === null || v === '') return { ok: true, design: null }
  const design = siteLookOf(v)
  return design ? { ok: true, design } : { ok: false }
}
