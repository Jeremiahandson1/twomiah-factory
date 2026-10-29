// Sized, modern copies of every photo the site shows (the speed round, 2026-10-29: uploaded JPEGs and PNGs were served as
// uploaded, and the stock hero came cross-origin from the Factory).
//
//   /img/<width>/media/<key…>          a photo the business uploaded (its stored key, as /media/<key> serves it)
//   /img/<width>/stock/<group>/<file>  a library stock photo (the Factory's /hero-library), now from the site's own address
//
// Always WebP (every browser that runs the site reads it, so the address alone says what comes back: no content
// negotiation, no Vary), at a few fixed widths (so the set of copies is small and cacheable), never larger than the
// original. WHEN: on the first request, then stored beside the original under `variants/` and served from there — an
// upload pipeline would leave every photo already on the sites (Higgs, 547, Amber, Perch) at its old size, and a copy is
// only made for a width a visitor's screen actually asked for. The stored copy and the response are immutable (an
// uploaded key is never reused; a stock file never changes), so browsers and the CDN keep them for a year.
// AVIF: measured against WebP on the same photos and left out — see the speed round's report.
import type { Hono } from 'hono'
import sharp from 'sharp'
import type { PhotoStore } from './admin.ts'
import { PUBLIC_PHOTO_PREFIX } from './admin.ts'

export const WIDTHS = [480, 960, 1280, 1920] as const
export const VARIANT_PREFIX = 'variants/'
const KINDS = /\.(jpe?g|png|webp|avif)$/i
const STOCK = /^[a-z0-9_-]+\/[a-z0-9_.-]+\.(jpe?g|png|webp)$/i

/** The origins a stock photo may be fetched from: the Factory's own (the library lives in its API). */
function stockOrigins(): string[] {
  const origins = new Set(['https://twomiah-factory-api.onrender.com'])
  for (const v of [process.env.TWOMIAH_FACTORY_URL, process.env.FACTORY_PUBLIC_URL]) {
    try { if (v) origins.add(new URL(v).origin) } catch { /* not a URL */ }
  }
  return [...origins]
}

/** The address of a photo's copy at `width`, or null when the photo is not one we can resize (an SVG, another site's). */
export function variantUrl(src: string | null | undefined, width: number): string | null {
  if (!src || typeof src !== 'string') return null
  const w = WIDTHS.reduce((best, x) => (Math.abs(x - width) < Math.abs(best - width) ? x : best), WIDTHS[0])
  const m = /^\/media\/(.+)$/.exec(src)
  if (m && KINDS.test(m[1])) return `/img/${w}/media/${m[1]}`
  const s = /^(https?:\/\/[^/]+)\/hero-library\/([a-z0-9_-]+\/[a-z0-9_.-]+)$/i.exec(src.split(/[?#]/)[0])
  if (s && stockOrigins().includes(s[1].toLowerCase()) && STOCK.test(s[2])) return `/img/${w}/stock/${s[2]}`
  return null
}

/** `srcset` text for a photo (widths in `WIDTHS`), or '' when it has no copies. */
export function srcsetOf(src: string | null | undefined, widths: readonly number[] = WIDTHS): string {
  return widths.map((w) => { const u = variantUrl(src, w); return u ? `${u} ${w}w` : '' }).filter(Boolean).join(', ')
}

const inflight = new Map<string, Promise<Buffer | null>>()

async function originalOf(store: PhotoStore, kind: string, rest: string): Promise<Buffer | null> {
  if (kind === 'media') {
    if (!rest.startsWith(PUBLIC_PHOTO_PREFIX) || rest.includes('..')) return null
    const obj = await store.getObject(rest)
    if (!obj || !/^image\/(jpeg|png|webp|avif)$/.test(obj.contentType)) return null
    return Buffer.from(obj.body as any)
  }
  if (kind === 'stock' && STOCK.test(rest)) {
    for (const origin of stockOrigins()) {
      try {
        const r = await fetch(`${origin}/hero-library/${rest}`, { signal: AbortSignal.timeout(8000) })
        if (r.ok && /^image\//.test(r.headers.get('content-type') || '')) return Buffer.from(await r.arrayBuffer())
      } catch { /* try the next host */ }
    }
  }
  return null
}

export async function makeVariant(store: PhotoStore, width: number, kind: string, rest: string): Promise<Buffer | null> {
  const key = `${VARIANT_PREFIX}${width}/${kind}/${rest}.webp`
  const have = await store.getObject(key)
  if (have) return Buffer.from(have.body as any)
  const pending = inflight.get(key)
  if (pending) return pending
  const job = (async () => {
    const original = await originalOf(store, kind, rest)
    if (!original) return null
    try {
      const out = await sharp(original).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer()
      await store.put(key, out, 'image/webp').catch(() => {})
      return out
    } catch { return null }
  })().finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

export function addVariantRoutes(app: Hono<any>, store: PhotoStore) {
  app.get('/img/:w/:kind/*', async (c) => {
    const w = Number(c.req.param('w'))
    const kind = c.req.param('kind')
    if (!(WIDTHS as readonly number[]).includes(w) || (kind !== 'media' && kind !== 'stock')) return c.notFound()
    const rest = decodeURIComponent(c.req.path.replace(new RegExp(`^/img/${w}/${kind}/`), ''))
    const body = await makeVariant(store, w, kind, rest)
    if (!body) {
      // Not something we can resize (gone, or a format we leave alone): the original answers, so a page never shows a hole.
      // Only a key that passed the same checks as the copy does (the site's own photo prefix, no "..", no control characters).
      const safe = kind === 'media' && rest.startsWith(PUBLIC_PHOTO_PREFIX) && !rest.includes('..') && !/[\u0000-\u001f\u007f\\]/.test(rest)
      return safe ? c.redirect('/media/' + rest.split('/').map(encodeURIComponent).join('/'), 302) : c.notFound()
    }
    return c.body(body as any, 200, { 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' })
  })
}
