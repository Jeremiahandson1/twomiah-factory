// The Web presence plan's site (the $19 plan): ONE page drawn by the unified renderer — the same sections, looks, palette and
// feel as every Twomiah site, never a second template system. The Factory calls this with the owner's saved model (nothing is
// stored here: it is a pure function) and gets back the page's files; the site's own function keeps them in that site's Blobs.
//
// One page only: the menu is in-page anchors (#services, #contact), there is no /services/<slug> and no blog. The other files
// are the privacy page the forms need, and the sitemap / robots / llms for that one page.
import { businessHoursLines } from '@twomiah/tenant-backend'
import { renderSections, assetVersion, escXml } from './render.ts'
import { siteStylesheet } from './routes.ts'
import { previewContext } from './signupPreview.ts'
import { cleanPalette } from './palette.ts'
import { cleanStyle } from './feel.ts'
import { WEB_PRESENCE_SECTIONS } from './webPresenceSections.ts'
import { effectiveForms } from '../../../api/src/webPresence/site/clean.mjs'

export interface OnePageSection { id: string; type: string; variant: string; hidden?: boolean; data: Record<string, any> }
export interface OnePageModel {
  business: { name: string; phone?: string; email?: string; address?: string; city?: string; state?: string; zip?: string; tagline?: string; hours?: Record<string, any>; serviceAreas?: string[]; logo?: string }
  look: { design?: string; palette?: Record<string, string>; style?: Record<string, string> }
  forms: { lead: { on: boolean; inbox?: string; extraFields?: Array<{ label: string }> }; hiring: { on: boolean; inbox?: string } }
  sections: OnePageSection[]
}
/** What the trade's table says about each capability (apps/api/src/webPresence/sections.ts): anchor and menu word. */
export type CapInfo = Record<string, { anchor: string; nav?: string }>

export interface OnePageInput {
  model: OnePageModel
  /** The unified vertical's id (core/vertical.ts) the trade runs as. */
  vertical: string
  caps: CapInfo
  /** The page's public address, https://…, no trailing slash. */
  origin: string
  /** The resume limit the hiring form states, in MB. */
  resumeLimitMb?: number
  /** Today (tests pin it); the date the privacy page was written. */
  now?: Date
}
export interface OnePageOutput {
  /** The model as the renderer's guards left it (colours kept readable); the site stores THIS. */
  model: OnePageModel
  /** path → text. index.html, privacy/index.html, styles/main.css, sitemap.xml, robots.txt, llms.txt. */
  files: Record<string, string>
  /** Local files the pages point at that the publisher must ship: /hero-library/… photos and /fonts/… faces. */
  assets: string[]
  /** Which forms are really on the published page. */
  forms: { lead: boolean; hiring: boolean }
  sectionErrors: Array<{ section: string; error: string }>
}

const oneLine = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
const MENU_MAX = 6

function fullAddress(b: OnePageModel['business']): string {
  return [b.address, [b.city, b.state].filter(Boolean).join(', '), b.zip].map(oneLine).filter(Boolean).join(', ')
}

/** A button that points at an in-page anchor the page does not have is dropped, not left dead. */
function liveCta(cta: any, anchors: Set<string>): any {
  if (!cta || typeof cta !== 'object' || !cta.label) return undefined
  if (String(cta.href || '').startsWith('#') && !anchors.has(String(cta.href).slice(1))) return undefined
  return cta
}

/** The model's sections as the renderer's: hidden and switched-off ones out, anchors on, the forms' flags set. */
export function rendererSections(i: OnePageInput): { sections: any[]; anchors: Set<string>; forms: { lead: boolean; hiring: boolean } } {
  const m = i.model
  const forms = effectiveForms(m)
  const business = m.business
  const kept = m.sections.filter((s) => !s.hidden && (s.id !== 'hiring' || forms.hiring))
  const anchors = new Set(kept.map((s) => i.caps[s.id]?.anchor).filter(Boolean) as string[])
  anchors.add('top')
  const sections = kept.map((s) => {
    let data: Record<string, any> = { ...(s.data || {}) }
    if (s.type === 'hero') {
      data.primaryCta = liveCta(data.primaryCta, anchors)
      data.secondaryCta = liveCta(data.secondaryCta, anchors)
      if (!data.primaryCta) delete data.primaryCta
      if (!data.secondaryCta) delete data.secondaryCta
      if (!data.stats?.length) delete data.stats
    }
    if (s.type === 'cta') { data.primaryCta = liveCta(data.primaryCta, anchors) || undefined }
    if (s.type === 'contact') {
      data = { ...data, phone: business.phone || '', email: business.email || '', address: fullAddress(business), id: 'contact', webPresence: true, noForm: !forms.lead, extraFields: m.forms.lead.extraFields || [], areas: business.serviceAreas || [] }
    }
    if (s.type === 'hiring') data = { ...data, resumeLimitMb: i.resumeLimitMb ?? 3 }
    const anchor = i.caps[s.id]?.anchor
    return { type: s.type, variant: s.variant, data, ...(anchor ? { _onepageAnchor: anchor } : {}) }
  })
  return { sections, anchors, forms }
}

function privacyBody(i: OnePageInput, forms: { lead: boolean; hiring: boolean }, updated: string, fontsFromGoogle: boolean): string {
  const b = i.model.business
  const h = (s: string) => escXml(s)
  const contact = [b.phone && `Phone: ${h(b.phone)}`, b.email && `Email: <a href="mailto:${h(b.email)}">${h(b.email)}</a>`, fullAddress(b) && h(fullAddress(b))].filter(Boolean).join('<br>')
  const inbox = (v?: string) => (v ? h(v) : 'the business&rsquo;s email address')
  const parts: string[] = []
  parts.push(`<p>This page says what ${h(b.name)}&rsquo;s website collects and where it goes. It is a single page with no accounts, no shop and no advertising.</p>`)
  parts.push(`<h2>Visiting the page</h2><p>The page sets no cookies for visitors and loads no advertising or tracking tools.${fontsFromGoogle ? ' Its typefaces are loaded from Google Fonts, so your browser asks Google for them.' : ''} Our hosting provider, Netlify, keeps ordinary server records (such as the time of a visit and the visitor&rsquo;s network address) to run and protect the site.</p>`)
  if (forms.lead) {
    parts.push(`<h2>The contact form</h2><p>If you use the contact form, what you type (your name, your phone number and/or email address, your message${(i.model.forms.lead.extraFields || []).length ? ' and the extra questions it asks' : ''}) is sent by email to ${inbox(i.model.forms.lead.inbox)}. It is handled by Netlify Forms. ${h(b.name)} is the only person it is sent to, and the website&rsquo;s builder, Twomiah, does not keep a copy. We use it to reply to you.</p>`)
  }
  if (forms.hiring) {
    const mb = i.resumeLimitMb ?? 3
    parts.push(`<h2>The job application form</h2><p>If you apply for a job, what you type (your name, phone number, email address, a few words about you, when you can work and which job) and an optional resume are sent by email to ${inbox(i.model.forms.hiring.inbox)}. It is handled by Netlify Forms. A resume must be a PDF or Word file (.pdf, .doc or .docx) of at most ${mb} MB. ${h(b.name)} is the only person it is sent to, and Twomiah does not keep a copy. It is used only to consider your application.</p>`)
  }
  if (!forms.lead && !forms.hiring) parts.push('<h2>Forms</h2><p>This page has no forms, so it collects nothing you type.</p>')
  parts.push('<h2>Where the information is kept</h2><p>Netlify, the company that hosts this page and runs the forms, holds form submissions on its servers for as long as its settings keep them. Ask the business to remove yours at any time.</p>')
  if (contact) parts.push(`<h2>Contact</h2><p>${contact}</p>`)
  return `<section class="legal-page"><div class="container legal-page__inner"><h1>Privacy Policy</h1><p class="legal-page__updated">Last updated ${h(updated)}</p>${parts.join('')}</div></section>`
}

function llmsText(i: OnePageInput, sections: any[]): string {
  const b = i.model.business
  const lines = ['# ' + (oneLine(b.name) || 'Website'), '']
  const summary = oneLine(b.tagline)
  if (summary) lines.push('> ' + summary, '')
  const area = [b.city, b.state].map(oneLine).filter(Boolean).join(', ')
  const contact = [b.phone ? 'Phone: ' + oneLine(b.phone) : '', b.email ? 'Email: ' + oneLine(b.email) : '', area ? 'Area: ' + area : ''].filter(Boolean)
  if (contact.length) lines.push('## Contact', '', ...contact.map((c) => '- ' + c), '')
  lines.push('## Page', '', `- [${oneLine(b.name)}](${i.origin}/): ${sections.map((s) => s.type).filter((t, k, a) => a.indexOf(t) === k).slice(0, 6).join(', ')}`, '')
  return lines.join('\n')
}

export async function renderOnePage(i: OnePageInput): Promise<OnePageOutput> {
  const m = i.model
  const b = m.business
  const palette = cleanPalette(m.look.palette)
  const style = cleanStyle(m.look.style)
  const { sections, forms } = rendererSections(i)

  // The in-page menu: the first six sections that have a menu word, in page order.
  const nav: Array<{ label: string; href: string }> = []
  for (const s of m.sections) {
    const c = i.caps[s.id]
    if (!c?.nav || s.hidden || (s.id === 'hiring' && !forms.hiring)) continue
    if (nav.length < MENU_MAX) nav.push({ label: c.nav, href: '#' + c.anchor })
  }
  const hasContact = sections.some((s) => s.type === 'contact')
  const hours = (b.hours && Object.keys(b.hours).length ? b.hours : null) as any
  const settingsExtra: Record<string, any> = {
    phone: b.phone || '', email: b.email || '', address: fullAddress(b), streetAddress: b.address || '', addressLocality: b.city || '', addressRegion: b.state || '', postalCode: b.zip || '',
    logoUrl: b.logo || '', tagline: oneLine(b.tagline),
    seoDescription: oneLine(b.tagline) || oneLine(sections.find((s) => s.type === 'hero')?.data?.subtitle),
    businessHours: hours, businessHoursLines: hours ? businessHoursLines(hours) : [],
    serviceAreas: (b.serviceAreas || []).map((name) => ({ name })),
    nav, contactHref: hasContact ? '#contact' : '', contactCtaLabel: forms.lead ? 'Get in touch' : 'Contact',
    // No header button unless there is a contact section to go to.
    noHeaderCta: !hasContact,
    // The one page has no other pages to link a footer to but its privacy page.
    onePage: true,
  }
  const primary = palette?.brand || '#1f4e79'
  const input = {
    vertical: i.vertical, design: m.look.design, company: { name: b.name, primaryColor: primary },
    settings: {}, sections, features: [] as string[], title: b.name, palette, style, settingsExtra,
  }
  const ctx = await previewContext(input)
  const sectionErrors: Array<{ section: string; error: string }> = []
  let html = await renderSections(ctx, sections, { title: b.name }, { currentPath: '/', origin: i.origin, sectionErrors })
  const css = siteStylesheet(ctx)
  const v = assetVersion(ctx)

  const updated = (i.now ?? new Date()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const { renderBody } = await import('./render.ts')
  let privacy = await renderBody(ctx, privacyBody(i, forms, updated, /fonts\.googleapis\.com\/css2/.test(html)), { siteOrigin: i.origin, seoTitle: 'Privacy Policy — ' + b.name, seoDescription: '' }, '/privacy', { title: 'Privacy Policy' })

  // The pages point at /styles/main.css?v=… — shipped as a file, cached for a year; the version changes with the colours.
  const assets = new Set<string>()
  for (const page of [html, privacy]) {
    for (const m of page.matchAll(/(?:src|href|srcset|content)="([^"]*)"/g)) {
      const mm = /^\/(hero-library\/[A-Za-z0-9_./-]+|fonts\/[A-Za-z0-9_.-]+\.woff2)/.exec(m[1])
      if (mm) assets.add(mm[1])
    }
    for (const m of page.matchAll(/url\(['"]?(\/hero-library\/[A-Za-z0-9_./-]+)['"]?\)/g)) assets.add(m[1].slice(1))
  }
  if (/\/styles\/fonts\.css/.test(html)) assets.add('styles/fonts.css')

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${escXml(i.origin + '/')}</loc></url>\n  <url><loc>${escXml(i.origin + '/privacy')}</loc></url>\n</urlset>\n`
  const robots = `User-agent: *\nAllow: /\nDisallow: /edit/\nDisallow: /api/\n\nSitemap: ${i.origin}/sitemap.xml\n`
  return {
    model: { ...m, look: { ...m.look, palette: (palette ?? {}) as Record<string, string>, style: (style ?? {}) as Record<string, string> } },
    files: { 'index.html': html, 'privacy/index.html': privacy, 'styles/main.css': css, 'sitemap.xml': sitemap, 'robots.txt': robots, 'llms.txt': llmsText(i, sections) },
    assets: [...assets],
    forms,
    sectionErrors,
  }
}

/** The sections this plan alone draws (held out of the full product's picker). Exported for the guard tests. */
export const PLAN_ONLY_SECTIONS = WEB_PRESENCE_SECTIONS
