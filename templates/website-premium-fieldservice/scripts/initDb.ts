/**
 * First-boot seed. Run once after Drizzle migrations create the tables.
 * Safe to re-run — every insert is idempotent (skipped if a row already
 * exists for that natural key).
 *
 * Reads:
 *   ADMIN_EMAIL              required on first run
 *   ADMIN_INITIAL_PASSWORD   required on first run; admin must change after first login
 *   COMPANY_NAME             optional, defaults to "Your Company"
 *
 * Usage:
 *   bun run scripts/initDb.ts
 */
import bcrypt from 'bcryptjs'
import { db } from '../db'
import { users, settings, pages } from '../db/schema'

async function main() {
  // ── Admin user ─────────────────────────────────────────────────────────
  const existingUsers = await db.select().from(users).limit(1)
  if (existingUsers.length === 0) {
    const email = process.env.ADMIN_EMAIL
    const password = process.env.ADMIN_INITIAL_PASSWORD
    if (!email || !password) {
      console.error('[initDb] ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD must be set on first run.')
      process.exit(1)
    }
    const passwordHash = await bcrypt.hash(password, 10)
    await db.insert(users).values({ email: email.toLowerCase(), passwordHash, role: 'admin' })
    console.log('[initDb] Created initial admin user:', email)
  } else {
    console.log('[initDb] Users table already populated — skipping admin seed.')
  }

  // ── Settings ───────────────────────────────────────────────────────────
  const existingSettings = await db.select().from(settings).limit(1)
  if (existingSettings.length === 0) {
    await db.insert(settings).values({
      companyName: process.env.COMPANY_NAME || 'Your Company',
      contactCtaLabel: 'Start a project',
      nav: [
        { label: 'Services', href: 'services' },
        { label: 'About', href: 'about' },
        { label: 'Contact', href: 'contact' },
      ],
    })
    console.log('[initDb] Created initial settings row.')
  } else {
    console.log('[initDb] Settings row already exists — skipping settings seed.')
  }

  // ── Default pages ──────────────────────────────────────────────────────
  // Empty section arrays — the AI composer fills these in when staff
  // triggers a preview build. Pages exist so the public site doesn't
  // 404 before the first composition lands.
  const DEFAULT_PAGES: Array<{ slug: string; title: string; navOrder: number; isPublished: boolean }> = [
    { slug: 'home',     title: 'Home',     navOrder: 0, isPublished: true },
    { slug: 'about',    title: 'About',    navOrder: 1, isPublished: true },
    { slug: 'services', title: 'Services', navOrder: 2, isPublished: true },
    { slug: 'contact',  title: 'Contact',  navOrder: 3, isPublished: true },
  ]
  for (const p of DEFAULT_PAGES) {
    const existing = await db.select().from(pages).where(/* eslint-disable-line */ (await import('drizzle-orm')).eq(pages.slug, p.slug)).limit(1)
    if (existing.length === 0) {
      await db.insert(pages).values({ ...p, sections: [] })
      console.log('[initDb] Created default page:', p.slug)
    }
  }

  console.log('[initDb] Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error('[initDb] Failed:', err.message || err)
  process.exit(1)
})
