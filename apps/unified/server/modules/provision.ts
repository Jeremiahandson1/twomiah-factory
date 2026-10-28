// The Factory's first call to a new tenant: the business, its owner, its features and its starting website, written
// into the empty database in one transaction (SPEC §0 decision 4, RULEBOOK §9). The CRM templates baked these into
// the tenant's code as text (db/seed.template.ts, the owner's password hash included) and ran the seed on every boot;
// here nothing about the business is in the code, and the database is written once.
//
// Safe to repeat: the Factory retries a call it lost the answer to, so the same business again changes nothing and
// says so. A different business is refused — this database already belongs to someone.
import { Hono } from 'hono'
import { asc } from 'drizzle-orm'
import { z } from 'zod'
import { withoutNotReady, withinOffer } from '@twomiah/tenant-backend'
import { company, user, supportKnowledgeBase, pricebookCategory, website, page, canvassingScript, bookingSettings, bookingService } from '../db/schema/index.ts'
import { startingMenuService } from '../crm/salon/onlineBooking.ts'
import type { VerticalSettings } from '../core/vertical.ts'
import { BASE_STARTER, starterArticleRows, starterCategories } from '../core/starter.ts'
import { SITE_DESIGNS } from '../core/vertical.ts'
import { fail, one, done } from '../http/reply.ts'
import { invalid } from '../http/errors.ts'

const text = (max: number) => z.string().trim().min(1).max(max)
const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a colour like #1a2b3c')

const sectionSchema = z.object({ type: text(80), variant: z.string().max(80).optional(), data: z.record(z.string(), z.unknown()).default({}) }).passthrough()

export const provisionSchema = z.object({
  company: z.object({
    name: text(200),
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lower-case letters, digits and single dashes').max(63),
    email: z.string().email().max(254).nullish(),
    phone: optional(40),
    address: optional(300),
    city: optional(120),
    state: optional(80),
    zip: optional(20),
    logo: z.string().url().max(2000).nullish(),
    primaryColor: colour.optional(),
    secondaryColor: colour.nullish(),
    website: z.string().url().max(2000).nullish(),
    timezone: optional(64),
  }),
  owner: z.object({
    email: z.string().email().max(254).transform((e) => e.toLowerCase()),
    // The Factory hashes; the password itself never reaches the tenant. The shared sign-in checks bcrypt.
    passwordHash: z.string().regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, 'a bcrypt hash'),
    firstName: text(100),
    lastName: z.string().trim().max(100).default(''),
    phone: optional(40),
  }),
  features: z.array(z.string().regex(/^[a-z0-9_]+$/).max(80)).max(500),
  /** The Factory's industry name ("Roofing", "General Contractor"…): picks the price book's starting categories. */
  industry: optional(120),
  /** The signup's "We take bookings": the business starts with something a customer can book (startingBookings). */
  takesBookings: z.boolean().optional(),
  site: z.object({
    tagline: optional(300),
    seoTitle: optional(300),
    seoDescription: optional(1000),
    nav: z.array(z.object({ label: text(100), href: text(500) })).max(50).optional(),
    serviceAreas: z.array(z.unknown()).max(200).optional(),
    photoCredits: z.array(z.unknown()).max(500).optional(),
    contentGaps: z.array(z.unknown()).max(200).optional(),
    contactCtaLabel: optional(80),
    accentColor: colour.nullish(),
    faviconUrl: z.string().url().max(2000).nullish(),
    design: z.enum(SITE_DESIGNS).nullish(),
    pages: z.array(z.object({
      slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(100),
      title: text(200),
      sections: z.array(sectionSchema).max(100),
      metaTitle: optional(300),
      metaDescription: optional(1000),
      isPublished: z.boolean().default(true),
      navOrder: z.number().int().min(0).max(10_000).default(0),
    })).max(100).refine((ps) => new Set(ps.map((p) => p.slug)).size === ps.length, 'each page needs its own slug'),
  }).optional(),
})
export type ProvisionInput = z.infer<typeof provisionSchema>
export type StartingSite = NonNullable<ProvisionInput['site']>

/**
 * A business's starting website: its site settings and pages. A new business gets it at provisioning; a business that
 * moves in from the templates with a NEW site gets it after its records are copied (server/move/siteSource.ts) — the
 * same rows, written the same way.
 */
export async function writeStartingSite(tx: any, companyId: string, site: StartingSite): Promise<number> {
  const { pages, ...s } = site
  await tx.insert(website).values({
    companyId, tagline: s.tagline, seoTitle: s.seoTitle, seoDescription: s.seoDescription,
    nav: s.nav ?? [], serviceAreas: s.serviceAreas ?? [], photoCredits: s.photoCredits ?? [], contentGaps: s.contentGaps ?? [],
    ...(s.contactCtaLabel ? { contactCtaLabel: s.contactCtaLabel } : {}),
    accentColor: s.accentColor ?? null, faviconUrl: s.faviconUrl ?? null, design: s.design ?? null,
  })
  if (pages.length) await tx.insert(page).values(pages.map((p) => ({ ...p, companyId })))
  return pages.length
}

/**
 * A business that said "We take bookings" at signup starts bookable: the booking settings on its own clock and one
 * 30-minute Consultation. Live test 2026-10-22: the answer never reached the app, so a new business had no service and
 * every day closed, and its /book page said "Bookings opening soon" until the owner found three settings screens.
 *
 * No hours are written: bookings follow the business's opening hours, and weekdays 9–5 until it has any (booking/
 * engine.ts weekOf). Seeded Mon–Fri rows were the owner's in nobody's eyes and outvoted the opening hours they set
 * later (salon live test, 2026-10-25). A salon's Consultation is a Service Menu item offered online (its menu is the
 * one list /book offers — crm/salon/onlineBooking.ts), not a booking-only service the menu never shows.
 */
export async function startingBookings(tx: any, companyId: string, vertical: VerticalSettings) {
  // Its clock is the company's (booking/engine.ts settingsOf), given at provisioning — the row keeps no zone of its own.
  await tx.insert(bookingSettings).values({ companyId }).onConflictDoNothing()
  if (vertical.booking?.calendar === 'chair') await startingMenuService(tx, companyId)
  else await tx.insert(bookingService).values({ companyId, slug: 'consultation', name: 'Consultation', durationMinutes: 30, slotStepMinutes: 30 }).onConflictDoNothing()
}

export function createProvisionRoute(deps: { db: any; vertical: VerticalSettings; forgetFeatures: () => void }) {
  const { db, vertical } = deps
  const starter = vertical.starter ?? BASE_STARTER

  return new Hono().post('/', async (c) => {
    const parsed = provisionSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const input = parsed.data
    // A not-ready feature is switched on by no path, a first setup included (withoutNotReady); nor is one this industry is
    // not offered (withinOffer, the rule every writer of the list applies).
    input.features = withinOffer(vertical.featureSet, withoutNotReady(input.features))

    const result = await db.transaction(async (tx: any) => {
      // One business per tenant database (SPEC §2); the oldest company row is it.
      const [existing] = await tx.select({ id: company.id, slug: company.slug }).from(company).orderBy(asc(company.createdAt)).limit(1)
      if (existing) return { existing }

      const co = input.company
      const [created] = await tx.insert(company).values({
        name: co.name, slug: co.slug, email: co.email ?? null, phone: co.phone, address: co.address, city: co.city,
        state: co.state, zip: co.zip, logo: co.logo ?? null, website: co.website ?? null, timezone: co.timezone,
        ...(co.primaryColor ? { primaryColor: co.primaryColor } : {}), secondaryColor: co.secondaryColor ?? null,
        enabledFeatures: input.features,
        // instant_estimator switches the estimator on, as the seed did.
        estimatorEnabled: input.features.includes('instant_estimator'),
        // The vertical's own starting values (roofing: free roof reports, the estimator's headline).
        ...(starter.company ?? {}),
      }).returning({ id: company.id })

      const o = input.owner
      const [owner] = await tx.insert(user).values({
        companyId: created.id, email: o.email, passwordHash: o.passwordHash, firstName: o.firstName, lastName: o.lastName,
        phone: o.phone, role: 'owner',
      }).returning({ id: user.id })

      const articles = starterArticleRows(starter, created.id)
      if (articles.length) await tx.insert(supportKnowledgeBase).values(articles)
      const categories = starterCategories(starter, input.industry)
      if (categories.length) {
        await tx.insert(pricebookCategory).values(categories.map((name, i) => ({ name, sortOrder: i, companyId: created.id })))
      }
      const scripts = starter.canvassingScripts ?? []
      if (scripts.length) {
        await tx.insert(canvassingScript).values(scripts.map((sc) => ({ ...sc, companyId: created.id })))
      }

      if (input.site) await writeStartingSite(tx, created.id, input.site)
      if (input.takesBookings) await startingBookings(tx, created.id, vertical)
      return { created: { companyId: created.id, ownerId: owner.id } }
    })

    if (result.existing) {
      if (result.existing.slug === input.company.slug) return done(c, 'Already provisioned; nothing was changed')
      return fail(c, 409, `This database already holds another business (${result.existing.slug}); nothing was changed`, 'provisioned_for_another')
    }
    deps.forgetFeatures()
    return one(c, result.created, 201)
  })
}
