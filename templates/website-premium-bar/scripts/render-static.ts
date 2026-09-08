/**
 * render-static.ts — render the bar template to standalone HTML with NO
 * database, for eyeballing, screenshots, Lighthouse runs and pitch mockups.
 *
 *   bun scripts/render-static.ts            # renders content/pages/**.json → _render/
 *   bun scripts/render-static.ts home       # one page
 *   NOW=2026-09-11T19:15:00-05:00 bun scripts/render-static.ts   # freeze "now"
 *   INLINE=1 bun scripts/render-static.ts   # self-contained files for file:// screenshots
 *
 * Reads:
 *   content/settings.json        — the tenant settings row (NAP, nav, brand)
 *   content/hours.json           — lib/hours config (bar + kitchen + holidays)
 *   content/live.json            — sample extras for the board (room, special, game, taps)
 *   content/menu.json, taps.json, events.json, timeline/*.json — optional site data
 *   content/pages/<slug>.json    — { title, sections: [...] } compositions (nested dirs = nested slugs)
 * Writes:
 *   _render/<slug>.html          — nested slugs use "__" (story/1920 → story__1920.html)
 *   _render/main.css             — brand tokens substituted (served by qa-serve as /styles/main.css)
 *
 * Default output LINKS /styles/main.css, /styles/fonts.css and /scripts/*.js exactly
 * like the real server, so Lighthouse over scripts/qa-serve.ts measures the
 * production shape. INLINE=1 embeds everything (fonts via absolute file paths)
 * for file:// previews.
 */
import fs from 'fs'
import path from 'path'
import ejs from 'ejs'
import { pageJsonLd } from '../lib/schema-org/page'
import { liveStateFromHours } from '../lib/live'
import { markdownToHtml } from '../lib/markdown'
import { isHoursConfig, openingHoursSpecification, specialOpeningHours, EMPTY_HOURS, type HoursConfig } from '../lib/hours'

const ROOT = path.resolve(import.meta.dir, '..')
const viewsDir = path.join(ROOT, 'views')
const buildDir = path.join(ROOT, 'build')
const contentDir = path.join(ROOT, 'content')
const outDir = path.join(ROOT, '_render')
const INLINE = process.env.INLINE === '1'

function readJson<T = any>(p: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fallback }
}

const settings: any = readJson(path.join(contentDir, 'settings.json'), {})
const hoursRaw = readJson(path.join(contentDir, 'hours.json'), null)
const hours: HoursConfig = isHoursConfig(hoursRaw) ? hoursRaw : EMPTY_HOURS
const liveExtras: any = readJson(path.join(contentDir, 'live.json'), {})
delete liveExtras._note
const now = process.env.NOW ? new Date(process.env.NOW) : new Date()
const live = liveStateFromHours(hours, now, liveExtras)

// Optional site data from content files (same shapes lib/site-data produces).
const menuRaw: any = readJson(path.join(contentDir, 'menu.json'), { sections: [] })
const menu = (menuRaw.sections || []).map((s: any, si: number) => ({
  id: s.slug, slug: s.slug, name: s.name, description: s.description || null, kind: s.kind || 'food',
  items: (s.items || []).map((i: any, ii: number) => ({ id: s.slug + '/' + i.slug, sectionId: s.slug, sortOrder: ii, isActive: true, is86ed: false, dietary: [], ...i })),
  sortOrder: si,
}))
const signatureItems = menu.flatMap((s: any) => s.items).filter((i: any) => i.isSignature)
const tapsData = readJson(path.join(contentDir, 'taps.json'), { taps: [] }).taps || []
const eventsData = readJson(path.join(contentDir, 'events.json'), { events: [] }).events || []
const timelineDir = path.join(contentDir, 'timeline')
const timeline = fs.existsSync(timelineDir)
  ? fs.readdirSync(timelineDir).filter(f => f.endsWith('.json')).sort().map(f => readJson(path.join(timelineDir, f), null)).filter(Boolean)
  : []

const site = {
  live, hours,
  hoursSchema: {
    bar: [...openingHoursSpecification(hours.bar), ...specialOpeningHours(hours.holidays || [], 'bar')],
    kitchen: [...openingHoursSpecification(hours.kitchen), ...specialOpeningHours(hours.holidays || [], 'kitchen')],
  },
  menu, signatureItems, taps: tapsData, timeline, events: eventsData, loadedAt: now.getTime(),
}

const only = process.argv[2]
// Pages: content/pages/<slug>.json, nested as content/pages/story/1881.json → slug 'story/1881'.
function walkPages(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const f of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, f)
    if (fs.statSync(full).isDirectory()) out.push(...walkPages(full, prefix + f + '/'))
    else if (f.endsWith('.json')) out.push(prefix + f)
  }
  return out
}
const pageFiles = walkPages(path.join(contentDir, 'pages'))
if (pageFiles.length === 0) {
  console.error('No content/pages/*.json found — nothing to render.')
  process.exit(1)
}
fs.mkdirSync(outDir, { recursive: true })

const css = fs.readFileSync(path.join(buildDir, 'styles', 'main.css'), 'utf8')
  .replace(/\{\{PRIMARY_COLOR\}\}/g, settings.primaryColor || '#C9A24E')
  .replace(/\{\{SECONDARY_COLOR\}\}/g, settings.secondaryColor || '#1F3A2E')
  .replace(/\{\{ACCENT_COLOR\}\}/g, settings.accentColor || '#EFE6D2')
fs.writeFileSync(path.join(outDir, 'main.css'), css)
const fontsDirUrl = 'file:///' + path.join(buildDir, 'fonts').replace(/\\/g, '/') + '/'
const fontsCss = (() => { try { return fs.readFileSync(path.join(buildDir, 'styles', 'fonts.css'), 'utf8') } catch { return '' } })()
  .split("url('/fonts/").join("url('" + fontsDirUrl)

const RE_MAIN = /<link\s+rel=["']stylesheet["']\s+href=["']\/styles\/main\.css[^"']*["']\s*\/?>/i
const RE_FONTS = /<link\s+rel=["']stylesheet["']\s+href=["']\/styles\/fonts\.css[^"']*["']\s*\/?>/i
const RE_SCRIPT = /<script\s+src=["']\/scripts\/([^"']+)["']([^>]*)><\/script>/g

function finish(html: string): string {
  if (!INLINE) return html.replace(/href=["']\/styles\/main\.css[^"']*["']/i, 'href="/styles/main.css"')
  html = html.replace(RE_FONTS, () => '<style>\n' + fontsCss + '\n</style>')
  html = html.replace(RE_MAIN, () => '<style>\n' + css + '\n</style>')
  html = html.replace(RE_SCRIPT, (_m, p, attrs) => {
    try { return '<script' + attrs + '>\n' + fs.readFileSync(path.join(buildDir, 'scripts', p), 'utf8') + '\n</script>' } catch { return _m }
  })
  return html
}

// Synthesized pages: one per signature menu item (/burgers/<slug>), like the server does.
interface RenderablePage { slug: string; page: any; item?: { section: any; item: any } }
const renderables: RenderablePage[] = pageFiles.map(file => ({ slug: file.replace(/\.json$/, ''), page: readJson(path.join(contentDir, 'pages', ...file.split('/')), { sections: [] }) }))
for (const sec of menu) for (const it of sec.items) if (it.isSignature) {
  renderables.push({ slug: sec.slug + '/' + it.slug, item: { section: sec, item: it }, page: { title: it.name, metaTitle: `${it.name} — ${settings.companyName}`, metaDescription: it.description || '', sections: [{ type: 'menu', variant: 'item-hero', data: { slug: it.slug, section: sec.slug, eyebrow: sec.name } }] } })
}

for (const { slug, page, item } of renderables) {
  if (only && slug !== only) continue
  const currentPath = slug === 'home' ? '/' : '/' + slug
  const effectiveSettings = { ...settings, seoTitle: page.metaTitle || settings.seoTitle || page.title, seoDescription: page.metaDescription || settings.seoDescription || '' }
  const jsonLd = pageJsonLd({ slug, title: page.title, sections: page.sections || [], settings: effectiveSettings, hoursSchema: site.hoursSchema, menu, events: eventsData, item: item || null })
  const body = await ejs.renderFile(path.join(viewsDir, 'home.ejs'), { homepage: page, settings: effectiveSettings, site, live, md: markdownToHtml, currentPath }) as string
  const first = (page.sections || [])[0]
  const lcpImage = first?.type === 'tonight' ? (first.data?.titleImageSmall || first.data?.titleImage || first.data?.art || '') : (first?.data?.image || '')
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings: effectiveSettings, site, live, currentPath, assetV: 'static', jsonLd, lcpImage }) as string
  const out = path.join(outDir, slug.replace(/\//g, '__') + '.html')
  fs.writeFileSync(out, finish(html))
  console.log('OK →', path.relative(ROOT, out), 'now=' + now.toISOString() + (INLINE ? ' (inline)' : ''))
}
