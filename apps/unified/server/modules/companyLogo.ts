// POST /api/company/logo — the owner uploads the business's logo from Settings › Company (live test, 2026-10-22: the
// page offered only a "Logo URL" box, so an owner with a logo FILE had nowhere to put it).
//
// The file is made web-safe here — an SVG or any other image is drawn to a PNG (transparency kept), no wider than
// 800px — stored under the public photo prefix the /media route already serves, and its address written to
// company.logo, the one field the website (site/context.ts logoUrl), the customer portal, the booking page and the
// pay pages already read. Who may: whoever may change the company (owner and admins, as PUT /api/company asks).
import { Hono } from 'hono'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { company } from '../db/schema/index.ts'
import { PUBLIC_PHOTO_PREFIX, type PhotoStore } from '../site/admin.ts'
import { fail, one } from '../http/reply.ts'
import type { AppEnv } from '../http/env.ts'

const MAX_LOGO_BYTES = 5 * 1024 * 1024
const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml'])

export function createCompanyLogoRoute(deps: { db: any; store: PhotoStore; requireAdmin: any }) {
  return new Hono<AppEnv>().post('/logo', deps.requireAdmin, async (c) => {
    const body = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
    const file = (body as Record<string, unknown>).file as File | undefined
    if (!file || typeof (file as any).arrayBuffer !== 'function') return fail(c, 400, 'Choose a logo image to upload.')
    if (file.size > MAX_LOGO_BYTES) return fail(c, 400, 'That logo is too large (5 MB at most).')
    if (file.type && !LOGO_TYPES.has(file.type)) return fail(c, 400, 'Use a PNG, JPG, WebP, GIF or SVG image.')
    let png: Buffer
    try {
      // Drawn, not copied: an SVG served from this origin could carry script; a PNG cannot.
      png = await sharp(Buffer.from(await file.arrayBuffer()), { density: 300 })
        .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer()
    } catch {
      return fail(c, 400, "That file isn't an image we can read.")
    }
    const key = `${PUBLIC_PHOTO_PREFIX}logo-${crypto.randomUUID()}.png`
    await deps.store.put(key, png, 'image/png')
    const logo = `/media/${key}`
    const [row] = await deps.db.update(company).set({ logo, updatedAt: new Date() }).where(eq(company.id, c.get('user').companyId)).returning({ logo: company.logo })
    if (!row) return fail(c, 404, 'Company not found')
    return one(c, { logo: row.logo }, 201)
  })
}
