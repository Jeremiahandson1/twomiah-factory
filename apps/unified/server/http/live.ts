// Live updates: every change a module announces (core/realtime.ts emitToCompany / emitToUser) delivered to the screens
// of the people it is for, over a WebSocket on the tenant's own server (Hono's Bun adapter — the CRMs used socket.io,
// whose Node server does not attach to Bun.serve).
//
// Signing in is the API's own, unchanged: a signed-in screen asks POST /api/live/ticket (the registry's `user` door —
// bearer token or session cookie, account lock, ended sessions, inactive user) for a one-time ticket good for 30
// seconds, then opens GET /api/live-socket?ticket=… with it (its own path, so the `user` door's sign-in does not sit in
// front of it; the ticket is the sign-in). A ticket in an address is harmless: it is used once and is gone. A socket
// lives at most as long as an access token (15 minutes) and is then closed (4001), so a person signed out, switched off
// or whose password changed stops receiving within that time; the screen asks a new ticket and reconnects.
//
// Each message: { event, data } as JSON — the event names are realtime.ts EVENTS.
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { upgradeWebSocket, websocket } from 'hono/bun'
import type { WSContext } from 'hono/ws'
import type { Realtime } from '../core/realtime.ts'
import { fail, one } from './reply.ts'

const TICKET_MS = 30_000
const SOCKET_MS = 15 * 60_000
export const LIVE_SOCKET_PATH = '/api/live-socket'

interface Holder { userId: string; companyId: string; ws: WSContext; timer: ReturnType<typeof setTimeout> }

export function createLive(deps: { realtime: Realtime; now?: () => number }) {
  const now = deps.now ?? Date.now
  const tickets = new Map<string, { userId: string; companyId: string; expires: number }>()
  const open = new Set<Holder>()

  const sweep = () => { const t = now(); for (const [k, v] of tickets) if (v.expires <= t) tickets.delete(k) }

  /** POST /ticket — mounted behind the registry's sign-in. */
  const ticketRoutes = new Hono().post('/ticket', (c) => {
    const user = c.get('user' as never) as { userId: string; companyId: string } | undefined
    if (!user?.userId || !user.companyId) return fail(c, 401, 'Not signed in')
    sweep()
    const ticket = crypto.randomBytes(32).toString('base64url')
    tickets.set(ticket, { userId: user.userId, companyId: user.companyId, expires: now() + TICKET_MS })
    return one(c, { ticket, path: LIVE_SOCKET_PATH, expiresInSeconds: TICKET_MS / 1000 })
  })

  /** GET / — mounted public at LIVE_SOCKET_PATH: the ticket is taken once, then the connection is upgraded. */
  const socketRoutes = new Hono().get('/', async (c, next) => {
    const ticket = c.req.query('ticket') || ''
    const held = tickets.get(ticket)
    tickets.delete(ticket)
    if (!held || held.expires <= now()) return fail(c, 401, 'A live-updates ticket is needed (POST /api/live/ticket)', 'live_ticket')
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return fail(c, 426, 'Expected a WebSocket upgrade')
    let holder: Holder | null = null
    return upgradeWebSocket(() => ({
      onOpen: (_e, ws) => {
        holder = { userId: held.userId, companyId: held.companyId, ws, timer: setTimeout(() => ws.close(4001, 'Session time is up — ask a new ticket'), SOCKET_MS) }
        open.add(holder)
      },
      onClose: () => { if (holder) { clearTimeout(holder.timer); open.delete(holder) } },
    }))(c, next)
  })

  // Every announced change, to the sockets it is for: the company's, or one person's in it.
  deps.realtime.listen((companyId, event, data, userId) => {
    const message = JSON.stringify({ event, data })
    for (const h of open) {
      if (h.companyId !== companyId) continue
      if (userId && h.userId !== userId) continue
      h.ws.send(message)
    }
  })

  return { ticketRoutes, socketRoutes, websocket, open }
}

export type Live = ReturnType<typeof createLive>
