// The compatibility table: for every section type that offers more than one layout, which layouts it offers, what each
// draws, and when the section's content (and the business) suits it. ONE place: the editor's "Change layout", the
// composers' picks (apps/api) and the tests all read it. Views are site/views/sections/<type>/<id>.ejs.
//
// A layout is offered only when it can draw what the section holds:
//   needs(data)  names the reason it cannot, or null. A before/after layout needs every photo to have its pair; a gallery's
//                project cards need every photo titled; a collage needs the hero photo and two more.
//   shows        the data keys it draws. Anything the section has under another key is NOT drawn there: the layout is then
//                still offered, but says so ("won't show the photo") — nothing is dropped silently, and the data is never
//                touched: switching back brings it back.
//   trades       the verticals (VerticalSettings.id) it is meant for; absent = every trade.
//   form         it carries the enquiry form, so it is offered only where the site takes enquiries.
// The bar's own design keeps its layouts: it is offered none of these (offeredLayouts returns just the current one).
import type { SiteDesignSpec } from '../core/vertical.ts'

export type Data = Record<string, any>
export interface LayoutDef {
  id: string
  label: string
  blurb: string
  shows: string[]
  needs?: (d: Data) => string | null
  trades?: string[]
  form?: boolean
  /** Extra things this layout leaves out that a key list cannot say (a gallery's filter bar). */
  loses?: (d: Data) => string[]
}
export interface Offered { id: string; label: string; blurb: string; current: boolean; hides: string[] }

const filled = (v: unknown) => Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.keys(v as object).length > 0 : !!v
const photosOf = (d: Data): any[] => (Array.isArray(d.photos) ? d.photos.filter((p: any) => p && p.url) : [])
const itemsOf = (d: Data): any[] => (Array.isArray(d.items) ? d.items : [])
const categories = (d: Data) => new Set(photosOf(d).map((p) => String(p.category || '').trim()).filter(Boolean)).size

/** Words for what a layout leaves out, by data key. */
export const KEY_WORDS: Record<string, string> = {
  image: 'the photo', imageAlt: '', images: 'the extra photos', stats: 'the numbers', secondaryCta: 'the second button', subtitle: 'the subtitle', eyebrow: 'the small label',
  portrait: 'the portrait', paragraphs: 'the story text', milestones: 'the timeline', signature: 'the signature', bullets: 'the bullet points', phone: 'the phone number',
  intro: 'the intro line', heading: 'the heading', flip: '', items: 'the list of points', photos: 'the photos',
}
const COMMON = ['heading', 'title', 'id', 'intro', 'imageAlt', 'flip', 'primaryCta']

export const LAYOUTS: Record<string, LayoutDef[]> = {
  hero: [
    { id: 'centered-stats', label: 'Centred', blurb: 'Headline in the middle, numbers underneath.', shows: ['eyebrow', 'title', 'subtitle', 'primaryCta', 'stats'] },
    { id: 'full-bleed', label: 'Full photo', blurb: 'The photo fills the top, the headline over it.', shows: ['eyebrow', 'title', 'subtitle', 'primaryCta', 'secondaryCta', 'image'], needs: (d) => (d.image ? null : 'needs a photo') },
    { id: 'split', label: 'Text and photo', blurb: 'Words on one side, the photo on the other.', shows: ['eyebrow', 'title', 'subtitle', 'primaryCta', 'secondaryCta', 'image', 'stats'] },
    { id: 'collage', label: 'Photo collage', blurb: 'The headline beside a mosaic of your photos.', shows: ['eyebrow', 'title', 'subtitle', 'primaryCta', 'secondaryCta', 'image', 'images'],
      needs: (d) => (d.image && Array.isArray(d.images) && d.images.filter(Boolean).length >= 2 ? null : 'needs the hero photo and two more') },
    { id: 'text-led', label: 'Words only', blurb: 'A large headline, no photo. Quiet and confident.', shows: ['eyebrow', 'title', 'subtitle', 'primaryCta', 'secondaryCta', 'stats'] },
    { id: 'split-form', label: 'Half and half with enquiry form', blurb: 'The headline beside a short enquiry form.', shows: ['eyebrow', 'title', 'subtitle', 'primaryCta'], form: true },
  ],
  services: [
    { id: 'cards-grid', label: 'Cards', blurb: 'A grid of cards, each with its photo.', shows: ['items'], needs: (d) => (itemsOf(d).length ? null : 'needs at least one service') },
    { id: 'alternating', label: 'Alternating rows', blurb: 'Each service as a row, photo left then right.', shows: ['items'], needs: (d) => (itemsOf(d).length ? null : 'needs at least one service') },
    { id: 'list', label: 'Numbered list', blurb: 'A quiet numbered list, no photos.', shows: ['items'], needs: (d) => (itemsOf(d).length ? null : 'needs at least one service'),
      loses: (d) => (itemsOf(d).some((i) => i && i.image) ? ['the service photos'] : []) },
    { id: 'tiles', label: 'Icon tiles', blurb: 'Compact tiles with a round mark. Good for many services.', shows: ['items'], needs: (d) => (itemsOf(d).length >= 3 ? null : 'needs three or more services') },
    { id: 'featured', label: 'One featured service', blurb: 'The first service large, the rest beside it.', shows: ['items'], needs: (d) => (itemsOf(d).length >= 2 ? null : 'needs two or more services') },
  ],
  testimonials: [
    { id: 'quotes', label: 'Quotes', blurb: 'Up to three quotes in a row.', shows: ['items'], needs: (d) => (itemsOf(d).some((q) => q && q.quote) ? null : 'needs a review') },
    { id: 'carousel', label: 'Carousel', blurb: 'One quote at a time, with arrows.', shows: ['items'], needs: (d) => (itemsOf(d).length >= 2 ? null : 'needs two or more reviews') },
    { id: 'wall', label: 'Wall of reviews', blurb: 'Many short reviews in columns.', shows: ['items'], needs: (d) => (itemsOf(d).filter((q) => q && q.quote).length >= 3 ? null : 'needs three or more reviews') },
    { id: 'featured', label: 'One featured review', blurb: 'The first review large, the rest as small lines.', shows: ['items'], needs: (d) => (itemsOf(d).some((q) => q && q.quote) ? null : 'needs a review') },
  ],
  about: [
    { id: 'story', label: 'Story', blurb: 'Your story beside a portrait.', shows: ['eyebrow', 'title', 'portrait', 'paragraphs', 'signature', 'stats'], needs: (d) => (Array.isArray(d.paragraphs) && d.paragraphs.length ? null : 'needs the story text'),
      loses: (d) => (filled(d.milestones) ? ['the timeline'] : []) },
    { id: 'feature', label: 'Big portrait', blurb: 'A wide portrait over a centred story.', shows: ['eyebrow', 'title', 'portrait', 'paragraphs', 'signature', 'stats'], needs: (d) => (d.portrait && Array.isArray(d.paragraphs) && d.paragraphs.length ? null : 'needs a portrait and the story text'),
      loses: (d) => (filled(d.milestones) ? ['the timeline'] : []) },
    { id: 'timeline', label: 'Timeline', blurb: 'Your story with your milestones down a line.', shows: ['eyebrow', 'title', 'paragraphs', 'signature', 'milestones'], needs: (d) => (Array.isArray(d.milestones) && d.milestones.some((m: any) => m && (m.year || m.text)) ? null : 'needs milestones') },
    { id: 'values', label: 'Values', blurb: 'A few short points about what you stand for.', shows: ['heading', 'intro', 'items'], needs: (d) => (itemsOf(d).length ? null : 'needs the list of values') },
  ],
  gallery: [
    { id: 'grid', label: 'Grid', blurb: 'An even grid, with a filter when photos are sorted.', shows: ['photos'], needs: (d) => (photosOf(d).length ? null : 'needs a photo') },
    { id: 'masonry', label: 'Masonry', blurb: 'Photos keep their own shapes, in columns.', shows: ['photos'], needs: (d) => (photosOf(d).length >= 3 ? null : 'needs three or more photos'),
      loses: (d) => (categories(d) >= 2 ? ['the filter by category'] : []) },
    { id: 'projects', label: 'Project cards', blurb: 'Each photo as a card with its title.', shows: ['photos'], needs: (d) => (photosOf(d).length && photosOf(d).every((p) => p.title || p.caption) ? null : 'needs a title on every photo'),
      loses: (d) => (categories(d) >= 2 ? ['the filter by category'] : []) },
    { id: 'pairs', label: 'Before and after', blurb: 'Each project as a before photo beside its after.', shows: ['photos'], needs: (d) => (photosOf(d).length && photosOf(d).every((p) => p.after) ? null : 'needs a before and an after photo on every project'),
      loses: (d) => (categories(d) >= 2 ? ['the filter by category'] : []) },
  ],
  cta: [
    { id: 'banner', label: 'Banner', blurb: 'A dark band with one button.', shows: ['heading', 'subtitle', 'primaryCta', 'id'], loses: (d) => [...(filled(d.bullets) ? ['the bullet points'] : []), ...(d.image ? ['the photo'] : []), ...(d.phone ? ['the phone number'] : [])] },
    { id: 'split', label: 'Split', blurb: 'Words and a photo, with the phone number.', shows: ['heading', 'subtitle', 'primaryCta', 'id', 'bullets', 'image', 'phone'] },
  ],
}

/** The layouts a section may be switched to, with what each would leave out. The current one is always listed. */
export function offeredLayouts(type: string, variant: string, data: Data, ctx: { trade?: string | null; takesEnquiries?: boolean; spec?: Pick<SiteDesignSpec, 'tokens'> | null } = {}): Offered[] {
  const defs = LAYOUTS[type]
  if (!defs) return []
  const d = data && typeof data === 'object' ? data : {}
  // The bar's own design keeps its layouts: nothing is offered but what is already there.
  const onlyCurrent = ctx.spec?.tokens === 'bar'
  const out: Offered[] = []
  for (const def of defs) {
    const current = def.id === variant
    if (!current) {
      if (onlyCurrent) continue
      if (def.trades && ctx.trade && !def.trades.includes(ctx.trade)) continue
      if (def.form && ctx.takesEnquiries === false) continue
      if (def.needs && def.needs(d)) continue
    }
    const known = new Set([...def.shows, ...COMMON])
    const hides = [
      ...Object.keys(d).filter((k) => !known.has(k) && filled(d[k]) && KEY_WORDS[k]).map((k) => KEY_WORDS[k]),
      ...(def.loses ? def.loses(d) : []),
    ].filter((w, i, a) => w && a.indexOf(w) === i)
    out.push({ id: def.id, label: def.label, blurb: def.blurb, current, hides: current ? [] : hides })
  }
  return out
}

/** Every layout id a type has (the tests and the composers' lists). */
export const layoutIds = (type: string): string[] => (LAYOUTS[type] || []).map((l) => l.id)
/** Why a layout cannot draw this content (null when it can): the composers use it to pick only what fits. */
export function layoutFit(type: string, id: string, data: Data): string | null {
  const def = (LAYOUTS[type] || []).find((l) => l.id === id)
  return def ? (def.needs ? def.needs(data || {}) : null) : 'no such layout'
}
