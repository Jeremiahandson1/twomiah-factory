// The first screen's photo, found early and sized for the screen (speed round, 2026-10-29: on Higgs, 547 and Perch the
// largest paint was a CSS background-image on the hero, discovered late, one size for every screen, from another site).
//
// A hero keeps its CSS background — each design crops, tints and overlays it through the section's own box (centre cover,
// the scrims, foundry's stripes, the field-service wash), and an <img> in its place would have to be re-fitted to every
// one of them — but the picture is now the site's own WebP copy at the width the screen needs (site/variants.ts), chosen
// by the same three media conditions in two places: the page's rules and, for the FIRST hero only, a
// <link rel="preload" as="image" media="…" fetchpriority="high"> in the head. So the browser starts the one file the first
// screen shows while it parses the head, and never fetches the other two sizes. Heroes further down keep their rules and
// are not preloaded; every other photo stays lazy.
import { srcsetOf, variantUrl } from './variants.ts'

export const BREAKS = [
  { media: '(max-width: 480px)', width: 960 },
  { media: '(min-width: 481px) and (max-width: 900px)', width: 1280 },
  { media: '(min-width: 901px)', width: 1920 },
] as const

export interface Preload { href: string; media?: string; srcset?: string; sizes?: string }

/** The copy of `src` for each screen size, or null when the photo has none (an SVG, another site's). */
export function heroCopies(src: unknown): Array<{ media: string; url: string }> | null {
  if (typeof src !== 'string') return null
  const out = BREAKS.map((b) => ({ media: b.media, url: variantUrl(src, b.width) }))
  return out.every((o) => o.url) ? (out as Array<{ media: string; url: string }>) : null
}

const cssUrl = (u: string) => `url("${u.replace(/["\\\n]/g, '')}")`

/** Sections with each hero's photo turned into per-screen rules (data.imageCss, data.imageKey); other sections untouched. */
export function withHeroImages(sections: any[]): { sections: any[]; preloads: Preload[] } {
  let preloads: Preload[] = []
  let first = true
  let n = 0
  const out = sections.map((s) => {
    // The bar's Tonight board shows its cover as a real <img> with a srcset (templates: board.ejs): the same two photos, now
    // as the site's sized WebP copies, so a phone is not sent the uploaded original.
    if (s && s.type === 'tonight' && s.data) {
      const set = srcsetOf(s.data.coverImage, [480, 960, 1280])
      if (!set) return s
      // Preload exactly the file the <img>'s srcset/sizes will pick (board.ejs sizes), or the browser fetches two.
      if (first) { first = false; preloads = [{ href: variantUrl(s.data.coverImage, 960) || '', srcset: set, sizes: '(max-width: 900px) 92vw, 480px' }] }
      return { ...s, data: { ...s.data, coverSrcset: set } }
    }
    if (!s || s.type !== 'hero' || !s.data) return s
    const copies = heroCopies(s.data.image)
    const wasFirst = first
    first = false
    if (!copies) return s
    const key = 'h' + n++
    // !important: the inline style this replaces beat every design rule, and so does this.
    const css = copies.map((c) => `@media ${c.media}{[data-bg="${key}"]{background-image:${cssUrl(c.url)} !important}}`).join('')
    if (wasFirst) preloads = copies.map((c) => ({ href: c.url, media: c.media }))
    return { ...s, data: { ...s.data, imageCss: css, imageKey: key } }
  })
  return { sections: out, preloads }
}
