/**
 * First-boot seed. Runs after Drizzle pushes the schema. Idempotent —
 * skips any row that already exists, so safe to re-run on every boot.
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
import { users, settings, pages, serviceStatus, menuSections, menuItems, taps, staffPins } from '../db/schema'

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
  // SEED_OVERWRITE=1: content/ (or the factory payload) is the source of truth —
  // re-apply settings + page compositions on every boot. Used for the reference
  // tenant while the site is being built; turn off once the admin owns content.
  const OVERWRITE = process.env.SEED_OVERWRITE === '1'
  const existingSettings = await db.select().from(settings).limit(1)
  if (existingSettings.length === 0 || OVERWRITE) {
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
    if (existingSettings.length === 0) {
      await db.insert(settings).values(values)
      console.log('[initDb] Created initial settings row.')
    } else {
      await db.update(settings).set({ ...values, updatedAt: new Date() }).where(eq(settings.id, existingSettings[0].id))
      console.log('[initDb] SEED_OVERWRITE: settings row re-applied from content.')
    }
  } else {
    console.log('[initDb] Settings row already exists — skipping settings seed.')
  }

  // ── Service status singleton (the console writes here) ────────────────
  const existingStatus = await db.select().from(serviceStatus).limit(1)
  if (existingStatus.length === 0) {
    await db.insert(serviceStatus).values({ roomStatus: 'quiet' })
    console.log('[initDb] Created service_status row.')
  }

  // ── Menu (content/menu.json → menu_sections + menu_items; Square takes over in Phase 2) ──
  const menuFile = readJson<any>(path.join(CONTENT_DIR, 'menu.json'))
  if (menuFile && Array.isArray(menuFile.sections)) {
    const existingSections = await db.select().from(menuSections).limit(1)
    if (existingSections.length === 0) {
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
      console.log('[initDb] Seeded menu: ' + count + ' items in ' + sIdx + ' sections.')
    } else {
      console.log('[initDb] Menu already seeded — skipping.')
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
    if (existing.length === 0) {
      await db.insert(pages).values({
        slug: p.slug,
        title: p.title,
        sections: p.sections,
        navOrder: p.navOrder,
        isPublished: p.isPublished,
        metaTitle: p.metaTitle || null,
        metaDescription: p.metaDescription || null,
      })
      console.log('[initDb] Created page: ' + p.slug + ' (' + (p.sections?.length || 0) + ' sections)')
    } else if (OVERWRITE) {
      await db.update(pages).set({ title: p.title, sections: p.sections, navOrder: p.navOrder, isPublished: p.isPublished, metaTitle: p.metaTitle || null, metaDescription: p.metaDescription || null, updatedAt: new Date() }).where(eq(pages.slug, p.slug))
      console.log('[initDb] SEED_OVERWRITE: page re-applied: ' + p.slug)
    } else {
      console.log('[initDb] Page already exists: ' + p.slug + ' — skipping.')
    }
  }

  console.log('[initDb] Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error('[initDb] Failed:', err.message || err)
  process.exit(1)
})
