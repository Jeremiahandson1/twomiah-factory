// crm-homecare — every WRITE route is gated, and a new ungated one fails this file.
//
// homecare has no permission matrix: `authenticate` says who you are, `requireAdmin` (admin OR owner)
// says you run the office, and a caregiver's own actions are scoped in the handler to the caregiver
// in the session. Sixteen route files had writes behind `authenticate` alone — any signed-in
// caregiver could resolve the office's alerts, rewrite the no-show config, delete anyone's absence,
// read and edit prospects, change the AI receptionist and cancel the agency's subscription.
//
// PART 1 — the static walk. Every route file (and index.ts's own handlers) is read as CODE: comments
// out, string/template/regex literals lifted aside, then every registration on every `new Hono()` —
// and on any variable aliased to one — is found with its middleware and its handler. A non-GET route
// passes when it is behind requireAdmin (its own middleware, or an earlier `use` on the same router
// that covers its path), or when it is on ALLOW below with a reason AND what its kind demands is in
// the code (a self-service route must scope to the session; a portal route must sit behind
// portalAuth/familyAuth; a webhook must check its secret or signature). Anything else fails, as
// does any use of a router the walk cannot read (a computed method, the router handed to a
// function). A stale or redundant ALLOW entry fails too, so the list cannot rot.
//
// PART 2 — mutation checks of the walk itself, on planted copies of real files: un-gate a route; add
// one through an alias, a string-keyed method, a path held in a constant, a computed method.
//
// PART 3 — behaviour through the real routes: a caregiver refused on office writes and reads and on
// another caregiver's records, allowed on their own; the office allowed.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { readdirSync, readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, clients } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 600)) }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// The walk
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
type Registration = { file: string; router: string; methods: string[]; path: string; mids: string[]; body: string; midText: string; at: number }
type WalkResult = { regs: Registration[]; unrecognised: string[] }

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head'])
const REGEX_PREV = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'])
const REGEX_PREV_WORDS = /(?:^|[^\w$])(return|typeof|case|in|of|delete|void|throw|new|else|do)$/

/** Comments removed; every string / template / regex literal replaced by `"\u0000N"` → lits[N]. */
function normalise(src: string): { code: string; lits: string[] } {
  const lits: string[] = []
  let out = ''
  let i = 0
  const n = src.length
  const skipQuoted = (start: number): number => {
    const q = src[start]
    let j = start + 1
    while (j < n && src[j] !== q && src[j] !== '\n') { if (src[j] === '\\') j++; j++ }
    return j + 1
  }
  const skipTemplate = (start: number): number => {
    let j = start + 1
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue }
      if (src[j] === '`') return j + 1
      if (src[j] === '$' && src[j + 1] === '{') { j = skipBraces(j + 2); continue }
      j++
    }
    return n
  }
  // From just inside a `${`, past its closing `}` (nested strings, templates and braces honoured).
  const skipBraces = (start: number): number => {
    let j = start, depth = 0
    while (j < n) {
      const ch = src[j]
      if (ch === '/' && src[j + 1] === '/') { const e = src.indexOf('\n', j); j = e < 0 ? n : e; continue }
      if (ch === '/' && src[j + 1] === '*') { const e = src.indexOf('*/', j + 2); j = e < 0 ? n : e + 2; continue }
      if (ch === "'" || ch === '"') { j = skipQuoted(j); continue }
      if (ch === '`') { j = skipTemplate(j); continue }
      if (ch === '{') depth++
      if (ch === '}') { if (depth === 0) return j + 1; depth-- }
      j++
    }
    return n
  }
  const skipRegex = (start: number): number => {
    let j = start + 1, inClass = false
    while (j < n && src[j] !== '\n') {
      const ch = src[j]
      if (ch === '\\') { j += 2; continue }
      if (ch === '[') inClass = true
      else if (ch === ']') inClass = false
      else if (ch === '/' && !inClass) { j++; while (j < n && /[a-z]/i.test(src[j])) j++; return j }
      j++
    }
    return j
  }
  const lit = (text: string) => { lits.push(text); out += `"\u0000${lits.length - 1}"` }
  while (i < n) {
    const ch = src[i]
    if (ch === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue }
    if (ch === "'" || ch === '"') { const e = skipQuoted(i); lit(src.slice(i + 1, e - 1)); i = e; continue }
    if (ch === '`') { const e = skipTemplate(i); lit(src.slice(i + 1, e - 1)); i = e; continue }
    if (ch === '/') {
      const trimmed = out.replace(/\s+$/, '')
      if (REGEX_PREV.has(trimmed.slice(-1)) || REGEX_PREV_WORDS.test(trimmed)) { const e = skipRegex(i); lit(src.slice(i, e)); i = e; continue }
    }
    out += ch
    i++
  }
  return { code: out, lits }
}

/** The top-level arguments of the call whose `(` (or block `{`) is at `open`, and the index past it. */
function args(code: string, open: number): { list: string[]; end: number } {
  let depth = 0, cur = ''
  const list: string[] = []
  for (let i = open; i < code.length; i++) {
    const ch = code[i]
    if (ch === '(' || ch === '[' || ch === '{') { depth++; if (depth === 1) continue }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === 0) { if (cur.trim()) list.push(cur.trim()); return { list, end: i + 1 } }
    }
    if (ch === ',' && depth === 1) { list.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  return { list, end: code.length }
}

function walk(file: string, src: string): WalkResult {
  const { code, lits } = normalise(src.replace(/\r\n/g, '\n'))
  const unrecognised: string[] = []
  const regs: Registration[] = []
  const lineOf = (idx: number) => code.slice(0, idx).split('\n').length
  const resolve = (s: string) => s.replace(/"\u0000(\d+)"/g, (_, k) => JSON.stringify(lits[Number(k)]))

  // Routers: `const X = new Hono(` (exported or not). Aliases: `const Y = X` — to a fixed point.
  const routers = new Set<string>()
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Hono\b/g)) routers.add(m[1])
  for (let grew = true; grew;) {
    grew = false
    for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*(?=;|\n|$)/g)) {
      if (routers.has(m[2]) && !routers.has(m[1])) { routers.add(m[1]); grew = true }
    }
  }

  const constLit = new Map<string, string>()
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*"\u0000(\d+)"/g)) constLit.set(m[1], lits[Number(m[2])])
  const litOf = (a: string): string | null => {
    const t = a.trim()
    const m = t.match(/^"\u0000(\d+)"$/)
    if (m) return lits[Number(m[1])]
    if (/^[A-Za-z_$][\w$]*$/.test(t) && constLit.has(t)) return constLit.get(t)!
    return null
  }

  // Same-file functions, so a handler that delegates (`(c) => clockOut(c, id)`, or a bare
  // `upsertProfile`) is judged on the code it actually runs.
  const fnBody = new Map<string, string>()
  for (const m of code.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const a = args(code, m.index! + m[0].length - 1)
    const brace = code.indexOf('{', a.end)
    if (brace >= 0) fnBody.set(m[1], code.slice(brace, args(code, brace).end))
  }
  for (const m of code.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/g)) {
    const start = m.index! + m[0].length
    fnBody.set(m[1], code[start] === '{' || code[start] === '(' ? code.slice(start, args(code, start).end) + code.slice(args(code, start).end).split('\n')[0] : code.slice(start).split('\n')[0])
  }
  const expand = (text: string, seen = new Set<string>()): string => {
    let all = text
    for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      if (fnBody.has(m[1]) && !seen.has(m[1])) { seen.add(m[1]); all += '\n' + expand(fnBody.get(m[1])!, seen) }
    }
    return all
  }
  const idents = (text: string) => [...text.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*(?=\(|$)/g)].map((m) => m[1])

  for (const r of routers) {
    const re = new RegExp(`(^|[^\\w$.])${r.replace(/\$/g, '\\$')}(?![\\w$])`, 'g')
    for (const m of code.matchAll(re)) {
      const at = m.index! + m[1].length
      const after = code.slice(at + r.length)
      const before = code.slice(0, at)
      if (/\b(?:const|let|var)\s+$/.test(before) && /^\s*=/.test(after)) continue                                  // declaration
      if (/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*$/.test(before) && /^\s*(?:;|\n|$)/.test(after)) continue  // alias
      if (/export\s+default\s+$/.test(before)) continue
      if (/export\s*\{[^}]*$/.test(before)) continue
      if (/^\s*\.\s*fetch\b(?!\s*\()/.test(after)) continue                                                         // Bun.serve({ fetch: app.fetch })
      const where = `${file}:${lineOf(at)} ${resolve(code.slice(at, at + r.length + 50).split('\n')[0])}`
      let method: string | null = null
      let parenAt = -1
      const dot = after.match(/^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/)
      const brk = after.match(/^\s*\[\s*("\u0000\d+")\s*\]\s*\(/)
      if (dot) { method = dot[1]; parenAt = at + r.length + dot[0].length - 1 }
      else if (brk) { method = litOf(brk[1]); parenAt = at + r.length + brk[0].length - 1 }
      if (!method) { unrecognised.push(where); continue }
      const a = args(code, parenAt)
      if (method === 'use') {
        const p = a.list.length > 1 ? litOf(a.list[0]) : null
        const mids = p !== null ? a.list.slice(1) : a.list
        regs.push({ file, router: r, methods: ['USE'], path: p ?? '*', mids: mids.flatMap(idents), body: resolve(expand(mids.join(','))), midText: resolve(mids.join(', ')), at })
        continue
      }
      if (method === 'route') {
        regs.push({ file, router: r, methods: ['ROUTE'], path: litOf(a.list[0] || '') ?? `<dynamic ${resolve(a.list[0] || '')}>`, mids: [], body: resolve(expand(a.list.slice(1).join(','))), midText: '', at })
        continue
      }
      let methods: string[]
      let rest: string[]
      if (method === 'on') {
        const ms = [...(a.list[0] || '').matchAll(/"\u0000(\d+)"/g)].map((x) => lits[Number(x[1])].toUpperCase())
        if (!ms.length) { unrecognised.push(where); continue }
        methods = ms
        rest = a.list.slice(1)
      } else if (VERBS.has(method)) {
        methods = [method.toUpperCase()]
        rest = a.list
      } else {
        if (['onError', 'notFound', 'request'].includes(method)) continue
        unrecognised.push(where); continue
      }
      const path = litOf(rest[0] || '') ?? `<dynamic ${resolve(rest[0] || '')}>`
      const mids = rest.slice(1, -1)
      regs.push({ file, router: r, methods, path, mids: mids.flatMap(idents), body: resolve(expand(rest[rest.length - 1] || '')), midText: resolve(mids.join(', ')), at })
    }
  }
  regs.sort((x, y) => x.at - y.at)
  return { regs, unrecognised }
}

/** Does a `use` path cover a route path? Hono: '*' everything; '/x/*' the subtree. */
const covers = (p: string, q: string) => p === '*' || p === '/*' || (p.endsWith('/*') ? (q === p.slice(0, -2) || q.startsWith(p.slice(0, -1))) : p === q)
const READS = new Set(['GET', 'HEAD', 'OPTIONS'])
const ADMIN = new Set(['requireAdmin', 'authorizeAdmin'])

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ALLOW — every write that is NOT behind requireAdmin, and why. Keyed `file METHOD path` (never a line
// number). Each kind demands something of the code, checked below:
//   self    a caregiver acts for THEMSELVES (or for a client they serve). The handler, or its
//           middleware, must scope to the session: requireAdminOrSelf / selfSubject / ownsRow /
//           isOffice / isOfficeUser / careWriteRefusal / maySeeClient, or the session id itself
//           (user.userId, userIdOf(user)). It must also sit behind authenticate.
//   staff   any signed-in staff member, and no one's record is the subject (asking the help bot,
//           filing a support ticket with Twomiah). Must sit behind authenticate.
//   portal  the client / family portal: its own session — portalAuth / familyAuth must be in front.
//   secret  called by a machine: the Factory (X-Factory-Key), Twilio (signature), Stripe (signature),
//           a lead source (webhook secret). The check must be in the handler or a covering `use`.
//   public  anonymous BY DESIGN — signing in, applying for a job, a new hire's packet link, a public
//           A/B test, a public invoice pay link. Nothing to check; the reason is the decision.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
type Kind = 'self' | 'staff' | 'portal' | 'secret' | 'public'
const ALLOW: Record<string, [Kind, string]> = {
  // ── caregiver self-service ──
  'routes/absences.ts POST /': ['self', 'a caregiver reports their own absence (selfSubject: another caregiverId is a 403); the office records anyone\'s'],
  'routes/blackoutDates.ts POST /': ['self', 'a caregiver adds their own blackout date; the office anyone\'s'],
  'routes/blackoutDates.ts DELETE /:id': ['self', 'a caregiver removes only their own blackout date (ownsRow); the office anyone\'s'],
  'routes/caregiverAvailability.ts PUT /:id': ['self', 'the caregiver dashboard saves its own availability (requireAdminOrSelf)'],
  'routes/caregivers.ts PUT /:id/availability': ['self', 'Caregiver Availability / Schedule Hub (office) and the caregiver\'s own (requireAdminOrSelf)'],
  'routes/caregivers.ts POST /:id/blackout-dates': ['self', 'the office for anyone, a caregiver for themselves (requireAdminOrSelf)'],
  'routes/pto.ts POST /': ['self', 'a caregiver requests their own time off; the office records anyone\'s (selfSubject)'],
  'routes/scheduling.ts POST /time-off': ['self', 'a caregiver files their own request, always pending (selfSubject)'],
  'routes/notificationSettings.ts PUT /': ['self', 'my notification settings — keyed by the session id only'],
  'routes/notifications.ts PATCH /mark-read': ['self', 'my notifications — every statement is bounded by the session id'],
  'routes/notifications.ts POST /bulk-status': ['self', 'my notifications'],
  'routes/notifications.ts PATCH /:id/read': ['self', 'my notifications'],
  'routes/notifications.ts PATCH /:id/status': ['self', 'my notifications'],
  'routes/notifications.ts DELETE /:id': ['self', 'my notifications'],
  'routes/notifications.ts PUT /preferences': ['self', 'my notification preferences'],
  'routes/push.ts POST /mark-read': ['self', 'my notifications'],
  'routes/push.ts POST /subscribe': ['self', 'this device\'s push subscription, for the session user'],
  'routes/push.ts POST /expo-token': ['self', 'this phone\'s push token, for the session user'],
  'routes/push.ts DELETE /expo-token': ['self', 'this phone\'s push token, the session user\'s only'],
  'routes/push.ts POST /unsubscribe': ['self', 'my push subscription'],
  'routes/auth.ts POST /logout': ['self', 'ends my own session'],
  'routes/auth.ts PUT /change-password': ['self', 'my own password'],
  'routes/messages.ts POST /thread/:id/reply': ['self', 'reply as myself in a thread I am part of (mayUseThread)'],
  'routes/messages.ts POST /send': ['self', 'a message sent as myself (CVHC messageRoutes.js: any staff may message)'],
  'routes/mileage.ts POST /': ['self', 'a caregiver logs their own trip at the agency rate; the office anyone\'s'],
  'routes/payrollVerification.ts POST /me/verify': ['self', 'a caregiver confirms or disputes their own pay period'],
  'routes/openShifts.ts POST /:id/claim': ['self', 'a caregiver claims an offered shift for themselves; the office names one'],
  'routes/shiftSwaps.ts POST /': ['self', 'a caregiver asks to swap their own shift'],
  'routes/shiftSwaps.ts PUT /:id/respond': ['self', 'only the caregiver asked answers'],
  'routes/shiftSwaps.ts PUT /:id/cancel': ['self', 'only the caregiver who asked withdraws'],
  'routes/visitChangeRequests.ts POST /reschedule-request': ['self', 'a caregiver asks the office to move their own visit'],
  'routes/visitChangeRequests.ts PUT /:id/resolve': ['self', 'the office resolves; a caregiver answers only a request about their own visit'],
  'routes/emergency.ts POST /miss-report': ['self', 'a caregiver reports they will miss their own shift'],
  'routes/emergency.ts POST /client-unavailable': ['self', 'a caregiver cancels only their own visit (client refused / not home)'],
  'routes/incidents.ts POST /caregiver-report': ['self', 'a caregiver files an incident as themselves, for a client they serve'],
  'routes/documents.ts POST /:id/sign': ['self', 'a caregiver signs a document addressed to them'],
  'routes/timeTracking.ts POST /check-warnings': ['self', 'a read via POST: warnings for my own clock-in'],
  'routes/timeTracking.ts POST /clock-in': ['self', 'I clock in (never refused; an unscheduled punch is flagged)'],
  'routes/timeTracking.ts POST /clock-out': ['self', 'I clock out of my own entry'],
  'routes/timeTracking.ts POST /:id/clock-out': ['self', 'I clock out of my own entry'],
  'routes/timeTracking.ts POST /:id/late-location': ['self', 'the GPS fix for my own punch'],
  'routes/timeTracking.ts POST /gps-failure': ['self', 'my phone could not get GPS'],
  'routes/timeTracking.ts POST /gps': ['self', 'breadcrumbs for my own visit'],
  'routes/timeTracking.ts POST /:id/gps': ['self', 'breadcrumbs for my own visit'],
  'routes/timeTracking.ts POST /:id/photos': ['self', 'a photo on my own visit, for a client I serve'],
  'routes/adl.ts POST /log': ['self', 'an ADL for a client I serve (careWriteRefusal)'],
  'routes/medications.ts POST /log': ['self', 'a MAR dose for a client I serve (careWriteRefusal)'],
  'routes/medications.ts POST /vitals': ['self', 'vitals for a client I serve (careWriteRefusal)'],
  'routes/careTasks.ts PUT /time-entry/:timeEntryId/:taskId': ['self', 'a checklist task on my own visit, for a client I serve'],
  'routes/clients.ts POST /:id/visit-notes': ['self', 'a visit note for a client I serve'],
  'routes/forms.ts POST /submissions': ['self', 'a form for a client I serve'],
  'routes/forms.ts PUT /submissions/:id': ['self', 'my own form submission'],
  'routes/optimizer.ts POST /geofence/check': ['self', 'a read via POST: am I inside this client\'s fence — only for a client I serve (maySeeClient)'],
  // ── any signed-in staff, no subject record ──
  'routes/help.ts POST /ai-chat': ['staff', 'ask the help assistant; reads the knowledge base, writes nothing of the agency\'s'],
  'routes/platformSupport.ts POST /tickets': ['staff', 'a support ticket to Twomiah from the signed-in person'],
  // ── portal sessions ──
  'routes/portal.ts PUT /preferences': ['portal', 'the client\'s own portal preferences'],
  'routes/portal.ts POST /invoices/:invoiceId/pay': ['portal', 'the client pays their own invoice'],
  'routes/portal.ts POST /messages': ['portal', 'the client messages the office'],
  'routes/portal.ts POST /messages/:threadId': ['portal', 'the client replies in their own thread'],
  'routes/portal.ts POST /messages/:threadId/read': ['portal', 'the client\'s own thread'],
  'routes/portal.ts POST /notifications/:id/read': ['portal', 'the client\'s own notification'],
  'routes/portal.ts PUT /notifications/:id/read': ['portal', 'the client\'s own notification'],
  'routes/portal.ts POST /notifications/read-all': ['portal', 'the client\'s own notifications'],
  'routes/portal.ts PUT /notifications/read-all': ['portal', 'the client\'s own notifications'],
  'routes/portal.ts POST /documents/:id/sign': ['portal', 'the client signs a document sent to them'],
  'routes/portal.ts POST /documents/:id/decline': ['portal', 'the client declines a document sent to them'],
  'routes/portalVisits.ts PUT /visits/note': ['portal', 'the client\'s note on their own visit'],
  'routes/portalVisits.ts POST /visits/cancel-request': ['portal', 'the client asks to cancel their own visit'],
  'routes/portalVisits.ts POST /visits/reschedule-request': ['portal', 'the client asks to move their own visit'],
  'routes/portalVisits.ts PUT /change-requests/:id/respond': ['portal', 'the client answers a change about their own visit'],
  'routes/familyPortal.ts POST /portal/messages': ['portal', 'a family member messages the office (familyAuth)'],
  // ── machines, with a secret or a signature ──
  'routes/ivr.ts POST /voice': ['secret', 'Twilio IVR — validateTwilioSignature on the router'],
  'routes/ivr.ts POST /verify-pin': ['secret', 'Twilio IVR — validateTwilioSignature'],
  'routes/ivr.ts POST /clock-in': ['secret', 'Twilio IVR — validateTwilioSignature'],
  'routes/ivr.ts POST /clock-out': ['secret', 'Twilio IVR — validateTwilioSignature'],
  'routes/stripe.ts POST /webhook': ['secret', 'Stripe — constructEvent verifies the signature'],
  'routes/saasBilling.ts POST /webhook': ['secret', 'Stripe — constructEvent verifies the signature'],
  'routes/webhooks.ts POST /leads': ['secret', 'website contact form — verifyWebhook (x-webhook-secret / X-Factory-Key)'],
  'routes/leads.ts POST /inbound/webhook/:source': ['secret', 'a lead source\'s webhook — matched by its x-webhook-secret'],
  'routes/gbp.ts ROUTE /': ['secret', 'gbpInternal: the Factory drops Google tokens, X-Factory-Key on the router (the admin half is requireAdmin)'],
  'routes/inboundParse.ts ROUTE /': ['secret', 'inbound email from the Factory — X-Factory-Key on the router'],
  'index.ts POST /api/internal/sync-features': ['secret', 'the Factory syncs features — X-Factory-Key'],
  'index.ts POST /api/internal/seed-from-premium': ['secret', 'the Factory seeds content — X-Factory-Key'],
  'index.ts POST /api/internal/send-sms': ['secret', 'the Factory sends a text — X-Factory-Key'],
  // ── anonymous by design ──
  'routes/auth.ts POST /login': ['public', 'signing in'],
  'routes/auth.ts POST /refresh': ['public', 'refreshing a session — the refresh token is the credential'],
  'routes/portal.ts POST /login': ['public', 'client portal sign-in'],
  'routes/portal.ts POST /exchange': ['public', 'client portal invite / magic-link exchange — the token is the credential'],
  'routes/portal.ts POST /set-password': ['public', 'client portal password set — the reset token is the credential'],
  'routes/portal.ts POST /forgot-password': ['public', 'client portal password reset request (rate-limited in index.ts)'],
  'routes/familyPortal.ts POST /login': ['public', 'family portal sign-in (rate-limited in index.ts)'],
  'routes/careersPublic.ts POST /apply': ['public', 'a job applicant applies (rate-limited in index.ts)'],
  'routes/onboardingPacketsPublic.ts PUT /:token': ['public', 'a new hire saves their packet — the token in the URL is the credential'],
  'routes/onboardingPacketsPublic.ts POST /:token/submit': ['public', 'a new hire submits their packet — the token is the credential'],
  'routes/adsPublic.ts POST /assign': ['public', 'a website visitor gets a sticky A/B variant'],
  'routes/adsPublic.ts POST /convert': ['public', 'a website visitor converted'],
  'routes/stripe.ts POST /invoice/:invoiceId/pay': ['public', 'the emailed pay-this-invoice link starts a Stripe checkout'],
  'routes/saasBilling.ts POST /self-hosted/purchase': ['public', 'buying a self-hosted licence starts a Stripe checkout'],
  'index.ts ALL /api/*': ['public', 'the JSON 404 for an unknown /api route'],
  // UNSIGNED provider webhooks — public today, and they accept any caller. Not an authorisation gate
  // a role could close: they need the provider's signature check. Reported, not silently passed.
  'routes/aiReceptionist.ts POST /webhook/recording/:agencyId': ['public', 'Twilio recording callback — UNSIGNED, needs validateTwilioSignature'],
  'routes/aiReceptionist.ts POST /webhook/status/:agencyId': ['public', 'Twilio status callback — UNSIGNED, needs validateTwilioSignature'],
  'routes/calltracking.ts POST /webhook/callrail/:agencyId': ['public', 'CallRail webhook — UNSIGNED, needs CallRail signature'],
  'routes/calltracking.ts POST /webhook/twilio/:agencyId': ['public', 'Twilio call webhook — UNSIGNED, needs validateTwilioSignature'],
  'routes/calltracking.ts POST /webhook/:provider/:agencyId': ['public', 'generic call-tracking webhook — UNSIGNED'],
  'routes/leads.ts POST /inbound/email': ['public', 'forwarded lead email, matched by the To address — UNSIGNED'],
}

const SELF_MARK = /\b(requireAdminOrSelf|selfSubject|ownsRow|isOffice|isOfficeUser|careWriteRefusal|maySeeClient|requireClientAccess|mayUseThread|caregiverClientRule)\b|\b(?:user|currentUser|viewer)\??\.(?:userId|id)\b|\buserIdOf\(|\buserId\(c\)/
const PORTAL_MARK = /\b(portalAuth|familyAuth)\b/
const SECRET_MARK = /X-Factory-Key|verifyWebhook|validateTwilioSignature|x-webhook-secret|constructEvent/i

type Verdict = { key: string; ok: boolean; why: string }
function judge(files: Record<string, string>): { verdicts: Verdict[]; unrecognised: string[]; writes: number; admin: number; stale: string[]; redundant: string[] } {
  const verdicts: Verdict[] = []
  const unrecognised: string[] = []
  const seen = new Map<string, boolean[]>() // ALLOW key → was each match admin-gated?
  let writes = 0, admin = 0
  for (const [file, src] of Object.entries(files)) {
    const w = walk(file, src)
    unrecognised.push(...w.unrecognised)
    for (const [i, r] of w.regs.entries()) {
      if (r.methods[0] === 'USE') continue
      // index.ts's app.route(...) lines mount the route files, which are walked themselves.
      if (file === 'index.ts' && r.methods[0] === 'ROUTE') continue
      if (r.methods.every((m) => READS.has(m))) continue
      writes++
      const uses = w.regs.slice(0, i).filter((u) => u.methods[0] === 'USE' && u.router === r.router && covers(u.path, r.path))
      const isAdmin = r.mids.some((m) => ADMIN.has(m)) || uses.some((u) => u.mids.some((m) => ADMIN.has(m)))
      const key = `${file} ${r.methods.join('|')} ${r.path}`
      const entry = ALLOW[key]
      if (entry) seen.set(key, [...(seen.get(key) || []), isAdmin])
      if (isAdmin) { admin++; continue }
      if (!entry) { verdicts.push({ key, ok: false, why: 'ungated: not behind requireAdmin and not on ALLOW' }); continue }
      const [kind] = entry
      const authed = r.mids.includes('authenticate') || uses.some((u) => u.mids.includes('authenticate'))
      const text = r.midText + '\n' + r.body
      const useText = uses.map((u) => u.body).join('\n')
      let ok = true, why = kind
      if (kind === 'self') { ok = authed && SELF_MARK.test(text); why = authed ? 'self-service but nothing scopes it to the session' : 'self-service but not behind authenticate' }
      if (kind === 'staff') { ok = authed; why = 'staff route not behind authenticate' }
      if (kind === 'portal') { ok = PORTAL_MARK.test(r.midText + '\n' + useText); why = 'portal route without portalAuth / familyAuth in front' }
      if (kind === 'secret') { ok = SECRET_MARK.test(text + '\n' + useText); why = 'machine route with no secret / signature check' }
      verdicts.push({ key, ok, why: ok ? kind : why })
    }
  }
  const stale = Object.keys(ALLOW).filter((k) => !seen.has(k))
  const redundant = [...seen.entries()].filter(([, v]) => v.every(Boolean)).map(([k]) => k)
  return { verdicts, unrecognised, writes, admin, stale, redundant }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PART 1 — the real tree
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const ROOT = (process.env.FACTORY_ROOT || '') + 'templates/crm-homecare/backend/src/'
const realFiles: Record<string, string> = { 'index.ts': readFileSync(ROOT + 'index.ts', 'utf8') }
for (const f of readdirSync(ROOT + 'routes').filter((x) => x.endsWith('.ts')).sort()) realFiles[`routes/${f}`] = readFileSync(ROOT + 'routes/' + f, 'utf8')

{
  const j = judge(realFiles)
  const bad = j.verdicts.filter((v) => !v.ok)
  check(`walk: ${Object.keys(realFiles).length} files, ${j.writes} write routes (${j.admin} behind requireAdmin, ${j.verdicts.length} on ALLOW)`, j.writes > 400 && j.admin > 300, { writes: j.writes, admin: j.admin })
  check('every write route is behind requireAdmin or a recognised, reasoned exemption', bad.length === 0, bad)
  check('every registration on a router is one the walk can read', j.unrecognised.length === 0, j.unrecognised)
  check('ALLOW has no stale entry (each names a real write route)', j.stale.length === 0, j.stale)
  check('ALLOW has no redundant entry (none names a route that is already requireAdmin)', j.redundant.length === 0, j.redundant)
  // The walk must be reading files, not passing them for being unreadable: spot-check that known
  // admin writes ARE found as admin, and known exemptions are found where they are.
  const regsOf = (f: string) => walk(f, realFiles[f]).regs
  check('the walk finds expenses.ts POST / behind the router-level requireAdmin', (() => { const r = regsOf('routes/expenses.ts'); const i = r.findIndex((x) => x.methods[0] === 'POST' && x.path === '/'); return i > 0 && r.slice(0, i).some((u) => u.methods[0] === 'USE' && u.mids.includes('requireAdmin')) })())
  check('the walk finds leads.ts past its /^http:\\/\\// regex (POST /sources still has requireAdmin)', regsOf('routes/leads.ts').some((x) => x.methods[0] === 'POST' && x.path === '/sources' && x.mids.includes('requireAdmin')))
  check('the walk reads a delegated handler (timeTracking clockOut) for its session check', regsOf('routes/timeTracking.ts').some((x) => x.path === '/:id/clock-out' && /userIdOf\(/.test(x.body)))
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PART 2 — mutation checks of the walk: each plant must make it fail, on a copy of a real file
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const failsWith = (file: string, mutate: (s: string) => string): string[] => {
    const src = realFiles[file]
    const planted = mutate(src)
    if (planted === src) return ['(the mutation did not apply)']
    const j = judge({ ...realFiles, [file]: planted })
    return [...j.verdicts.filter((v) => !v.ok).map((v) => v.key), ...j.unrecognised.map((u) => 'unrecognised ' + u)]
  }
  const ROUTE_LINE = '\nexport default app'
  const m1 = failsWith('routes/expenses.ts', (s) => s.replace("app.use('*', authenticate, requireAdmin)", "app.use('*', authenticate)"))
  check('mutation: un-gating expenses.ts (requireAdmin off its router use) fails the walk', m1.includes('routes/expenses.ts POST /') && m1.includes('routes/expenses.ts DELETE /:id'), m1)
  const m2 = failsWith('routes/careTypes.ts', (s) => s.replace("app.delete('/:id', requireAdmin, async", "app.delete('/:id', async"))
  check('mutation: un-gating one route (careTypes DELETE /:id) fails the walk', m2.length === 1 && m2[0] === 'routes/careTypes.ts DELETE /:id', m2)
  const m3 = failsWith('routes/absences.ts', (s) => s.replace(ROUTE_LINE, `\nconst r2 = app\nr2.post('/planted', async (c) => c.json({ ok: true }))${ROUTE_LINE}`))
  check('mutation: a route registered through an alias (const r2 = app) is seen and fails', m3.includes('routes/absences.ts POST /planted'), m3)
  const m4 = failsWith('routes/absences.ts', (s) => s.replace(ROUTE_LINE, `\napp['delete']('/planted', async (c) => c.json({ ok: true }))${ROUTE_LINE}`))
  check('mutation: a string-keyed method (app[\'delete\']) is seen and fails', m4.includes('routes/absences.ts DELETE /planted'), m4)
  const m5 = failsWith('routes/absences.ts', (s) => s.replace(ROUTE_LINE, `\nconst PLANT = '/planted'\napp.put(PLANT, async (c) => c.json({ ok: true }))${ROUTE_LINE}`))
  check('mutation: a path held in a constant is seen and fails', m5.includes('routes/absences.ts PUT /planted'), m5)
  const m6 = failsWith('routes/absences.ts', (s) => s.replace(ROUTE_LINE, `\nconst verb = 'post' as const\napp[verb]('/planted', async (c) => c.json({ ok: true }))${ROUTE_LINE}`))
  check('mutation: a computed method (app[verb]) is reported as unrecognised', m6.some((x) => x.startsWith('unrecognised routes/absences.ts')), m6)
  const m7 = failsWith('routes/absences.ts', (s) => s.replace(ROUTE_LINE, `\nregisterExtras(app)${ROUTE_LINE}`))
  check('mutation: the router handed to a function is reported as unrecognised', m7.some((x) => x.startsWith('unrecognised routes/absences.ts')), m7)
  const m8 = failsWith('routes/absences.ts', (s) => s.replace(ROUTE_LINE, `\napp.on(['POST', 'PUT'], '/planted', async (c) => c.json({ ok: true }))${ROUTE_LINE}`))
  check('mutation: app.on([...]) is seen and fails', m8.includes('routes/absences.ts POST|PUT /planted'), m8)
  const m9 = failsWith('routes/blackoutDates.ts', (s) => s.replace("const who = selfSubject(c, body.caregiverId)\n    if ('refusal' in who) return who.refusal", 'const who = { id: body.caregiverId }').replace(/const who = selfSubject\(c, body\.caregiverId\)\r?\n\s*if \('refusal' in who\) return who\.refusal/, 'const who = { id: body.caregiverId }'))
  check('mutation: a self-service route that stops scoping to the session fails', m9.includes('routes/blackoutDates.ts POST /'), m9)
  const m10 = failsWith('routes/ivr.ts', (s) => s.replace("app.use('*', validateTwilioSignature)", '').replace(/app\.use\('\*', validateTwilioSignature\)/, ''))
  check('mutation: the IVR without its Twilio signature check fails', m10.includes('routes/ivr.ts POST /voice'), m10)
  const m11 = failsWith('routes/absences.ts', (s) => s.replace(ROUTE_LINE, `\n// app.post('/commented', async (c) => c.json({}))\nconst s = 'app.post(\\'/in-a-string\\', h)'${ROUTE_LINE}`))
  check('mutation control: a route in a comment or a string is NOT a route', m11.length === 0, m11)
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PART 3 — behaviour
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'write-gates-secret'
delete process.env.STRIPE_SECRET_KEY
await setupSchema()
const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }

const [ag] = await db.insert(agencies).values({ name: 'Gates Care', slug: 'gates', state: 'WI', timezone: 'UTC' } as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}-gates@test.local`, passwordHash: 'x', firstName: tag, lastName: 'Tester', role,
} as any).returning())[0]
const admin = await mkUser('admin', 'admin'), owner = await mkUser('owner', 'owner')
const cg1 = await mkUser('caregiver', 'cgone'), cg2 = await mkUser('caregiver', 'cgtwo')
const [served] = await db.insert(clients).values({ firstName: 'Served', lastName: 'Client', latitude: '44.8', longitude: '-91.5' } as any).returning()
const [other] = await db.insert(clients).values({ firstName: 'Other', lastName: 'Client', latitude: '44.9', longitude: '-91.4' } as any).returning()
await q(sql`INSERT INTO client_assignments (id, client_id, caregiver_id, assignment_date, status) VALUES ('ca_wg', ${served.id}, ${cg1.id}, '2026-01-01', 'active')`)

const app = new Hono()
for (const [mount, file] of [
  ['/api/absences', 'absences'], ['/api/blackout-dates', 'blackoutDates'], ['/api/caregiver-availability', 'caregiverAvailability'],
  ['/api/caregivers', 'caregivers'], ['/api/caregiver-profile', 'caregiverProfile'], ['/api/expenses', 'expenses'],
  ['/api/alerts', 'alerts'], ['/api/prospects', 'prospects'], ['/api/prospect-appointments', 'prospectAppointments'],
  ['/api/care-types', 'careTypes'], ['/api/no-show', 'noShow'], ['/api/communication-log', 'communicationLog'],
  ['/api/communication', 'communication'], ['/api/ai-receptionist', 'aiReceptionist'], ['/api/ads', 'ads'],
  ['/api/calltracking', 'calltracking'], ['/api/subscription', 'saasBilling'], ['/api/help', 'help'], ['/api/pto', 'pto'],
  ['/api/scheduling', 'schedulingHub'], ['/api/scheduling', 'scheduling'], ['/api/caregiver-rates', 'caregiverRates'],
  ['/api/caregiver-care-type-rates', 'caregiverCareTypeRates'], ['/api/certifications', 'certifications'],
  ['/api/route-optimizer', 'optimizer'], ['/api/notification-settings', 'notificationSettings'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}
const call = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': ag.id, 'x-test-role': who.role, 'x-test-email': who.email },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text()
  let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const A = call(admin), O = call(owner), C1 = call(cg1), C2 = call(cg2)
const TODAY = new Date().toISOString().slice(0, 10)

// ── office writes and reads: a caregiver is refused, the office is not ──
{
  const officeOnly: [string, string, unknown?][] = [
    ['POST', '/api/expenses', { description: 'Gloves', amount: '12.50', date: TODAY }],
    ['GET', '/api/expenses'],
    ['POST', '/api/alerts', { alertType: 'general', message: 'm' }],
    ['GET', '/api/alerts'],
    ['POST', '/api/prospects', { firstName: 'Pat', lastName: 'Prospect' }],
    ['GET', '/api/prospects'],
    ['GET', '/api/prospect-appointments'],
    ['POST', '/api/care-types', { name: 'Respite' }],
    ['PUT', '/api/no-show/config', { graceMinutes: 30 }],
    ['GET', '/api/no-show/alerts'],
    ['POST', '/api/communication-log', { entityType: 'client', entityId: served.id, logType: 'call', body: 'x' }],
    ['GET', `/api/communication-log/client/${served.id}`],
    ['POST', '/api/communication/log', { entityType: 'client', entityId: served.id, body: 'x' }],
    ['PUT', '/api/ai-receptionist/settings', { enabled: true }],
    ['GET', '/api/ai-receptionist/rules'],
    ['POST', '/api/ads/experiments', { name: 'x' }],
    ['PUT', '/api/calltracking/numbers/n1', { label: 'x' }],
    ['GET', '/api/calltracking/calls'],
    ['POST', '/api/subscription/subscription/cancel', { immediate: true }],
    ['GET', '/api/subscription/invoices'],
    ['POST', '/api/help/kb', { title: 't', content: 'c' }],
    ['GET', '/api/absences'],
    ['POST', '/api/scheduling/check-conflicts', { caregiverId: cg2.id, date: TODAY, startTime: '09:00', endTime: '10:00' }],
    ['PUT', `/api/caregiver-profile/${cg1.id}`, { notes: 'I am great' }],
  ]
  for (const [m, p, b] of officeOnly) {
    const r = await C1(m, p, b)
    check(`caregiver refused: ${m} ${p}`, r.status === 403, { status: r.status, json: r.json })
  }
  // The office gets through the gate AND gets an answer (a 2xx, or a 4xx about the input) — a 500 is
  // not "allowed". (This is what found the help KB, AI receptionist and call log reading
  // user.agencyId, which no homecare token carries — every one of them 500'd for the office.)
  for (const [m, p, b] of officeOnly) {
    const r = await A(m, p, b)
    check(`office allowed: ${m} ${p}`, r.status !== 403 && r.status !== 401 && r.status < 500, { status: r.status, json: r.json })
  }
  const ai = await A('PUT', '/api/ai-receptionist/settings', { enabled: true })
  check('the AI receptionist settings save for the office (agency = the token\'s companyId)', ai.status === 200, ai.json)
  const calls = await A('GET', '/api/calltracking/calls')
  check('the call log loads for the office (it 500\'d: "syntax error at or near ORDER")', calls.status === 200, calls.json)
  const exp = await A('POST', '/api/expenses', { description: 'Mileage log book', amount: '4.00', date: TODAY })
  check('the office records an expense (201)', exp.status === 201 && exp.json.description === 'Mileage log book', exp.json)
  const ct = await O('POST', '/api/care-types', { name: 'Overnight' })
  check('the OWNER adds a care type (requireAdmin is admin OR owner)', ct.status === 201, ct.json)
  const kb = await O('POST', '/api/help/kb', { title: 'How to clock in', content: '…' })
  check('the OWNER adds a help article (the inline check read role !== admin and refused them; the insert had no id or agency)', kb.status === 201 && kb.json.title === 'How to clock in' && kb.json.agency_id === ag.id && !!kb.json.id, { status: kb.status, json: kb.json })
  const kbRead = await C1('GET', `/api/help/kb/${kb.json?.id}`)
  check('…and a caregiver reads it', kbRead.status === 200 && kbRead.json.title === 'How to clock in', kbRead.json)
  check('…but cannot edit it', (await C1('PUT', `/api/help/kb/${kb.json?.id}`, { title: 'x', content: 'y' })).status === 403)
  const kbEdit = await O('PUT', `/api/help/kb/${kb.json?.id}`, { title: 'Clocking in', content: 'Tap Clock In.' })
  check('…the owner edits it', kbEdit.status === 200 && kbEdit.json.title === 'Clocking in', kbEdit.json)
  check('…an article with no title is a 400, not a 500', (await O('POST', '/api/help/kb', {})).status === 400)
  const [al] = await q(sql`INSERT INTO alerts (id, alert_type, priority, message, status) VALUES ('al_wg', 'general', 'high', 'Call the family', 'active') RETURNING id`)
  check('a caregiver cannot resolve the office\'s alert', (await C1('PUT', `/api/alerts/${al.id}/resolve`, {})).status === 403)
  check('…and cannot dismiss it', (await C1('PUT', `/api/alerts/${al.id}/dismiss`, {})).status === 403)
  const res = await A('PUT', `/api/alerts/${al.id}/resolve`, { resolution: 'Called' })
  check('the office resolves it', res.status === 200 && res.json.status === 'resolved', res.json)
}

// ── absences: report my own; the list and deletes are the office's ──
{
  const forOther = await C1('POST', '/api/absences', { caregiverId: cg2.id, date: TODAY, type: 'call_out', reason: 'not me' })
  check('absence: a caregiver cannot report one for another caregiver (403)', forOther.status === 403, forOther)
  const mine = await C1('POST', '/api/absences', { caregiverId: cg1.id, date: TODAY, type: 'call_out', reason: 'sick', coverageAssignedTo: cg2.id })
  check('absence: a caregiver reports their own (201, theirs, reported by them)', mine.status === 201 && mine.json.caregiverId === cg1.id && mine.json.reportedById === cg1.id, mine.json)
  check('absence: a caregiver cannot assign their own coverage', mine.json?.coverageAssignedTo == null, mine.json)
  const implicit = await C1('POST', '/api/absences', { date: TODAY, type: 'late' })
  check('absence: with no caregiverId it is the caller\'s', implicit.status === 201 && implicit.json.caregiverId === cg1.id, implicit.json)
  const missing = await C1('POST', '/api/absences', { caregiverId: cg1.id })
  check('absence: date and type are required (400, not a 500)', missing.status === 400, missing)
  const office = await A('POST', '/api/absences', { caregiverId: cg2.id, date: TODAY, type: 'no_show', coverageAssignedTo: cg1.id })
  check('absence: the office records one for anyone, with coverage', office.status === 201 && office.json.caregiverId === cg2.id && office.json.coverageAssignedTo === cg1.id, office.json)
  const my = await C2('GET', '/api/absences/my')
  check('absence: GET /my lists only my own', my.status === 200 && my.json.length === 1 && my.json.every((r: any) => r.caregiverId === cg2.id), my.json)
  check('absence: a caregiver cannot delete (even their own — CVHC: requireAdmin)', (await C1('DELETE', `/api/absences/${mine.json.id}`)).status === 403)
  check('absence: the office deletes', (await A('DELETE', `/api/absences/${office.json.id}`)).status === 200)
}

// ── blackout dates: mine only; the office anyone's ──
{
  const forOther = await C1('POST', '/api/blackout-dates', { caregiverId: cg2.id, startDate: '2026-12-24', endDate: '2026-12-26' })
  check('blackout: a caregiver cannot add one for another caregiver (403)', forOther.status === 403, forOther)
  const mine = await C1('POST', '/api/blackout-dates', { startDate: '2026-12-24', endDate: '2026-12-26', reason: 'Holiday' })
  check('blackout: a caregiver adds their own', mine.status === 201 && mine.json.caregiverId === cg1.id && mine.json.type === 'blackout', mine.json)
  const theirs = await A('POST', '/api/blackout-dates', { caregiverId: cg2.id, startDate: '2026-11-01', endDate: '2026-11-02' })
  check('blackout: the office adds one for a caregiver', theirs.status === 201 && theirs.json.caregiverId === cg2.id, theirs.json)
  const del = await C1('DELETE', `/api/blackout-dates/${theirs.json.id}`)
  const still = await q(sql`SELECT id FROM caregiver_time_off WHERE id = ${theirs.json.id}`)
  check('blackout: a caregiver cannot delete another caregiver\'s (403, row kept)', del.status === 403 && still.length === 1, del)
  const list = await C1('GET', '/api/blackout-dates')
  check('blackout: a caregiver lists only their own', list.status === 200 && list.json.length === 1 && list.json[0].caregiverId === cg1.id, list.json)
  check('blackout: the office lists everyone\'s', (await A('GET', '/api/blackout-dates')).json.length === 2)
  check('blackout: a caregiver deletes their own', (await C1('DELETE', `/api/blackout-dates/${mine.json.id}`)).status === 200)
  check('blackout: the office deletes anyone\'s', (await A('DELETE', `/api/blackout-dates/${theirs.json.id}`)).status === 200)
}

// ── availability: /api/caregiver-availability/:id and /api/caregivers/:id/availability ──
{
  const other = await C1('PUT', `/api/caregiver-availability/${cg2.id}`, { status: 'unavailable' })
  check('availability: a caregiver cannot save another caregiver\'s (403)', other.status === 403, other)
  const mine = await C1('PUT', `/api/caregiver-availability/${cg1.id}`, { status: 'available', maxHoursPerWeek: 32, notes: 'mornings', caregiverId: cg2.id })
  check('availability: a caregiver saves their own — a caregiverId in the body cannot move the row', (mine.status === 200 || mine.status === 201) && mine.json.caregiverId === cg1.id, mine.json)
  check('availability: a caregiver cannot read another caregiver\'s', (await C1('GET', `/api/caregiver-availability/${cg2.id}`)).status === 403)
  check('availability: a caregiver reads their own', (await C1('GET', `/api/caregiver-availability/${cg1.id}`)).status === 200)
  const g = await C2('GET', `/api/caregivers/${cg2.id}/availability`)
  check('/api/caregivers/:id/availability (the screens\' path) exists and makes the default week', g.status === 200 && g.json.monday_available === true && g.json.saturday_available === false && g.json.max_hours_per_week === 40, g.json)
  check('/api/caregivers/:id/availability: another caregiver\'s is a 403', (await C1('GET', `/api/caregivers/${cg2.id}/availability`)).status === 403)
  check('/api/caregivers/:id/availability: a caregiver cannot save another\'s', (await C1('PUT', `/api/caregivers/${cg2.id}/availability`, { maxHoursPerWeek: 10 })).status === 403)
  const put = await A('PUT', `/api/caregivers/${cg2.id}/availability`, { maxHoursPerWeek: '30', saturdayAvailable: true, saturdayStartTime: '09:00', saturdayEndTime: '13:00' })
  check('/api/caregivers/:id/availability: the office saves (typed string accepted)', put.status === 200 && put.json.max_hours_per_week === 30 && put.json.saturday_available === true && String(put.json.saturday_start_time).startsWith('09:00'), put.json)
  check('/api/caregivers/:id/availability: max hours over 168 is a 400', (await A('PUT', `/api/caregivers/${cg2.id}/availability`, { maxHoursPerWeek: 200 })).status === 400)
  const bo = await C1('POST', `/api/caregivers/${cg1.id}/blackout-dates`, { startDate: '2026-07-03', endDate: '2026-07-05', reason: 'Lake' })
  check('/api/caregivers/:id/blackout-dates: a caregiver adds their own', bo.status === 201 && bo.json.start_date === '2026-07-03', bo.json)
  check('/api/caregivers/:id/blackout-dates: …not another\'s', (await C1('POST', `/api/caregivers/${cg2.id}/blackout-dates`, { startDate: '2026-07-03', endDate: '2026-07-05' })).status === 403)
  const bl = await A('GET', `/api/caregivers/${cg1.id}/blackout-dates`)
  check('/api/caregivers/:id/blackout-dates: the office reads them, snake_case as the screens read', bl.status === 200 && bl.json.length === 1 && bl.json[0].end_date === '2026-07-05' && bl.json[0].reason === 'Lake', bl.json)
}

// ── profile and pay reads: my own only ──
{
  check('profile: a caregiver cannot read another caregiver\'s profile', (await C1('GET', `/api/caregiver-profile/${cg2.id}`)).status === 403)
  check('profile: a caregiver reads their own', (await C1('GET', `/api/caregiver-profile/${cg1.id}`)).status === 200)
  const w = await A('PATCH', `/api/caregiver-profile/${cg1.id}`, { notes: 'Strong with dementia clients' })
  check('profile: the office writes it', (w.status === 200 || w.status === 201) && w.json.notes === 'Strong with dementia clients', w.json)
  await q(sql`INSERT INTO caregiver_rates (id, caregiver_id, rate_type, hourly_rate, effective_date) VALUES ('cr1', ${cg1.id}, 'base', 17.50, '2026-01-01'), ('cr2', ${cg2.id}, 'base', 19.00, '2026-01-01')`)
  check('pay: a caregiver cannot read another caregiver\'s rates', (await C1('GET', `/api/caregiver-rates/${cg2.id}`)).status === 403)
  check('pay: …or their rate history', (await C1('GET', `/api/caregiver-rates/${cg2.id}/history`)).status === 403)
  check('pay: a caregiver reads their own', (await C1('GET', `/api/caregiver-rates/${cg1.id}`)).status === 200)
  check('pay: the office reads anyone\'s', (await A('GET', `/api/caregiver-rates/${cg2.id}`)).status === 200)
  const [ctype] = await q(sql`INSERT INTO care_types (id, name, is_active) VALUES ('ct_wg', 'Companion', true) RETURNING id`)
  await q(sql`INSERT INTO caregiver_care_type_rates (id, caregiver_id, care_type_id, hourly_rate) VALUES ('cctr1', ${cg1.id}, ${ctype.id}, 18), ('cctr2', ${cg2.id}, ${ctype.id}, 21)`)
  const all = await C1('GET', '/api/caregiver-care-type-rates')
  check('pay per care type: a caregiver\'s unfiltered list is only their own', all.status === 200 && all.json.length === 1 && all.json[0].caregiverId === cg1.id, all.json)
  check('pay per care type: ?caregiverId= someone else is a 403', (await C1('GET', `/api/caregiver-care-type-rates?caregiverId=${cg2.id}`)).status === 403)
  check('pay per care type: the office sees all', (await A('GET', '/api/caregiver-care-type-rates')).json.length === 2)
  await q(sql`INSERT INTO certification_records (id, caregiver_id, certification_type, status) VALUES ('cert1', ${cg2.id}, 'CPR', 'active')`)
  check('certifications: ?caregiverId= another caregiver is a 403', (await C1('GET', `/api/certifications?caregiverId=${cg2.id}`)).status === 403)
  check('certifications: /caregiver/:id another caregiver is a 403', (await C1('GET', `/api/certifications/caregiver/${cg2.id}`)).status === 403)
  const mineC = await C1('GET', '/api/certifications')
  check('certifications: a caregiver\'s unfiltered list is only their own', mineC.status === 200 && mineC.json.every((r: any) => r.caregiverId === cg1.id), mineC.json)
}

// ── time off: pto and scheduling/time-off ──
{
  const other = await C1('POST', '/api/pto', { caregiverId: cg2.id, type: 'vacation', startDate: '2026-08-01', endDate: '2026-08-03' })
  check('pto: a caregiver cannot request time off for another caregiver (403)', other.status === 403, other)
  const mine = await C1('POST', '/api/pto', { type: 'pto', startDate: '2026-08-01', endDate: '2026-08-03', reason: 'Wedding' })
  check('pto: a caregiver requests their own — pending', mine.status === 201 && mine.json.caregiverId === cg1.id && mine.json.status === 'pending', mine.json)
  check('pto: dates are required (400)', (await C1('POST', '/api/pto', { type: 'pto' })).status === 400)
  const theirs = await C2('GET', '/api/pto')
  check('pto: another caregiver does not see it', theirs.status === 200 && !theirs.json.some((r: any) => r.id === mine.json.id), theirs.json)
  check('pto: a caregiver cannot approve (403)', (await C1('POST', `/api/pto/${mine.json.id}/approve`)).status === 403)
  const ok = await A('POST', `/api/pto/${mine.json.id}/approve`)
  check('pto: the office approves (PTO & Time Off\'s ✓, which had no route)', ok.status === 200 && ok.json.status === 'approved' && ok.json.approvedById === admin.id, ok.json)
  const no = await A('POST', `/api/pto/${(await A('POST', '/api/pto', { caregiverId: cg2.id, type: 'sick', startDate: '2026-09-01', endDate: '2026-09-01' })).json.id}/deny`)
  check('pto: the office denies', no.status === 200 && no.json.status === 'denied', no.json)

  const self = await C1('POST', '/api/scheduling/time-off', { type: 'vacation', startDate: '2026-10-01', endDate: '2026-10-02', status: 'approved', approvedById: cg1.id })
  check('time-off: a caregiver cannot approve their own request through the body', self.status === 201 && self.json.status === 'pending' && self.json.approvedById == null && self.json.caregiverId === cg1.id, self.json)
  check('time-off: a caregiver cannot file for another caregiver (403)', (await C1('POST', '/api/scheduling/time-off', { caregiverId: cg2.id, type: 'vacation', startDate: '2026-10-01', endDate: '2026-10-02' })).status === 403)
  check('time-off: a caregiver cannot list another caregiver\'s (403)', (await C1('GET', `/api/scheduling/time-off?caregiverId=${cg2.id}`)).status === 403)
  const list = await C1('GET', '/api/scheduling/time-off')
  check('time-off: a caregiver\'s list is only their own', list.status === 200 && list.json.length > 0 && list.json.every((r: any) => r.caregiverId === cg1.id), list.json)
  check('time-off: the office lists everyone\'s', (await A('GET', '/api/scheduling/time-off')).json.some((r: any) => r.caregiverId === cg2.id))
}

// ── the geofence check and my own settings ──
{
  const no = await C1('POST', '/api/route-optimizer/geofence/check', { clientId: other.id, latitude: 44.9, longitude: -91.4 })
  check('geofence: a caregiver cannot probe a client they do not serve (403)', no.status === 403, no)
  const yes = await C1('POST', '/api/route-optimizer/geofence/check', { clientId: served.id, latitude: 44.8001, longitude: -91.5001 })
  check('geofence: a caregiver checks a client they serve', yes.status === 200 && yes.json.withinGeofence === true, yes.json)
  const ns = await C1('PUT', '/api/notification-settings', { smsEnabled: false })
  check('notification settings: a caregiver saves their own', ns.status === 200 && ns.json.userId === cg1.id && ns.json.smsEnabled === false, ns.json)
}

// The front end's time-off page now posts a time-off REQUEST, not an absence with no date.
{
  const fe = readFileSync((process.env.FACTORY_ROOT || '') + 'templates/crm-homecare/frontend/src/components/CaregiverDashboard.tsx', 'utf8')
  const fn = fe.slice(fe.indexOf('const handleRequestTimeOff'), fe.indexOf('const handlePageClick'))
  check('CaregiverDashboard: Request Time Off posts to /api/pto (it posted a dateless absence and failed)', fn.includes('fetch(`${API_BASE_URL}/api/pto`') && !fn.includes('fetch(`${API_BASE_URL}/api/absences'), fn.slice(0, 300))
}

console.log(`\nhomecare-write-gates: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
