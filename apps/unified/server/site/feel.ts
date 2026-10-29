// The site's type and feel, as the owner sets them (Website settings › Type and feel): a font pairing, how round the
// corners are, whether buttons are filled or outlined, and how much room the page leaves. Each is a choice from a short
// list, never a free value, so nothing picked here can make the site hard to read or break its layout; "the design's
// own" (absent) is always one of the choices. Stored on the website (website.style), apart from the colours.
//
// Like the colours (palette.ts), the choices are said in each design's own words: a whole look names its type through
// --f-display / --f-body, the base stylesheet hardcodes 'Fraunces' and 'Inter', so the stylesheet is rewritten for both.
import type { SiteDesignSpec } from '../core/vertical.ts'

export interface FontPair {
  id: string
  label: string
  /** The two families, and the sentence the picker prints under the name. */
  display: string
  body: string
  blurb: string
  /** The Google Fonts stylesheet that brings both (the site's page loads it in place of the design's own type). */
  url: string
  /** The generic fallbacks, after the family. */
  displayFallback: string
  bodyFallback: string
}

const G = (families: string) => 'https://fonts.googleapis.com/css2?' + families + '&display=swap'

export const FONT_PAIRS: FontPair[] = [
  { id: 'classic', label: 'Classic serif', display: 'Playfair Display', body: 'Source Sans 3', blurb: 'A traditional serif headline over a plain, friendly text face.', displayFallback: "Georgia, 'Times New Roman', serif", bodyFallback: 'system-ui, sans-serif', url: G('family=Playfair+Display:wght@400;600;700;800&family=Source+Sans+3:wght@400;500;600;700') },
  { id: 'modern', label: 'Clean modern', display: 'DM Sans', body: 'DM Sans', blurb: 'One tidy sans-serif throughout. Reads as current and simple.', displayFallback: 'system-ui, sans-serif', bodyFallback: 'system-ui, sans-serif', url: G('family=DM+Sans:wght@400;500;600;700;800') },
  { id: 'friendly', label: 'Friendly', display: 'Poppins', body: 'Nunito', blurb: 'Round, warm and approachable. Good for care, salons and shops.', displayFallback: 'system-ui, sans-serif', bodyFallback: 'system-ui, sans-serif', url: G('family=Poppins:wght@500;600;700&family=Nunito:wght@400;500;600;700') },
  { id: 'strong', label: 'Strong and bold', display: 'Barlow Condensed', body: 'Barlow', blurb: 'Tall, tough headlines. Good for the trades.', displayFallback: "'Arial Narrow', Impact, sans-serif", bodyFallback: 'system-ui, sans-serif', url: G('family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600;700') },
  { id: 'editorial', label: 'Editorial', display: 'Fraunces', body: 'Inter', blurb: 'A soft, characterful serif over a neutral sans, like a magazine.', displayFallback: 'Georgia, serif', bodyFallback: 'system-ui, sans-serif', url: G('family=Fraunces:wght@400;600;700;900&family=Inter:wght@400;500;600;700;800') },
  { id: 'elegant', label: 'Elegant', display: 'Cormorant Garamond', body: 'Montserrat', blurb: 'Fine, high-contrast headlines for a premium feel.', displayFallback: "Georgia, 'Times New Roman', serif", bodyFallback: 'system-ui, sans-serif', url: G('family=Cormorant+Garamond:wght@500;600;700&family=Montserrat:wght@400;500;600;700') },
  { id: 'refined', label: 'Refined', display: 'Instrument Serif', body: 'Hanken Grotesk', blurb: 'A quiet serif with a modern grotesque. Calm and confident.', displayFallback: "Georgia, 'Times New Roman', serif", bodyFallback: 'system-ui, sans-serif', url: G('family=Instrument+Serif:ital@0;1&family=Hanken+Grotesk:wght@400;500;600;700') },
  { id: 'technical', label: 'Technical', display: 'Space Grotesk', body: 'IBM Plex Sans', blurb: 'Precise and engineered. Good for services and software.', displayFallback: 'system-ui, sans-serif', bodyFallback: 'system-ui, sans-serif', url: G('family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600') },
]

export const CORNERS = ['square', 'soft', 'round'] as const
export const BUTTONS = ['outline'] as const
export const SPACINGS = ['compact', 'airy'] as const

export interface SiteStyle {
  fonts?: string
  corners?: (typeof CORNERS)[number]
  /** Absent: filled, as the design has them. */
  buttons?: (typeof BUTTONS)[number]
  /** Absent: the design's own. */
  spacing?: (typeof SPACINGS)[number]
}

/** A stored style cleaned: known keys, each a value from its list; null when nothing is left. */
export function cleanStyle(v: unknown): SiteStyle | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const s = v as Record<string, unknown>
  const out: SiteStyle = {}
  if (typeof s.fonts === 'string' && FONT_PAIRS.some((f) => f.id === s.fonts)) out.fonts = s.fonts
  if ((CORNERS as readonly unknown[]).includes(s.corners)) out.corners = s.corners as SiteStyle['corners']
  if ((BUTTONS as readonly unknown[]).includes(s.buttons)) out.buttons = s.buttons as SiteStyle['buttons']
  if ((SPACINGS as readonly unknown[]).includes(s.spacing)) out.spacing = s.spacing as SiteStyle['spacing']
  return Object.keys(out).length ? out : null
}

export const fontPairOf = (style: SiteStyle | null | undefined): FontPair | null => FONT_PAIRS.find((f) => f.id === style?.fonts) ?? null

/**
 * The font stylesheet the page loads: the owner's pair, else the design's own (undefined). The bar keeps its own type: its
 * faces are part of its book, and it brings them itself.
 */
export function fontsUrl(style: SiteStyle | null | undefined, spec: SiteDesignSpec): string | undefined {
  if (spec.tokens === 'bar') return spec.fonts
  return fontPairOf(style)?.url ?? spec.fonts
}

const RADII = {
  square: { button: '0', card: '0', field: '0', pic: '0' },
  soft: { button: '8px', card: '12px', field: '8px', pic: '10px' },
  round: { button: '999px', card: '24px', field: '14px', pic: '20px' },
} as const

// What counts as a button, a card, a field and a picture across the site's sections. A class a design never draws is harmless.
const BUTTON_SEL = '.btn, .header-cta, .mobile-nav__cta, .book-submit, .contact-form button[type="submit"], .cta__btn'
const CARD_SEL = '.service-card, .testimonial-card, .team-card, .pr-card, .package-card, .deals-card, .cov-card, .cg-card, .strain-card, .faq-item, .contact-section__promise, .why-choose__item, .value-card, .product-card, .shop-card, .gallery-cards__card, .svc-tile, .svc-featured__lead, .quote-wall__card, .hero-splitform__form'
const FIELD_SEL = 'input:not([type="checkbox"]):not([type="radio"]), select, textarea, .cf-input, .cf-choice, .book-date, .book-slot'
const PIC_SEL = '.gallery-grid img, .gallery-item, .story__photo img, .team-card img, .service-card img, .hero__image img, .hero--split img, .project-card img, .gallery-masonry__item img, .gallery-cards__card img, .gallery-pairs__imgs img, .hero-collage__pic'

const SPACE = { compact: 'clamp(40px, 5vw, 72px)', airy: 'clamp(88px, 11vw, 160px)' } as const

/**
 * The rules after the design's stylesheet (and after the colours) that carry the owner's type and feel into that design.
 * Empty when the owner chose nothing. `!important` on the shapes: a design styles a card or a button at a higher
 * specificity than a bare class, and the owner's choice is meant to win.
 */
export function styleCss(style: SiteStyle | null | undefined, spec: SiteDesignSpec): string {
  if (!style) return ''
  const kind = spec.tokens ?? 'base'
  const out: string[] = []
  const pair = kind === 'bar' ? null : fontPairOf(style)
  if (pair) {
    const d = `'${pair.display}', ${pair.displayFallback}`
    const b = `'${pair.body}', ${pair.bodyFallback}`
    // A whole look names its type in these; the base hardcodes it (siteStylesheet rewrites 'Fraunces' and 'Inter').
    out.push(`:root { --f-display: ${d}; --f-body: ${b}; --font-display: ${d}; }`, `body { font-family: ${b}; }`)
  }
  if (style.spacing && kind !== 'bar') out.push(`:root { --space: ${SPACE[style.spacing]}; }`)
  if (style.corners && kind !== 'bar') {
    const r = RADII[style.corners]
    out.push(
      `${BUTTON_SEL} { border-radius: ${r.button} !important; }`,
      `${CARD_SEL} { border-radius: ${r.card} !important; }`,
      `${FIELD_SEL} { border-radius: ${r.field} !important; }`,
      `${PIC_SEL} { border-radius: ${r.pic} !important; }`,
    )
  }
  if (style.buttons === 'outline' && kind !== 'bar') {
    // A hollow button: the owner's colour as its edge and its text, filling in on hover. On a dark band or a photograph the
    // edge and the text are white. (--brand-ink / --brand-text are the colour as text, kept readable by the design.)
    out.push(
      '.btn--primary, .header-cta, .book-submit:not(.book-submit--danger):not(.book-submit--secondary) { background: transparent !important; color: var(--brand-ink, var(--brand)) !important; border: 2px solid currentColor !important; box-shadow: none !important; }',
      '.btn--primary:hover, .header-cta:hover, .book-submit:not(.book-submit--danger):not(.book-submit--secondary):hover { background: var(--brand-ink, var(--brand)) !important; color: var(--on-brand, #ffffff) !important; }',
      '.cta--banner .btn--primary, .hero--full-bleed .btn--primary, .site-footer .btn--primary { color: #ffffff !important; }',
      ...(spec.headerDark ? ['.site-header .header-cta { color: #ffffff !important; }', '.site-header .header-cta:hover { background: #ffffff !important; color: #111111 !important; }'] : []),
      '.cta--banner .btn--primary:hover, .hero--full-bleed .btn--primary:hover, .site-footer .btn--primary:hover { background: #ffffff !important; color: #111111 !important; }',
    )
  }
  return out.length ? '\n/* the owner\'s type and feel (site/feel.ts) */\n' + out.join('\n') + '\n' : ''
}

/** The base stylesheet names its two families in the text; this puts the owner's in their place. */
export function withFonts(css: string, style: SiteStyle | null | undefined, spec: SiteDesignSpec): string {
  const pair = spec.tokens === 'bar' ? null : fontPairOf(style)
  if (!pair) return css
  return css.replaceAll("'Fraunces'", `'${pair.display}'`).replaceAll("'Inter'", `'${pair.body}'`)
}
