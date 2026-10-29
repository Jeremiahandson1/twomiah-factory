// The Web presence plan's FIRST site: the AI-written (or template) site the signup already makes, laid on ONE page.
// The signup's composer (services/sectionComposer.ts composeSite, or instantComposer.ts composeInstant when the model is slow)
// returns several pages; this takes the sections of those pages the trade's editor offers (sections.ts — the one table), puts
// them on one page in a sensible order, turns every page link into an in-page anchor, and writes the model the site's editor
// edits. It invents nothing: a section the composer did not write is not added (the owner adds it in the editor).
import type { ComposerInput, Section } from '../services/sectionComposer.ts'
import { verticalFor, type Vertical } from '../config/industryRouting.ts'
import { offeredFor, onlyAllowed, type Capability } from './sections.ts'
import { SHAPES } from './site/shapes.mjs'
import { cleanShape } from './site/clean.mjs'

export type WebPresenceSite = { pages: Record<string, Section[]> }

/** The page order: the top, what they do, the proof, the practical bits, then contact. Anything else follows in its table order. */
const ORDER = ['banner', 'hero', 'spot', 'services', 'menu', 'pricing', 'about', 'steps', 'before_after', 'gallery', 'products', 'team', 'events', 'deals', 'testimonials', 'partners', 'service_area', 'map', 'hours', 'hiring', 'social', 'contact']

/** A page link of the multi-page site, as the one page's anchor. A path with no section on this page is dropped (''), never left dead. */
export function onePageHref(href: unknown): string {
  const h = String(href ?? '').trim()
  if (!h) return ''
  if (/^(https:\/\/|tel:|mailto:|#)/i.test(h)) return h
  const key = h.replace(/^\/+|\/+$/g, '').split(/[/?#]/)[0].toLowerCase()
  const known: Record<string, string> = { contact: '#contact', 'contact-us': '#contact', quote: '#contact', estimate: '#contact', about: '#about', 'about-us': '#about', services: '#services', gallery: '#gallery', projects: '#gallery', reviews: '#reviews', testimonials: '#reviews', menu: '#menu', events: '#events', hours: '#hours', team: '#team', areas: '#area', 'service-areas': '#area' }
  return known[key] ?? ''
}

/** Every link in a section's data made one-page safe. Links to pages that do not exist are dropped. */
function singlePage(value: any): any {
  if (Array.isArray(value)) return value.map(singlePage)
  if (value && typeof value === 'object') {
    const out: any = {}
    for (const [k, v] of Object.entries(value)) out[k] = /^(href|url|yesHref)$/.test(k) && typeof v === 'string' && !/^https:\/\/.+\/.+\.(jpe?g|png|webp)/i.test(v) && !k.startsWith('image') ? onePageHref(v) || (k === 'url' ? v : '') : singlePage(v)
    return out
  }
  return value
}

/** The capability a composed section belongs to for this trade: same type, and the same variant where the type has two (spot). */
function capabilityOf(caps: readonly Capability[], s: { type: string; variant: string }): Capability | null {
  const same = caps.filter((c) => c.type === s.type)
  if (same.length <= 1) return same[0] ?? null
  return same.find((c) => c.variant === s.variant) ?? null
}

export type ComposedOnePage = {
  vertical: Vertical
  model: {
    v: 1
    business: Record<string, any>
    look: { design: string; palette: Record<string, string>; style: Record<string, string> }
    forms: { lead: { on: boolean; inbox: string; extraFields: Array<{ label: string }> }; hiring: { on: boolean; inbox: string } }
    sections: Array<{ id: string; type: string; variant: string; hidden: boolean; data: Record<string, any> }>
  }
  /** What the AI wrote that this trade's editor does not offer — dropped, and said so. */
  droppedTypes: string[]
}

export function composeOnePage(input: ComposerInput, site: WebPresenceSite, opts: { design?: string; palette?: Record<string, string> } = {}): ComposedOnePage {
  const vertical = verticalFor(input.businessType)
  const caps = offeredFor(vertical)
  // Home first, then the pages whose sections belong on a one-pager; service pages and the blog are never read.
  const slugs = ['home', 'about', 'gallery', 'contact', 'reviews', 'menu', 'events', 'projects'].filter((s) => site.pages[s])
  const pool: Section[] = slugs.flatMap((s) => site.pages[s] || [])
  const allowed = onlyAllowed(vertical, pool)
  const droppedTypes = [...new Set(pool.filter((s) => !allowed.includes(s)).map((s) => s.type))]

  const picked = new Map<string, { cap: Capability; s: Section }>()
  for (const s of allowed) {
    if (s.variant === 'split-form') continue   // the lead form is the contact section's
    const cap = capabilityOf(caps, s)
    // "Order ahead" is a link the owner gives: a banner with no https address is just words, so it is left for the editor.
    if (cap?.id === 'orderLink' && !/^https:\/\//i.test(String(s.data?.primaryCta?.href ?? ''))) continue
    if (cap && !picked.has(cap.id)) picked.set(cap.id, { cap, s })
  }
  // A page always has its contact section (the lead form is its, and the details); the AI may have left it on the contact page only.
  if (!picked.has('contact')) {
    const contact = caps.find((c) => c.id === 'contact')!
    picked.set('contact', { cap: contact, s: { type: 'contact', variant: contact.variant, data: { heading: 'Get in touch' } } })
  }
  const rank = (c: Capability) => { const i = ORDER.indexOf(c.type); return i < 0 ? ORDER.length : i }
  const ordered = [...picked.values()].sort((a, b) => rank(a.cap) - rank(b.cap) || caps.indexOf(a.cap) - caps.indexOf(b.cap))
  const sections = ordered.map(({ cap, s }) => ({
    id: cap.id, type: cap.type, variant: s.variant || cap.variant, hidden: false,
    data: cleanShape((SHAPES as any)[cap.type], singlePage(s.data)) as Record<string, any>,
  }))
  const email = String(input.email || '').trim()
  return {
    vertical,
    model: {
      v: 1,
      business: { name: input.businessName, phone: input.phone || '', email, city: input.city || '', state: input.state || '', address: '', zip: '', tagline: '', hours: {}, serviceAreas: [...(input.nearbyCities || [])].slice(0, 20), logo: '' },
      look: { design: opts.design || '', palette: opts.palette || {}, style: {} },
      // The lead form starts ON only when it has somewhere to go; the job form is the owner's to switch on.
      forms: { lead: { on: !!email, inbox: email, extraFields: [] }, hiring: { on: false, inbox: email } },
      sections,
    },
    droppedTypes,
  }
}
