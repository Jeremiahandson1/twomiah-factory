// A page's meta description when the owner wrote none: built from the page's OWN visible words — never invented copy.
// Order: the first hero's subtitle, a story's first paragraph, a section's intro line, the first service's description,
// a call to action's line, a review. The first one with real words wins; it is cleaned of markup and clipped to about
// 155 characters at a word boundary (search results cut near there). A page with no words of its own says nothing here
// (the caller falls back to the site's tagline, the owner's own words too).
const MAX = 155

const plain = (v: unknown): string => (typeof v === 'string' ? v : '')
  .replace(/<[^>]*>/g, ' ').replace(/[*_`#>]+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

/** Text clipped to about `max` characters at a word boundary, with an ellipsis only when something was cut. */
export function clipWords(text: string, max = MAX): string {
  const t = plain(text)
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/, '') + '…'
}

const firstOf = (sections: any[], type: string, pick: (d: any) => unknown): string => {
  for (const s of sections) {
    if (!s || s.type !== type) continue
    const v = plain(pick(s.data || {}))
    if (v.length >= 20) return v
  }
  return ''
}

export function pageDescription(sections: any[], tagline?: string | null): string {
  const list = Array.isArray(sections) ? sections : []
  const text =
    firstOf(list, 'hero', (d) => d.subtitle) ||
    firstOf(list, 'about', (d) => (Array.isArray(d.paragraphs) ? d.paragraphs[0] : '')) ||
    firstOf(list, 'services', (d) => d.intro) ||
    firstOf(list, 'services', (d) => (Array.isArray(d.items) ? d.items.map((i: any) => i && i.description).find((x: unknown) => plain(x).length >= 20) : '')) ||
    firstOf(list, 'contact', (d) => d.intro) ||
    firstOf(list, 'cta', (d) => d.subtitle) ||
    firstOf(list, 'faq', (d) => (Array.isArray(d.items) ? d.items[0]?.answer : '')) ||
    firstOf(list, 'testimonials', (d) => (Array.isArray(d.items) ? d.items[0]?.quote : '')) ||
    plain(tagline)
  return clipWords(text)
}
