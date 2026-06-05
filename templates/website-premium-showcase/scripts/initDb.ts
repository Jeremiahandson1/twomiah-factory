/**
 * First-boot seed. Runs after Drizzle pushes the schema. Idempotent —
 * skips any row that already exists, so safe to re-run on every boot.
 *
 * Two modes:
 *
 * 1. FACTORY MODE (preferred — used by Twomiah Factory deploys):
 *    When FACTORY_URL + TENANT_ID + FACTORY_SYNC_KEY are all set, fetch
 *    the bootstrap payload from the factory's
 *    /api/v1/factory/internal/site-bootstrap/<tenantId> endpoint.
 *    The factory returns the customer's composed pages (from
 *    tenants.preview_premium_pages), real brand settings, and an
 *    admin user spec — so the freshly-deployed site lands the customer
 *    on their actual approved content, not a placeholder.
 *
 * 2. LOCAL MODE (fallback — used for `bun run dev` / unit testing):
 *    Read settings + admin from ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD /
 *    COMPANY_NAME and create empty page rows. The site renders the
 *    placeholder home page (see server-static.ts) until content is
 *    edited via the admin.
 */
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users, settings, pages } from '../db/schema'

interface BootstrapPayload {
  settings: {
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
    nav?: Array<{ label: string; href: string }>
  }
  pages: Array<{
    slug: string
    title: string
    sections: any[]
    navOrder: number
    isPublished: boolean
  }>
}

async function tryFetchFromFactory(): Promise<BootstrapPayload | null> {
  const factoryUrl = process.env.FACTORY_URL
  const tenantId = process.env.TENANT_ID
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!factoryUrl || !tenantId || !syncKey) {
    console.log('[initDb] FACTORY_URL/TENANT_ID/FACTORY_SYNC_KEY not all set — falling back to local mode.')
    return null
  }
  try {
    const url = factoryUrl.replace(/\/+$/, '') + '/api/v1/factory/internal/site-bootstrap/' + tenantId
    const res = await fetch(url, {
      headers: { 'X-Factory-Key': syncKey },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      console.warn('[initDb] Factory bootstrap returned HTTP ' + res.status + ' — falling back to local mode.')
      return null
    }
    const payload = await res.json() as BootstrapPayload
    console.log('[initDb] Bootstrap payload fetched from factory — ' + (payload.pages?.length || 0) + ' pages')
    return payload
  } catch (err: any) {
    console.warn('[initDb] Factory bootstrap fetch failed: ' + err.message + ' — falling back to local mode.')
    return null
  }
}

function buildLocalPayload(): BootstrapPayload {
  return {
    settings: {
      companyName: process.env.COMPANY_NAME || 'Your Company',
      contactCtaLabel: 'Start a project',
      nav: [
        { label: 'Services', href: 'services' },
        { label: 'About', href: 'about' },
        { label: 'Contact', href: 'contact' },
      ],
    },
    pages: [
      { slug: 'home',     title: 'Home',     sections: [], navOrder: 0, isPublished: true },
      { slug: 'about',    title: 'About',    sections: [], navOrder: 1, isPublished: true },
      { slug: 'services', title: 'Services', sections: [], navOrder: 2, isPublished: true },
      { slug: 'contact',  title: 'Contact',  sections: [], navOrder: 3, isPublished: true },
    ],
  }
}

async function main() {
  const fromFactory = await tryFetchFromFactory()
  const payload = fromFactory || buildLocalPayload()

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
  const existingSettings = await db.select().from(settings).limit(1)
  if (existingSettings.length === 0) {
    await db.insert(settings).values({
      companyName: payload.settings.companyName,
      tagline: payload.settings.tagline || null,
      phone: payload.settings.phone || null,
      email: payload.settings.email || null,
      address: payload.settings.address || null,
      primaryColor: payload.settings.primaryColor || null,
      secondaryColor: payload.settings.secondaryColor || null,
      accentColor: payload.settings.accentColor || null,
      seoTitle: payload.settings.seoTitle || null,
      seoDescription: payload.settings.seoDescription || null,
      contactCtaLabel: payload.settings.contactCtaLabel || 'Get in touch',
      nav: payload.settings.nav || [],
    })
    console.log('[initDb] Created initial settings row.')
  } else {
    console.log('[initDb] Settings row already exists — skipping settings seed.')
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
      })
      console.log('[initDb] Created page: ' + p.slug + ' (' + (p.sections?.length || 0) + ' sections)')
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
