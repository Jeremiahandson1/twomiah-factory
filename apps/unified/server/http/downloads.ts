// One-time download links: for a screen that cannot send the sign-in with the request that fetches a file — the phone
// app opens a quote's or an invoice's PDF in the phone's browser, which has no session.
//
// POST /api/downloads { path } (the registry's `user` door) answers { url } for one file the server lets out this way:
// a quote's or an invoice's PDF, nothing else (DOWNLOADABLE). GET /api/download/:token takes the token once, within 60
// seconds, and fetches that path from this app AS THE PERSON WHO ASKED: their own sign-in's claims, re-signed for a
// minute with the ORIGINAL issue time — so the route's permission check, the account lock, an ended session (password
// changed since), home care's sign-out revocation and View As's read-only all apply at download exactly as they would
// have to the original request. The token in the address is random, single-use and short-lived; no sign-in leaves the
// server.
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { Hono } from 'hono'
import { requestToken } from '@twomiah/tenant-backend'
import { fail, one } from './reply.ts'

const LINK_MS = 60_000
/** The only paths a link may fetch. */
const DOWNLOADABLE = [/^\/api\/quotes\/[A-Za-z0-9_-]+\/pdf$/, /^\/api\/invoices\/[A-Za-z0-9_-]+\/pdf$/]
export const DOWNLOAD_PATH = '/api/download'

interface Held { path: string; claims: Record<string, unknown>; expires: number }

export function createDownloadLinks(deps: { fetchApp: (req: Request) => Response | Promise<Response>; now?: () => number }) {
  const now = deps.now ?? Date.now
  const links = new Map<string, Held>()
  const sweep = () => { const t = now(); for (const [k, v] of links) if (v.expires <= t) links.delete(k) }

  /** POST / — mounted at /api/downloads behind the registry's sign-in. */
  const linkRoutes = new Hono().post('/', async (c) => {
    const { path } = await c.req.json().catch(() => ({} as any))
    if (typeof path !== 'string' || !DOWNLOADABLE.some((r) => r.test(path))) return fail(c, 400, 'Only a quote\'s or an invoice\'s PDF can be downloaded by link')
    const presented = requestToken(c)
    const decoded = presented && 'token' in presented ? jwt.decode(presented.token) : null
    if (!decoded || typeof decoded !== 'object' || !(decoded as any).userId) return fail(c, 401, 'Not signed in')
    const { exp: _exp, nbf: _nbf, ...claims } = decoded as Record<string, unknown>
    sweep()
    const token = crypto.randomBytes(32).toString('base64url')
    links.set(token, { path, claims, expires: now() + LINK_MS })
    return one(c, { url: `${DOWNLOAD_PATH}/${token}`, expiresInSeconds: LINK_MS / 1000 }, 201)
  })

  /** GET /:token — mounted public at DOWNLOAD_PATH: the token is the sign-in, used once. */
  const downloadRoutes = new Hono().get('/:token', async (c) => {
    const held = links.get(c.req.param('token'))
    links.delete(c.req.param('token'))
    if (!held || held.expires <= now()) return fail(c, 404, 'This download link has expired — ask for the file again', 'link_expired')
    const bearer = jwt.sign({ ...held.claims, exp: Math.floor(now() / 1000) + 60 }, process.env.JWT_SECRET!)
    const origin = new URL(c.req.url).origin
    return deps.fetchApp(new Request(origin + held.path, { headers: { Authorization: `Bearer ${bearer}` } }))
  })

  return { linkRoutes, downloadRoutes }
}
