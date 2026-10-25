// The website moved into the unified app renders what the premium site templates render (step 2b's "done when").
// Compares against templates/website-premium-*, which stay on this branch until cutover; this file goes with them.
//
//   1. The section library is the templates' own files: each one byte-identical to every template copy, except the
//      ones merged on purpose (before/after slider, contact form, base layout, and the instant-estimator section: the
//      site and the CRM are one app, so the widget loads from the site's own /estimator.js and needs no CRM origin;
//      the bar's fixes taken for every design: the split hero and split CTA drop the empty picture box, the story drops
//      its portrait column by class, and the story's and contact form's heading is the page's h1 only when the section
//      opens the page).
//   2. Each design's sample pages, through the templates' views and through the unified app: the same HTML.
//   3. The contact form says each vertical's words and posts `message`, as the vertical's template did.
//   4. Each design's stylesheet keeps every rule its template served, except the ones styling markup no longer
//      rendered (the old before/after cards, roofing's pre-July trust badges).
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ejs from 'ejs'
import { renderSections, VIEWS, absolutizeHrefs } from '../server/site/render.ts'
import { siteStylesheet } from '../server/site/routes.ts'
import { consentBoxHtml } from '../server/site/smsConsent.ts'
import type { SiteContext } from '../server/site/context.ts'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { accentOnLight, DEFAULT_ACCENT, ensureDark, inkOn } from '../server/core/brandColour.ts'
import type { SiteFacts } from '../server/site/facts.ts'

const TEMPLATES = path.resolve(import.meta.dir, '..', '..', '..', 'templates')
// The template families compared (website-premium-<family>), and the design each one's look is in the unified app.
const DESIGNS = ['bar', 'contractor', 'dispensary', 'fieldservice', 'homecare', 'landscaping', 'roofing', 'rv', 'showcase', 'vet'] as const
const designOf = (family: typeof DESIGNS[number]): SiteContext['design'] => (family === 'contractor' || family === 'rv' || family === 'vet' ? 'classic' : family)
const MERGED = new Set(['base.ejs', 'home.ejs', 'sections/before_after/slider.ejs', 'sections/contact/form-info.ejs', 'sections/tools/estimator.ejs',
  'sections/hero/split.ejs', 'sections/cta/split.ejs', 'sections/about/story.ejs',
  // docs/TRACKING_STANDARD.md: a saved lead shows the page's one #form-success (Google's conversion trigger).
  'sections/inventory/unit.ejs', 'sections/care/finder.ejs',
  // The "Text me" box on every form that asks for a phone (server/site/smsConsent.ts): carriers require it (2026-10-21).
  'sections/catering/inquiry-form.ejs', 'sections/parties/inquiry-form.ejs', 'sections/regulars/signup.ejs',
  // A menu item's photo, and the restaurant's live menu without the bar's own copy (10/25).
  'sections/menu/sections.ejs'])

/** Each template's words, as its own views and server said them. */
const WORDS: Record<string, SiteContext['words']> = {
  bar: { contactAddressLabel: 'Address', contactMessageLabel: 'Your message', contactMessageRequired: 'Please write a short message.' },
  contractor: { contactAddressLabel: 'Office', contactMessageLabel: "What you're working on", contactMessageRequired: 'Tell us a bit about your project.' },
  landscaping: { contactAddressLabel: 'Office', contactMessageLabel: "What you're working on", contactMessageRequired: 'Tell us a bit about your project.' },
  roofing: { contactAddressLabel: 'Office', contactMessageLabel: "What you're working on", contactMessageRequired: 'Tell us a bit about your project.' },
  fieldservice: { contactAddressLabel: 'Office', contactMessageLabel: 'What do you need help with?', contactMessageRequired: 'Tell us what you need help with.' },
  homecare: { contactAddressLabel: 'Office', contactMessageLabel: 'How can we help?', contactMessageRequired: 'Please write a short message.' },
  dispensary: { contactAddressLabel: 'Address', contactMessageLabel: 'Your message', contactMessageRequired: 'Please write a short message.' },
  showcase: { contactAddressLabel: 'Address', contactMessageLabel: 'Your message', contactMessageRequired: 'Please write a short message.' },
  rv: { contactAddressLabel: 'Address', contactMessageLabel: 'How can we help?', contactMessageRequired: 'Please write a short message.' },
  vet: { contactAddressLabel: 'Address', contactMessageLabel: 'How can we help?', contactMessageRequired: 'Please write a short message.' },
}

const SETTINGS = {
  companyName: 'Westridge Builders', tagline: 'Custom homes across the Driftless region', phone: '608-555-0142', email: 'build@westridge.example',
  address: '12 Main St, Verona, WI 53593', logoUrl: '', primaryColor: '#b45309', secondaryColor: '#1e3a5f',
  seoTitle: 'Westridge Builders', seoDescription: 'Custom homes and renovations.',
  nav: [{ label: 'Services', href: 'services' }, { label: 'About', href: 'about' }, { label: 'Contact', href: 'contact' }],
  photoCredits: [{ photographer: 'Ana Lens', photographerUrl: 'https://example.com/ana', source: 'Pexels', count: 2 }],
  contentGaps: [], serviceAreas: ['Verona', 'Madison'], inventoryFeedUrl: '', contactCtaLabel: 'Start a project', accentColor: '#0e7490',
  faviconUrl: '', googleTagManagerId: 'GTM-TEST1', googleAnalyticsId: '', googleAdsId: '', facebookPixelId: '', microsoftClarityId: '',
}

function ctxFor(design: typeof DESIGNS[number]): SiteContext {
  return {
    companyId: 'co_test', slug: 'westridge', settings: SETTINGS, design: designOf(design), words: WORDS[design],
    options: { textSizeToggle: design === 'homecare', shop: false, cover: design === 'bar', ctaHref: design === 'bar' ? '/visit' : '/contact' },
    colours: { primary: SETTINGS.primaryColor, accent: SETTINGS.accentColor, secondary: SETTINGS.secondaryColor },
    // Every feature on: the parity is of the pieces, whichever a business has switched on.
    features: FEATURE_REGISTRY.map((f) => f.id),
  }
}

/**
 * The bar's pages carry their own JSON-LD (its facts: crm/bar/barSite.ts) where its template printed the one its server
 * built; the sample pages have no bar section, so both are handed the same block and the layout around it is compared.
 */
const BAR_JSONLD = '{"@context":"https://schema.org","@type":"BarOrPub","name":"Westridge Builders"}'
const sampleFacts = (design: string) => design !== 'bar' ? null : {
  page: { site: {}, live: null, settings: {} },
  source: { load: async () => ({ site: {}, live: null, settings: {} }), jsonLd: () => BAR_JSONLD, nestedPage: () => null, sitemapPaths: () => [] } as SiteFacts,
}

/** The page as the template's own server built it (server-static.ts renderSections), from the template's views. */
async function renderOld(design: string, sections: any[], currentPath: string, origin: string) {
  const views = path.join(TEMPLATES, 'website-premium-' + design, 'views')
  const settings = { ...SETTINGS, siteOrigin: origin, seoTitle: SETTINGS.seoTitle, seoDescription: SETTINGS.seoDescription }
  const firstHero = sections.find((s) => s && s.type === 'hero')
  const lcpImage = typeof firstHero?.data?.image === 'string' ? firstHero.data.image : ''
  const body = await ejs.renderFile(path.join(views, 'home.ejs'), { homepage: { sections }, settings }) as string
  const html = await ejs.renderFile(path.join(views, 'base.ejs'), { body, assetV: 'V', settings, crmApiUrl: '', currentPath, lcpImage, ...(design === 'bar' ? { jsonLd: BAR_JSONLD } : {}) }) as string
  return absolutizeHrefs(html)
}
/**
 * The bar template's fixes taken for every design, which the other templates' pages don't have yet: the split hero's
 * and split CTA's picture is labelled (role="img"), and the Tag Manager frame has a title.
 */
const barFixes = (html: string) => html.replace(/ role="img" aria-label="[^"]*"/g, '').replace(/ title="Google Tag Manager"/g, '')

/**
 * docs/TRACKING_STANDARD.md, taken for every design: the page's one hidden #form-success and the function that shows it
 * (base.ejs), and each scripted lead form's call to it. The templates' pages don't have them.
 */
const trackingStandard = (html: string) => html
  .replace(/<div id="form-success"[^>]*>[^<]*<\/div>\s*<script>window\.twomiahLeadSent=[^<]*<\/script>/, '')
  .replace(/\s*if \(window\.twomiahLeadSent\) window\.twomiahLeadSent\([^)]*\);/g, '')

/**
 * A sent form resets (bar live test, 2026-10-25): the templates cleared every input's value, which left the "Text me"
 * box ticked with its value wiped. Read back as the templates' line, so everything else still has to match.
 */
const formReset = (html: string) => html
  .replace(/\/\*[^*]*reset\(\)[\s\S]*?\*\/\s*f\.reset\(\);/, "f.querySelectorAll('input:not([type=\"hidden\"]), textarea').forEach(function(i){ i.value = ''; });")

/**
 * Texting consent, taken for every design (2026-10-21): the "Text me" box beside every phone field (server/site/smsConsent.ts)
 * and the footer's Privacy · Terms links (server/site/legal.ts). The templates' pages have neither.
 */
const textingConsent = (html: string) => html
  .replace(/<label class="sms-consent">[\s\S]*?<\/label>/g, '')
  .replace(/\s*<span class="footer-legal">[\s\S]*?<\/span>/g, '')

/**
 * The contact form's own messages, taken for every design (2026-10-22, live test: "Name is required" showed only as the
 * browser's bubble): each box's rules and words (minlength, data-msg), the message line under it, and the check before
 * sending. Taken out here, the form is the template's.
 */
const inlineFormMessages = (html: string) => html
  .replace(/ minlength="\d+"| autocomplete="(?:name|email)"| aria-describedby="cf-[a-z]+-err"| data-msg(?:-invalid)?="[^"]*"/g, '')
  .replace(/\s*<p class="contact-form__error"[^>]*><\/p>/g, '')
  .replace(/(return;)\s*\/\/ The form's own words[\s\S]*?(f\.addEventListener\('submit', function\(e\)\{\s*e\.preventDefault\(\);)[\s\S]*?if \(first\) \{ first\.focus\(\); return; \}\s*(var b = )/, '$1 $2 $3')

const sameAssetVersion = (html: string) => html.replace(/\/styles\/(main|fonts)\.css\?v=[^"]*/g, '/styles/$1.css?v=V')
/** The contact form's one intended change: the message box posts as `message` (the server reads both). */
const messageField = (html: string) => html.replace(/for="cf-project"/g, 'for="cf-message"').replace(/id="cf-project" name="project"/g, 'id="cf-message" name="message"')
/** Whitespace between tags differs where EJS control flow moved, and an apostrophe from the vertical's words is escaped as &#39;; the text does not differ. */
const squash = (html: string) => html.replace(/&#39;/g, "'").replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim()

describe('the section library is the templates\' own files', () => {
  const hash = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  const files: string[] = []
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(path.relative(VIEWS, p).split(path.sep).join('/')) } }
  walk(VIEWS)

  test('every file not merged on purpose is byte-identical to every template that has it', () => {
    const mismatches: string[] = []
    let compared = 0
    for (const rel of files.filter((f) => !MERGED.has(f))) {
      const mine = hash(path.join(VIEWS, rel))
      for (const d of DESIGNS) {
        const theirs = path.join(TEMPLATES, 'website-premium-' + d, 'views', rel)
        if (!fs.existsSync(theirs)) continue
        compared++
        if (hash(theirs) !== mine) mismatches.push(`${rel} ≠ ${d}`)
      }
    }
    expect(mismatches).toEqual([])
    expect(compared).toBeGreaterThan(100)
  })

  test('no template section is missing from the library', () => {
    const missing: string[] = []
    for (const d of DESIGNS) {
      const root = path.join(TEMPLATES, 'website-premium-' + d, 'views')
      const w = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) w(p); else { const rel = path.relative(root, p).split(path.sep).join('/'); if (!files.includes(rel)) missing.push(d + ':' + rel) } } }
      w(root)
    }
    expect(missing).toEqual([])
  })
})

describe('each design\'s sample pages render as the template rendered them', () => {
  for (const design of DESIGNS) {
    for (const sample of ['composition-a.json', 'composition-b.json']) {
      const file = path.join(TEMPLATES, 'website-premium-' + design, 'data', 'samples', sample)
      if (!fs.existsSync(file)) continue
      test(`${design} ${sample}`, async () => {
        const sections = JSON.parse(fs.readFileSync(file, 'utf8')).sections
        const origin = 'https://westridge.example'
        const errors: Array<{ section: string; error: string }> = []
        const mine = await renderSections(ctxFor(design), sections, { title: 'Home' }, { currentPath: '/', origin, sectionErrors: errors, facts: sampleFacts(design) })
        const theirs = await renderOld(design, sections, '/', origin)
        expect(errors).toEqual([])
        expect(squash(barFixes(sameAssetVersion(trackingStandard(textingConsent(inlineFormMessages(mine))))))).toBe(squash(barFixes(sameAssetVersion(messageField(theirs)))))
      })
    }
  }
})

describe('the contact form in each vertical\'s words', () => {
  const data = { heading: 'Start a conversation', intro: 'Tell us about it.', phone: '608-555-0142', email: 'build@westridge.example', address: '12 Main St, Verona, WI', hours: ['Mon–Fri 7–5'], responsePromise: 'We reply within a day.' }
  for (const design of DESIGNS) {
    test(design, async () => {
      // The bar's copy titled the section h2 wherever it stood; the merged one does below another section (isFirst false).
      const mine = await ejs.renderFile(path.join(VIEWS, 'sections/contact/form-info.ejs'), { data, settings: SETTINGS, words: WORDS[design], smsConsent: consentBoxHtml, ...(design === 'bar' ? { isFirst: false } : {}) }) as string
      const theirs = await ejs.renderFile(path.join(TEMPLATES, 'website-premium-' + design, 'views/sections/contact/form-info.ejs'), { data, settings: SETTINGS }) as string
      // Their copies differ only in the comments that explain them; what renders must match.
      expect(squash(formReset(trackingStandard(textingConsent(inlineFormMessages(mine)))))).toBe(squash(messageField(theirs)))
      // …and the box is there, unticked
      expect(mine).toContain('<input type="checkbox" name="smsConsent" value="yes">')
      expect(mine).toContain('name="message"')
      expect(mine).toContain(WORDS[design].contactMessageLabel.replace(/'/g, '&#39;'))
    })
  }
})

describe('each design\'s stylesheet keeps every rule its template served', () => {
  /** Selector → every declaration block given for it (a selector can appear more than once, e.g. in a media query). */
  const rules = (css: string) => {
    const out = new Map<string, string[]>()
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of flat.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const k = m[1].trim().replace(/\s+/g, ' ')
      out.set(k, [...(out.get(k) || []), m[2].trim().replace(/\s+/g, ' ')])
    }
    return out
  }
  // Rules for markup no longer rendered: the old before/after cards (the slider was merged into the contractor
  // one, which styles itself) and roofing's .trust badges (the trust section was rewritten on 2026-07-13).
  const DEAD = /^(\.before-after|\.ba-card|\.ba-chip|\.trust\b|\.trust__|\.trust-badge)/
  // Changed on purpose (2026-10-22, live test): the CTA band's button put the brand's dark shade on the accent — dark on
  // dark when the two are alike; it takes the ink that reads on the accent and a white ring (main.css).
  // And (2026-10-23, live test): the label over a full-bleed photo was the brand colour on the photograph — 1.33:1 median
  // measured in a real render; it has its own dark ground, white text, the brand as its edge (site-hero-label.test.ts).
  const CHANGED = new Set(['.cta--banner .btn--primary', '.hero--full-bleed .hero__eyebrow'])
  for (const design of DESIGNS) {
    test(design, () => {
      const accent = SETTINGS.accentColor || DEFAULT_ACCENT
      const theirs = fs.readFileSync(path.join(TEMPLATES, 'website-premium-' + design, 'build/styles/main.css'), 'utf8')
        .replaceAll('{{PRIMARY_COLOR}}', SETTINGS.primaryColor).replaceAll('{{ACCENT_COLOR_ON_LIGHT}}', accentOnLight(accent)).replaceAll('{{ACCENT_COLOR}}', accent)
        .replaceAll('{{SECONDARY_COLOR}}', ensureDark(SETTINGS.secondaryColor))
        // The bar's text on the brand was fixed dark (it assumed gold); it is now the ink that reads on the owner's pick.
        .replace('--on-brand: #1A1410;', '--on-brand: ' + inkOn(SETTINGS.primaryColor) + ';')
      const mine = rules(siteStylesheet(ctxFor(design)))
      const lost: string[] = []
      for (const [selector, blocks] of rules(theirs)) {
        if (DEAD.test(selector) || CHANGED.has(selector)) continue
        for (const decl of blocks) if (!(mine.get(selector) || []).includes(decl)) lost.push(selector + ' { ' + decl.slice(0, 80) + ' }')
      }
      expect(lost).toEqual([])
    })
  }
})
