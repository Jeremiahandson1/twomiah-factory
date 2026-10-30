// The demo's backend: what the real server would answer, answered here. A request is one of
//   - the sign-in's own (the visitor is signed in already; signing out goes back to the demo list),
//   - a read, answered from the recorded data (store.ts),
//   - a change the demo supports — add, edit, delete, a status move — made on the in-memory rows,
//   - something that would reach the outside world (an email, a text, a card, a connection): the demo says it was not sent
//     and does nothing else,
//   - anything else: "not available in the demo", a clean answer every screen already knows how to show.
// The shapes are the real server's four (server/http/reply.ts): a record as it is, { data, pagination }, { success }, { error, code }.
import type { DemoStore, Row } from './store'

export interface DemoRequest { method: string; url: URL; body: unknown }
export interface DemoReply { status: number; body: unknown }

export const NOT_SENT = 'In the demo this is not sent.'
export const NOT_AVAILABLE = 'This is not available in the demo.'

const reply = (status: number, body: unknown): DemoReply => ({ status, body })
export const unavailable = (write: boolean): DemoReply => reply(write ? 501 : 404, { error: NOT_AVAILABLE, code: 'DEMO_UNAVAILABLE' })

/** What would reach outside this page: an email or text, a card, a domain, an invite, a connected service. */
const OUTBOUND: Array<[RegExp, RegExp]> = [
  [/^(POST|PUT|PATCH)$/, /^\/api\/(messages|sms|texts?|email|emails|mail|notify|notifications|campaigns|marketing)\b.*\/(send|test|blast|broadcast)\b/],
  [/^(POST|PUT|PATCH)$/, /\/(send-email|send-sms|send-text|send-reminder|send-invite|send-link|resend|remind|reminder|request-review|review-request|invite|share|text-link)$/],
  [/^POST$/, /^\/api\/(reviews|google-reviews|gbp)\/(request|send)/],
  [/^(POST|PUT|PATCH|DELETE)$/, /^\/api\/(stripe|billing|payments\/card|payment-intents?|checkout|domain|domains|email-domain|integrations|quickbooks|qbo|gusto|twilio|texting|sms-billing|connect|oauth|webhooks?|zapier|jobber|angi|thumbtack|callrail|ai-receptionist|ads|vision|visualizer)\b/],
  [/^POST$/, /^\/api\/company\/users$/],
  [/^POST$/, /^\/api\/auth\/(forgot-password|reset-password)$/],
  [/^POST$/, /^\/api\/(team|clients|caregivers|contacts)\/[^/]+\/(invite|portal-invite|send-invite)$/],
]

const isOutbound = (method: string, path: string) => OUTBOUND.some(([m, p]) => m.test(method) && p.test(path))

/** The status a quote or invoice or job moves to by an action, as the real server sets it (tests/demo-writes.test.ts holds each to the server). */
export const ACTION_STATUS: Record<string, Record<string, string>> = {
  '/api/quotes': { send: 'sent', approve: 'approved', reject: 'rejected' },
  '/api/invoices': { send: 'sent' },
  '/api/jobs': { dispatch: 'dispatched', start: 'in_progress', complete: 'completed' },
  '/api/bids': { submit: 'submitted', won: 'won', lost: 'lost' },
}

const AUTH_PUBLIC = /^\/api\/auth\//

export function handle(store: DemoStore, req: DemoRequest, onSignOut: () => void): DemoReply {
  const method = req.method.toUpperCase()
  const path = req.url.pathname.replace(/\/+$/, '')
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Row

  // ── the session ────────────────────────────────────────────────────────────────────────────────────────────
  if (AUTH_PUBLIC.test(path) || path === '/api/live/ticket') {
    const me = store.read('/api/auth/me', new URLSearchParams())
    if (method === 'GET' && path === '/api/auth/me') return me ? reply(me.status, me.body) : unavailable(false)
    if (method === 'POST' && path === '/api/auth/login') return reply(200, { ...(me?.body as Row), accessToken: 'demo', refreshToken: 'demo' })
    if (method === 'POST' && path === '/api/auth/refresh') return reply(200, { accessToken: 'demo', refreshToken: 'demo' })
    // "View as" (a second person's eyes) is not part of the demo: nobody is being viewed as anyone.
    if (method === 'GET' && path === '/api/auth/impersonate') return reply(200, { active: false })
    if (method === 'POST' && path === '/api/auth/logout') { onSignOut(); return reply(200, { success: true }) }
    if (method === 'POST' && path === '/api/live/ticket') return reply(200, { ticket: 'demo', path: '/api/live-socket' })
    if (isOutbound(method, path)) { store.notify(NOT_SENT); return reply(200, { success: true, message: NOT_SENT }) }
    if (method === 'GET') { const r = store.read(path, req.url.searchParams); if (r) return reply(r.status, r.body) }
    return unavailable(method !== 'GET')
  }

  // The website editor's live preview holds the editor's state for a frame to draw; with no server there is no frame to draw it.
  if (method === 'POST' && /^\/api\/site\/preview\//.test(path)) return reply(200, { success: true })

  // ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────
  if (method === 'GET' || method === 'HEAD') {
    const r = store.read(path, req.url.searchParams)
    return r ? reply(r.status, r.body) : unavailable(false)
  }

  // A POST the screens use to READ (a payroll or report calculation): the recorded answer.
  if (method === 'POST') { const r = store.readPost(path); if (r) return reply(r.status, r.body) }

  // ── what would reach the outside ───────────────────────────────────────────────────────────────────────────
  const cut = path.lastIndexOf('/')
  const parentPath = path.slice(0, cut)
  const last = path.slice(cut + 1)
  // Marking a quote or an invoice sent moves it along in the demo's rows; the email itself is never made.
  if (method === 'POST' && /^(send)$/.test(last)) {
    const base = parentPath.slice(0, parentPath.lastIndexOf('/'))
    const id = parentPath.slice(parentPath.lastIndexOf('/') + 1)
    const status = ACTION_STATUS[base]?.send
    if (status && store.row(base, id)) store.update(base, id, { status, sentAt: new Date().toISOString() })
    store.notify(NOT_SENT)
    return reply(200, { success: true, message: NOT_SENT })
  }
  if (isOutbound(method, path)) { store.notify(NOT_SENT); return reply(200, { success: true, message: NOT_SENT }) }

  // ── changes the demo supports ──────────────────────────────────────────────────────────────────────────────
  if (method === 'POST' && store.has(path)) return reply(201, store.create(path, body))
  if ((method === 'PUT' || method === 'PATCH') && store.has(parentPath)) {
    const row = store.update(parentPath, last, body)
    return row ? reply(200, row) : unavailable(true)
  }
  if (method === 'DELETE' && store.has(parentPath)) return store.remove(parentPath, last) ? reply(200, { success: true }) : unavailable(true)

  // An action on a row: POST /api/<collection>/<id>/<action>.
  if (method === 'POST') {
    const base = parentPath.slice(0, parentPath.lastIndexOf('/'))
    const id = parentPath.slice(parentPath.lastIndexOf('/') + 1)
    if (store.has(base) && store.row(base, id)) {
      const status = ACTION_STATUS[base]?.[last]
      if (status) return reply(200, store.update(base, id, { status })!)
    }
  }
  return unavailable(true)
}
