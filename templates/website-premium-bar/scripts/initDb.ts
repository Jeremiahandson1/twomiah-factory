/**
 * Boot seed. Runs after Drizzle pushes the schema. Idempotent — safe on every boot.
 *
 * Settings and page compositions follow "seed-if-untouched": the seed records
 * a hash of what it wrote (seed_marks). When the content files change in a
 * later deploy, a row is re-applied only if nobody has edited it in the admin
 * since the seed last wrote it (row.updated_at <= mark.applied_at). Admin edits
 * therefore always win; content/ still flows through for anything untouched.
 * SEED_OVERWRITE=1 forces every row back to content/ regardless.
 *
 * Three sources, in order:
 *
 * 1. FACTORY MODE (Twomiah Factory deploys): when FACTORY_URL + TENANT_ID +
 *    FACTORY_SYNC_KEY are all set, fetch the bootstrap payload from the
 *    factory's /api/v1/factory/internal/site-bootstrap/<tenantId> endpoint
 *    (the customer's composed pages, brand settings, admin user spec).
 *
 * 2. CONTENT MODE (reference tenant / hand-composed sites): when the
 *    template ships a `content/` directory — `content/settings.json` and
 *    `content/pages/<slug>.json` — seed from those files. This is how the
 *    Amber Inn (and any hand-built bar) keeps its tenant content in the
 *    repo while the machinery stays generic.
 *
 * 3. LOCAL MODE (fallback): ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD /
 *    COMPANY_NAME and empty page rows; the site renders the placeholder
 *    home page until content is edited in the admin.
 */
import fs from 'fs'
import path from 'path'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users, settings, pages, serviceStatus, menuSections, menuItems, taps, staffPins, seedMarks, timelineEntries } from '../db/schema'

interface BootstrapSettings {
  photoCredits?: Array<{ photographer: string; photographerUrl?: string; sourceUrl?: string; source: string }>
  companyName: string
  tagline?: string
  phone?: string
  email?: string
  address?: string
  primaryColor?: string
  secondaryColor?: string
  accentColor?: string
  seoTitle?: string
  seoDescription?: string
  contactCtaLabel?: string
  faviconUrl?: string | null
  logoUrl?: string | null
  headerLogoUrl?: string | null
  nav?: Array<{ label: string; href: string }>
  // Bar template extras (all optional)
  streetAddress?: string
  addressLocality?: string
  addressRegion?: string
  postalCode?: string
  geo?: { lat?: number | string; lng?: number | string }
  geoLat?: string | number
  geoLng?: string | number
  sameAs?: string[]
  schemaType?: string
  siteOrigin?: string
  servesCuisine?: string
  priceRange?: string
  established?: number
  timezone?: string
  fontDisplay?: string
  fontEyebrow?: string
  fontBody?: string
  fontMono?: string
  theme?: string
  hours?: unknown
}

interface BootstrapPayload {
  settings: BootstrapSettings
  pages: Array<{
    slug: string
    title: string
    sections: any[]
    navOrder: number
    isPublished: boolean
    metaTitle?: string
    metaDescription?: string
  }>
}

async function tryFetchFromFactory(): Promise<BootstrapPayload | null> {
  const factoryUrl = process.env.FACTORY_URL
  const tenantId = process.env.TENANT_ID
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!factoryUrl || !tenantId || !syncKey) {
    console.log('[initDb] FACTORY_URL/TENANT_ID/FACTORY_SYNC_KEY not all set — trying content/ then local mode.')
    return null
  }
  try {
    const url = factoryUrl.replace(/\/+$/, '') + '/api/v1/factory/internal/site-bootstrap/' + tenantId
    const res = await fetch(url, {
      headers: { 'X-Factory-Key': syncKey },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      console.warn('[initDb] Factory bootstrap returned HTTP ' + res.status + ' — falling back.')
      return null
    }
    const payload = await res.json() as BootstrapPayload
    console.log('[initDb] Bootstrap payload fetched from factory — ' + (payload.pages?.length || 0) + ' pages')
    return payload
  } catch (err: any) {
    console.warn('[initDb] Factory bootstrap fetch failed: ' + err.message + ' — falling back.')
    return null
  }
}

const CONTENT_DIR = path.resolve(import.meta.dir, '..', 'content')

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T } catch { return null }
}

/** Seed from content/settings.json + content/pages/*.json when present. */
function tryContentDir(): BootstrapPayload | null {
  const s = readJson<BootstrapSettings>(path.join(CONTENT_DIR, 'settings.json'))
  const hours = readJson<unknown>(path.join(CONTENT_DIR, 'hours.json'))
  if (s && hours) s.hours = hours
  const pagesDir = path.join(CONTENT_DIR, 'pages')
  if (!s || !fs.existsSync(pagesDir)) return null
  // Nested pages: content/pages/story/1881.json → slug 'story/1881'.
  const walk = (dir: string, prefix = ''): string[] => {
    const out: string[] = []
    for (const f of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, f)
      if (fs.statSync(full).isDirectory()) out.push(...walk(full, prefix + f + '/'))
      else if (f.endsWith('.json')) out.push(prefix + f)
    }
    return out
  }
  const files = walk(pagesDir)
  const navHrefs = (s.nav || []).map(n => n.href.replace(/^\//, ''))
  const pageRows = files.map(f => {
    const slug = f.replace(/\.json$/, '')
    const page = readJson<any>(path.join(pagesDir, ...f.split('/'))) || {}
    const navIdx = navHrefs.indexOf(slug)
    return {
      slug,
      title: page.title || slug,
      sections: Array.isArray(page.sections) ? page.sections : [],
      navOrder: slug === 'home' ? 0 : navIdx >= 0 ? navIdx + 1 : 99,
      isPublished: page.isPublished !== false,
      metaTitle: page.metaTitle,
      metaDescription: page.metaDescription,
    }
  })
  console.log('[initDb] Seeding from content/ — ' + pageRows.length + ' pages')
  return { settings: s, pages: pageRows }
}

function buildLocalPayload(): BootstrapPayload {
  return {
    settings: {
      companyName: process.env.COMPANY_NAME || 'Your Bar',
      contactCtaLabel: 'Visit',
      nav: [
        { label: 'Menu', href: '/menu' },
        { label: 'Story', href: '/story' },
        { label: 'Visit', href: '/visit' },
      ],
    },
    pages: [
      { slug: 'home',  title: 'Home',  sections: [], navOrder: 0, isPublished: true },
      { slug: 'menu',  title: 'Menu',  sections: [], navOrder: 1, isPublished: true },
      { slug: 'story', title: 'Story', sections: [], navOrder: 2, isPublished: true },
      { slug: 'visit', title: 'Visit', sections: [], navOrder: 3, isPublished: true },
    ],
  }
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s ? s : null
}

async function main() {
  const payload = (await tryFetchFromFactory()) || tryContentDir() || buildLocalPayload()

  // ── Admin user (from env vars — set by deploy.ts) ──────────────────────
  const adminEmail = process.env.ADMIN_EMAIL || ''
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || ''
  const existingUsers = await db.select().from(users).limit(1)
  if (existingUsers.length === 0) {
    if (!adminEmail || !adminPassword) {
      console.error('[initDb] ADMIN_EMAIL + ADMIN_INITIAL_PASSWORD must be set on first boot. Aborting.')
      process.exit(1)
    }
    const passwordHash = await bcrypt.hash(adminPassword, 10)
    await db.insert(users).values({
      email: adminEmail.toLowerCase(),
      passwordHash,
      name: null,
      role: 'admin',
    })
    console.log('[initDb] Created initial admin user: ' + adminEmail)
  } else {
    console.log('[initDb] Users table already populated — skipping admin seed.')
  }

  // ── Settings ───────────────────────────────────────────────────────────
  const FORCE = process.env.SEED_OVERWRITE === '1'
  // Canonical JSON (sorted keys) — jsonb comes back from Postgres with its own key order.
  const canon = (v: any): any => v === undefined ? null : Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object' && !(v instanceof Date)) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v
  const hashOf = (v: unknown) => new Bun.CryptoHasher('sha256').update(JSON.stringify(canon(v))).digest('hex')
  const sameAs = (row: Record<string, any>, values: Record<string, any>) =>
    Object.keys(values).every(k => JSON.stringify(canon(row[k] ?? null)) === JSON.stringify(canon(values[k] ?? null)))
  /** Decide what to do with one seeded row. Returns 'apply' | 'skip' and keeps seed_marks current. */
  async function seedDecision(key: string, values: Record<string, any>, row: Record<string, any> | undefined): Promise<'apply' | 'skip'> {
    const hash = hashOf(values)
    const mark = (await db.select().from(seedMarks).where(eq(seedMarks.key, key)).limit(1))[0]
    const setMark = async () => {
      if (mark) await db.update(seedMarks).set({ hash, appliedAt: new Date() }).where(eq(seedMarks.key, key))
      else await db.insert(seedMarks).values({ key, hash })
    }
    if (!row || FORCE) { await setMark(); return 'apply' }
    if (!mark) {
      // Legacy row from before marks existed: adopt it if it still equals the seed, else it is the admin's.
      if (sameAs(row, values)) { await setMark(); return 'skip' }
      console.log('[initDb] ' + key + ': differs from content and has no seed mark — leaving the admin version alone (SEED_OVERWRITE=1 to force).')
      return 'skip'
    }
    if (mark.hash === hash) return 'skip'                       // seed unchanged since last applied
    const edited = row.updatedAt && new Date(row.updatedAt).getTime() > new Date(mark.appliedAt).getTime() + 2000
    if (edited) { console.log('[initDb] ' + key + ': content changed but the row was edited in the admin since the seed — keeping the admin version.'); return 'skip' }
    await setMark(); return 'apply'
  }
  const existingSettings = await db.select().from(settings).limit(1)
  {
    const s = payload.settings
    const values = {
      companyName: s.companyName,
      tagline: str(s.tagline),
      phone: str(s.phone),
      email: str(s.email),
      address: str(s.address),
      primaryColor: str(s.primaryColor),
      secondaryColor: str(s.secondaryColor),
      accentColor: str(s.accentColor),
      seoTitle: str(s.seoTitle),
      seoDescription: str(s.seoDescription),
      contactCtaLabel: s.contactCtaLabel || 'Visit',
      faviconUrl: str(s.faviconUrl),
      logoUrl: str(s.logoUrl),
      headerLogoUrl: str(s.headerLogoUrl),
      nav: s.nav || [],
      photoCredits: s.photoCredits || [],
      streetAddress: str(s.streetAddress),
      addressLocality: str(s.addressLocality),
      addressRegion: str(s.addressRegion),
      postalCode: str(s.postalCode),
      geoLat: str(s.geoLat ?? s.geo?.lat),
      geoLng: str(s.geoLng ?? s.geo?.lng),
      sameAs: Array.isArray(s.sameAs) ? s.sameAs : [],
      schemaType: s.schemaType || 'BarOrPub',
      // Falls back to Render's SITE_URL so JSON-LD / canonical URLs are absolute on the very first boot.
      siteOrigin: str(s.siteOrigin) || str(process.env.SITE_URL) || null,
      servesCuisine: str(s.servesCuisine),
      priceRange: str(s.priceRange),
      established: typeof s.established === 'number' ? s.established : (Number(s.established) || null),
      timezone: s.timezone || 'America/Chicago',
      fontDisplay: str(s.fontDisplay),
      fontEyebrow: str(s.fontEyebrow),
      fontBody: str(s.fontBody),
      fontMono: str(s.fontMono),
      theme: s.theme === 'dark' || s.theme === 'light' ? s.theme : 'auto',
      hours: s.hours ?? null,
    }
    const decision = await seedDecision('settings', values, existingSettings[0])
    if (existingSettings.length === 0) {
      await db.insert(settings).values(values)
      console.log('[initDb] Created initial settings row.')
    } else if (decision === 'apply') {
      await db.update(settings).set({ ...values, updatedAt: new Date() }).where(eq(settings.id, existingSettings[0].id))
      console.log('[initDb] Settings row re-applied from content.')
    } else {
      console.log('[initDb] Settings row up to date — skipping.')
    }
  }

  // ── Service status singleton (the console writes here) ────────────────
  const existingStatus = await db.select().from(serviceStatus).limit(1)
  if (existingStatus.length === 0) {
    await db.insert(serviceStatus).values({ roomStatus: 'quiet' })
    console.log('[initDb] Created service_status row.')
  }

  // ── Menu (content/menu.json → menu_sections + menu_items; Square takes over in Phase 2) ──
  // There is no admin menu editor yet, so the file is the only source: when its hash
  // changes (seed_marks "menu"), the sections/items are rebuilt from it. The console's
  // 86 flags live on the items and are lost on rebuild — acceptable until Square.
  const menuFile = readJson<any>(path.join(CONTENT_DIR, 'menu.json'))
  if (menuFile && Array.isArray(menuFile.sections)) {
    const menuHash = hashOf(menuFile.sections)
    const mark = (await db.select().from(seedMarks).where(eq(seedMarks.key, 'menu')).limit(1))[0]
    const existingSections = await db.select().from(menuSections).limit(1)
    if (existingSections.length === 0 || FORCE || !mark || mark.hash !== menuHash) {
      await db.delete(menuItems)
      await db.delete(menuSections)
      let sIdx = 0, count = 0
      for (const sec of menuFile.sections) {
        if (!sec || !sec.slug || !sec.name) continue
        const [row] = await db.insert(menuSections).values({
          slug: sec.slug, name: sec.name, description: str(sec.description), kind: sec.kind === 'drink' ? 'drink' : 'food', sortOrder: sIdx++,
        }).returning()
        let iIdx = 0
        for (const it of (sec.items || [])) {
          if (!it || !it.slug || !it.name) continue
          await db.insert(menuItems).values({
            sectionId: row.id, slug: it.slug, name: it.name, description: str(it.description),
            priceCents: typeof it.priceCents === 'number' ? it.priceCents : null, priceLabel: str(it.priceLabel),
            dietary: Array.isArray(it.dietary) ? it.dietary : [], imageUrl: str(it.imageUrl), heroImageUrl: str(it.heroImageUrl),
            story: str(it.story), isSignature: !!it.isSignature, sortOrder: iIdx++,
          })
          count++
        }
      }
      if (mark) await db.update(seedMarks).set({ hash: menuHash, appliedAt: new Date() }).where(eq(seedMarks.key, 'menu'))
      else await db.insert(seedMarks).values({ key: 'menu', hash: menuHash })
      console.log('[initDb] Menu (re)built from content: ' + count + ' items in ' + sIdx + ' sections.')
    } else {
      console.log('[initDb] Menu up to date — skipping.')
    }
  }

  // ── Taps (content/taps.json; the console maintains these afterwards) ──
  const tapsFile = readJson<any>(path.join(CONTENT_DIR, 'taps.json'))
  if (tapsFile && Array.isArray(tapsFile.taps)) {
    const existingTaps = await db.select().from(taps).limit(1)
    if (existingTaps.length === 0) {
      let n = 0
      for (const t of tapsFile.taps) {
        if (!t || !t.beerName) continue
        await db.insert(taps).values({
          lineNumber: Number(t.lineNumber) || (n + 1), beerName: t.beerName, brewery: str(t.brewery), style: str(t.style),
          abv: t.abv !== undefined && t.abv !== null && t.abv !== '' ? String(t.abv) : null, originCountry: str(t.originCountry),
          description: str(t.description), badge: str(t.badge), priceCents: typeof t.priceCents === 'number' ? t.priceCents : null,
          status: ['pouring', 'just_tapped', 'last_keg', 'blown'].includes(t.status) ? t.status : 'pouring',
          isActive: t.isActive !== false, sortOrder: Number(t.sortOrder) || n, tappedAt: new Date(),
        })
        n++
      }
      console.log('[initDb] Seeded taps: ' + n)
    }
  }

  // ── Timeline chapters (content/timeline/*.json) — seed-if-untouched, keyed by slug ──
  // The story page and /story/<slug> read these from the DB; without this seed the
  // live book was empty even though the static QA render (which reads the files) was full.
  const timelineDir = path.join(CONTENT_DIR, 'timeline')
  if (fs.existsSync(timelineDir)) {
    let written = 0
    for (const f of fs.readdirSync(timelineDir).filter(x => x.endsWith('.json')).sort()) {
      const e = readJson<any>(path.join(timelineDir, f))
      if (!e || !e.slug || !e.title) continue
      const int = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null
      const values = {
        yearStart: int(e.yearStart), yearEnd: int(e.yearEnd), title: String(e.title), bodyMd: typeof e.bodyMd === 'string' ? e.bodyMd : '',
        imageUrl: str(e.imageUrl), imageCredit: str(e.imageCredit), imageYear: int(e.imageYear), thenImageUrl: str(e.thenImageUrl), nowImageUrl: str(e.nowImageUrl),
        sortOrder: int(e.sortOrder) ?? 0, isPublished: e.isPublished !== false,
      }
      const [row] = await db.select().from(timelineEntries).where(eq(timelineEntries.slug, e.slug)).limit(1)
      const decision = await seedDecision('timeline:' + e.slug, values, row)
      if (!row) { await db.insert(timelineEntries).values({ slug: e.slug, ...values }); written++ }
      else if (decision === 'apply') { await db.update(timelineEntries).set({ ...values, updatedAt: new Date() }).where(eq(timelineEntries.slug, e.slug)); written++ }
    }
    console.log('[initDb] Timeline: ' + written + ' chapter(s) written from content/timeline.')
  }

  // ── Console PIN (CONSOLE_PIN env → first staff pin, label "Bar phone") ──
  const consolePin = (process.env.CONSOLE_PIN || '').replace(/\D/g, '')
  const existingPins = await db.select().from(staffPins).limit(1)
  if (existingPins.length === 0) {
    if (consolePin.length >= 4 && consolePin.length <= 8) {
      await db.insert(staffPins).values({ label: process.env.CONSOLE_PIN_LABEL || 'Bar phone', pinHash: await bcrypt.hash(consolePin, 10) })
      console.log('[initDb] Created console PIN (' + (process.env.CONSOLE_PIN_LABEL || 'Bar phone') + ').')
    } else {
      console.warn('[initDb] CONSOLE_PIN not set (4-8 digits) — /console will not accept logins until a PIN exists.')
    }
  }

  // ── Pages ──────────────────────────────────────────────────────────────
  for (const p of payload.pages) {
    const existing = await db.select().from(pages).where(eq(pages.slug, p.slug)).limit(1)
    const values = { title: p.title, sections: p.sections, navOrder: p.navOrder, isPublished: p.isPublished, metaTitle: p.metaTitle || null, metaDescription: p.metaDescription || null }
    const decision = await seedDecision('page:' + p.slug, values, existing[0])
    if (existing.length === 0) {
      await db.insert(pages).values({ slug: p.slug, ...values })
      console.log('[initDb] Created page: ' + p.slug + ' (' + (p.sections?.length || 0) + ' sections)')
    } else if (decision === 'apply') {
      await db.update(pages).set({ ...values, updatedAt: new Date() }).where(eq(pages.slug, p.slug))
      console.log('[initDb] Page re-applied from content: ' + p.slug)
    } else {
      console.log('[initDb] Page up to date: ' + p.slug + ' — skipping.')
    }
  }

  console.log('[initDb] Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error('[initDb] Failed:', err.message || err)
  process.exit(1)
})
