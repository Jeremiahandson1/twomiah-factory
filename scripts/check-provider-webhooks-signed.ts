/**
 * GUARD: every provider webhook in every CRM proves who sent it before it writes anything.
 *
 * Until 10/15 the call-tracking and AI-receptionist webhooks in nine CRMs —
 *   POST /api/calltracking/webhook/{callrail,twilio,:provider}/:companyId
 *   POST /api/ai-receptionist/webhook/{recording,status}/:companyId
 * — accepted ANY caller: anyone with a company id could write call-log rows, file leads and contacts,
 * and fire the AI receptionist's missed-call rules. crm-dispensary's SMS, Plaid and marketplace
 * webhooks and roof's inbound SMS did the same. A webhook has no session by nature, so nothing else in
 * the tree (permission guards, auth-before-authorise, live probes) can see that it is open: it answers
 * 200 to the provider AND to everyone else.
 *
 * THE RULE: a write route (POST / PUT / PATCH / ALL) whose full path has a `webhook` or `webhooks`
 * segment — or whose handler reads Twilio's request params (CallSid, Digits, …) or answers TwiML, wherever
 * it is mounted (homecare's /api/ivr/*, 10/16) — must call a recognised verifier in its handler (or in a
 * router-level .use() registered before it), and the verifier must come BEFORE the handler's first write.
 * A LOCAL Twilio check must call the shared verifyTwilioRequest underneath. Recognised:
 *
 *   verifyTwilioRequest · verifyCallRailSignature · verifyPlaidWebhook · verifyWebhookSecret ·
 *   verifyFactoryKey   — packages/tenant-backend (tests/shared/webhook-signatures.test.ts)
 *   constructEvent / constructEventAsync / constructWebhookEvent — Stripe's signature check
 *   verifyAndParseWebhook — crm-store's payment / supplier providers
 *   verifyWisetackWebhook — crm-roof's lender module
 *   verifyWebhook / validateTwilioSignature — template-local checks; a LOCAL definition is accepted only
 *     if its body actually compares something (timingSafeEqual / createHmac / a recognised verifier).
 *     The crm-family "verifyTwilioSignature" once returned true — a name is not a check.
 *
 * Exemptions are an ALLOW list keyed by template + method + full path — never a file or a line number
 * (a file excuse covers its next route too; a line number moves on the next edit). Each says why.
 * A stale entry fails, so the list cannot outlive the route it excused.
 *
 * Walk: every templates/crm-* backend (crm-automotive is parked) and packages/tenant-backend.
 * Registrations through ANY receiver are read (`app.post`, `pub.post`, `const r2 = app; r2.post`),
 * and a template's index.ts `app.route(prefix, x)` gives each route file its mount prefix. A handler
 * passed by name is followed to its definition. After the real walk this file mutation-tests itself.
 *
 *   bun scripts/check-provider-webhooks-signed.ts
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join, dirname, resolve } from 'path'

const ROOT = (process.argv[2] || process.cwd()).replace(/\\/g, '/').replace(/\/$/, '')
const PARKED = new Set(['crm-automotive'])

const ALLOW: Record<string, string> = {
  // Wisetack: verified INSIDE services/wisetack.ts processWebhook (HMAC-SHA256 with WISETACK_WEBHOOK_SECRET,
  // timing-safe, throws without a secret), and the whole router answers 503 until WISETACK_* is set — no
  // Wisetack account exists (project memory). The handler hands it the x-wisetack-signature header.
  'crm POST /api/wisetack/webhook': 'Wisetack — signature checked in services/wisetack.ts processWebhook; router 503s until configured',
  'crm-basic POST /api/wisetack/webhook': 'Wisetack — signature checked in services/wisetack.ts processWebhook; router 503s until configured',
  'crm-fieldservice POST /api/wisetack/webhook': 'Wisetack — signature checked in services/wisetack.ts processWebhook; router 503s until configured',
  'crm-landscaping POST /api/wisetack/webhook': 'Wisetack — signature checked in services/wisetack.ts processWebhook; router 503s until configured',
  'crm-restaurant POST /api/wisetack/webhook': 'Wisetack — signature checked in services/wisetack.ts processWebhook; router 503s until configured',
  'crm-rv POST /api/wisetack/webhook': 'Wisetack — signature checked in services/wisetack.ts processWebhook; router 503s until configured',
  'crm-salon POST /api/wisetack/webhook': 'Wisetack — signature checked in services/wisetack.ts processWebhook; router 503s until configured',
  'crm-vet POST /api/wisetack/webhook': 'Wisetack — signature checked in services/wisetack.ts processWebhook; router 503s until configured',
  // Lead-source webhooks (Zapier / Make / a form builder) carry no signature: the per-source secret IS the
  // credential, matched in the WHERE clause (platform AND webhook_secret) and required — no secret → 401.
  'packages/tenant-backend POST /inbound/webhook/:source': 'lead source — its webhook secret is required and matched in the lookup',
  'crm-dispensary POST /api/leads/inbound/webhook/:source': 'lead source — its webhook secret is required and matched in the lookup',
  'crm-homecare POST /api/leads/inbound/webhook/:source': 'lead source — its webhook secret is required and matched in the lookup',
  'crm-roof POST /api/leads/inbound/webhook/:source': 'lead source — its webhook secret is required and matched in the lookup',
}

const VERIFIER = /\b(verifyTwilioRequest|verifyCallRailSignature|verifyPlaidWebhook|verifyWebhookSecret|verifyFactoryKey|constructEvent|constructEventAsync|constructWebhookEvent|verifyAndParseWebhook|verifyWisetackWebhook|verifyWebhook|validateTwilioSignature)\s*\(/g
const VERIFIER_NAME = new RegExp(VERIFIER.source.replace(/\\s\*\\\($/, '\\b'), 'g')
/**
 * …and a route Twilio calls that is NOT under /webhook/ — homecare's IVR (/api/ivr/voice, /verify-pin, /clock-in …)
 * skipped its own check in production whenever TWILIO_AUTH_TOKEN was unset. A write route whose handler reads
 * Twilio's request params or answers TwiML is a Twilio webhook whatever its path, and is held to the same rule. (10/16)
 */
// A Twilio param READ (body.Digits, payload['CallSid'], { CallSid } = …) or TwiML in a string — in code, not in a comment
// ("Digits, and enough of them to be a phone number" is a comment in dispensary's company route).
const TWILIO_SHAPE = /(?:[.'"`[{,]\s*)(CallSid|MessageSid|SmsSid|RecordingSid|RecordingUrl|CallStatus|MessageStatus|Digits)\b|<Response[\s>]/
const withoutComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1')
const LOCAL_MUST_COMPARE =/timingSafeEqual|createHmac|webhooks\.constructEvent(?:Async)?\(|verifyTwilioRequest\(|verifyCallRailSignature\(|verifyWebhookSecret\(|verifyFactoryKey\(/
const WRITE = /\bdb\s*\.\s*(insert|update|delete)\s*\(|\bdb\s*\.\s*execute\s*\(\s*sql`\s*(INSERT|UPDATE|DELETE)\b|\.handle\w*\s*\(|\blogCall\s*\(|\bevaluateRules\s*\(|\bprocess\w*Webhook\s*\(/i
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'ALL'])

type Files = Map<string, string> // repo-relative path → source
type Finding = { key: string; ok: boolean; why: string }

// ─── source helpers ──────────────────────────────────────────────────────────────────────────────
/** Index just past the bracket that closes the one at `open` (string / template / comment aware). */
function closeOf(src: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' }
  const stack: string[] = [pairs[src[open]]]
  let i = open + 1
  while (i < src.length && stack.length) {
    const ch = src[i]
    if (ch === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; i++
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { i += 2; continue }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') { i = closeOf(src, i + 1); continue }
        i++
      }
      i++; continue
    }
    if (pairs[ch]) stack.push(pairs[ch])
    else if (ch === stack[stack.length - 1]) stack.pop()
    i++
  }
  return i
}
/** The body of a function or const defined in this file under `name`, or ''. */
function definitionOf(src: string, name: string): string {
  const m = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*=`).exec(src)
  if (!m) return ''
  const brace = src.indexOf('{', m.index + m[0].length)
  if (brace < 0) return ''
  return src.slice(m.index, closeOf(src, brace))
}

// ─── the walk ────────────────────────────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e === '.git') continue
    const p = join(dir, e)
    let s; try { s = statSync(p) } catch { continue }
    if (s.isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) out.push(p)
  }
  return out
}
function readTree(): Files {
  const files: Files = new Map()
  const add = (abs: string) => files.set(abs.replace(/\\/g, '/').slice(ROOT.length + 1), readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'))
  for (const t of readdirSync(`${ROOT}/templates`)) {
    if (!/^crm(-|$)/.test(t) || PARKED.has(t)) continue
    const src = `${ROOT}/templates/${t}/backend/src`
    if (existsSync(src)) for (const f of walk(src)) if (!/[\\/]src[\\/]shared[\\/]/.test(f)) add(f)
  }
  for (const f of walk(`${ROOT}/packages/tenant-backend/src`)) add(f)
  return files
}

/** owner label + mount prefixes for each route file, from the template's index.ts. */
function mounts(files: Files): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [rel, src] of files) {
    if (!/^templates\/[^/]+\/backend\/src\/index\.ts$/.test(rel)) continue
    const base = rel.replace(/index\.ts$/, '')
    const imports = new Map<string, string>()
    for (const m of src.matchAll(/import\s+(\w+)\s+from\s+['"](\.\/routes\/[^'"]+)['"]/g)) {
      let p = base + m[2].slice(2)
      if (!p.endsWith('.ts')) p += '.ts'
      imports.set(m[1], p)
    }
    // …and the lazy form homecare uses: x = (await import('./routes/x.ts')).default
    for (const m of src.matchAll(/(\w+)\s*=\s*\(await import\(['"](\.\/routes\/[^'"]+)['"]\)\)\.default/g)) {
      let p = base + m[2].slice(2)
      if (!p.endsWith('.ts')) p += '.ts'
      imports.set(m[1], p)
    }
    for (const m of src.matchAll(/\.route\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)\s*\)/g)) {
      const file = imports.get(m[2]); if (!file) continue
      out.set(file, [...(out.get(file) || []), m[1]])
    }
  }
  return out
}

const ownerOf = (rel: string) => rel.startsWith('packages/') ? 'packages/tenant-backend' : rel.split('/')[1]
const isWebhookPath = (p: string) => p.split('/').some((seg) => /^webhooks?$/i.test(seg))

function judge(files: Files): { findings: Finding[]; seen: number; stale: string[]; unreadable: string[] } {
  const findings: Finding[] = []
  const used = new Set<string>()
  const unreadable: string[] = []
  const mountMap = mounts(files)
  let seen = 0
  for (const [rel, src] of files) {
    const owner = ownerOf(rel)
    const prefixes = rel.endsWith('/src/index.ts') ? [''] : (mountMap.get(rel) || [''])
    // Every `<receiver>.<verb>(` and `<receiver>.on(` — the receiver can be any name, so an alias is seen.
    const re = /\b(\w+)\s*\.\s*(post|put|patch|all|on)\s*\(/g
    let m: RegExpExecArray | null
    const uses: Array<{ at: number; text: string }> = []
    for (const u of src.matchAll(/\b\w+\s*\.\s*use\s*\(/g)) uses.push({ at: u.index!, text: src.slice(u.index!, closeOf(src, u.index! + u[0].length - 1)) })
    while ((m = re.exec(src))) {
      if (m[1] === 'Promise') continue // Promise.all(…) is not a router
      const open = m.index + m[0].length - 1
      const end = closeOf(src, open)
      const call = src.slice(open + 1, end - 1)
      let methods: string[]
      let rest: string
      if (m[2] === 'on') {
        const mm = /^\s*(\[[^\]]*\]|['"`]\w+['"`])\s*,\s*([\s\S]*)$/.exec(call)
        if (!mm) continue
        methods = Array.from(mm[1].matchAll(/['"`](\w+)['"`]/g)).map((x) => x[1].toUpperCase())
        rest = mm[2]
      } else { methods = [m[2].toUpperCase()]; rest = call }
      const pm = /^\s*(['"`])([^'"`]*)\1\s*,([\s\S]*)$/.exec(rest)
      if (!pm) {
        // A non-literal path on a webhook-looking registration is reported, not guessed at.
        if (/webhook/i.test(rest.slice(0, 120))) unreadable.push(`${rel}: ${src.slice(m.index, m.index + 80).replace(/\s+/g, ' ')}`)
        continue
      }
      if (!methods.some((x) => WRITE_METHODS.has(x))) continue
      const routePath = pm[2]
      for (const prefix of prefixes) {
        const full = (prefix + (routePath === '/' ? '' : routePath)) || '/'
        // The handler: the registration's own text, plus the definition of a handler passed by name.
        let text = pm[3]
        const named = /,?\s*(\w+)\s*$/.exec(pm[3].trim()) ? /(\w+)\s*$/.exec(pm[3].trim())?.[1] : undefined
        if (named && !/^(c|async)$/.test(named)) text += '\n' + definitionOf(src, named)
        if (!isWebhookPath(full) && !TWILIO_SHAPE.test(withoutComments(text))) continue
        seen++
        const key = `${owner} ${methods.join('|')} ${full}`
        if (ALLOW[key]) { used.add(key); findings.push({ key, ok: true, why: `allowed: ${ALLOW[key]}` }); continue }
        const before = uses.filter((u) => u.at < m!.index).map((u) => u.text).join('\n')
        // In the handler a verifier is CALLED; on a router-level .use() it is passed by name (app.use('*', validateX)).
        const calls = [...Array.from(before.matchAll(VERIFIER_NAME)), ...Array.from(text.matchAll(VERIFIER))].map((v) => v[1])
        if (!calls.length) { findings.push({ key, ok: false, why: 'calls no recognised verifier — anyone can post to it' }); continue }
        // A verifier defined in THIS file must actually compare something.
        const hollow = calls.filter((n) => { const d = definitionOf(src, n); return d && !LOCAL_MUST_COMPARE.test(d.replace(/^[^{]*\{/, '')) })
        if (hollow.length === calls.length) { findings.push({ key, ok: false, why: `its verifier ${hollow[0]}() is defined here and compares nothing` }); continue }
        // A LOCAL Twilio check must be the shared one underneath. homecare's IVR had its own HMAC — which compares
        // something, so the rule above passed it — and skipped itself outside production and whenever the token was
        // unset, and compared against c.req.url, which Render's proxy rewrites. verifyTwilioRequest owns that policy.
        const ownTwilio = calls.filter((n) => /twilio/i.test(n) && n !== 'verifyTwilioRequest' && definitionOf(src, n) && !/verifyTwilioRequest\(/.test(definitionOf(src, n)))
        if (ownTwilio.length) { findings.push({ key, ok: false, why: `its Twilio check ${ownTwilio[0]}() is hand-rolled — call the shared verifyTwilioRequest (proxy URL forms, no skip in production)` }); continue }
        // Verify first: in the handler text, the first verifier call comes before the first write.
        const vAt = text.search(VERIFIER) === -1 ? -1 : text.search(new RegExp(VERIFIER.source))
        const wAt = text.search(WRITE)
        if (vAt !== -1 && wAt !== -1 && wAt < vAt && !before.match(VERIFIER_NAME)) { findings.push({ key, ok: false, why: 'writes before it verifies' }); continue }
        findings.push({ key, ok: true, why: `verified: ${Array.from(new Set(calls)).join(', ')}` })
      }
    }
  }
  const stale = Object.keys(ALLOW).filter((k) => !used.has(k))
  return { findings, seen, stale, unreadable }
}

// ═══ the real tree ═══════════════════════════════════════════════════════════════════════════════
let failures = 0
const fail = (msg: string) => { console.log(`FAIL: ${msg}`); failures++ }
const files = readTree()
const real = judge(files)
// LIST=1 prints every webhook route and what verifies it.
if (process.env.LIST) for (const f of real.findings) console.log(`${f.ok ? 'ok  ' : 'FAIL'} ${f.key} — ${f.why}`)
for (const f of real.findings.filter((x) => !x.ok)) fail(`${f.key} — ${f.why}`)
for (const k of real.stale) fail(`ALLOW entry "${k}" names no webhook route any more — remove it`)
for (const u of real.unreadable) fail(`a webhook registration the walk cannot read (path is not a literal): ${u}`)
if (real.seen < 60) fail(`only ${real.seen} webhook routes found — the walk is broken, not the code`)
const must = ['crm POST /api/calltracking/webhook/callrail/:companyId', 'crm-homecare POST /api/ai-receptionist/webhook/status/:agencyId', 'crm-dispensary POST /api/pay-by-bank/webhook', 'crm-roof POST /api/sms/webhook', 'crm-store POST /api/public/webhooks/payment', 'packages/tenant-backend POST /webhook/incoming', 'crm-homecare POST /api/ivr/clock-in']
for (const k of must) if (!real.findings.some((f) => f.key === k)) fail(`the walk did not see ${k}`)
if (real.findings.some((f) => /\/webhook\/:provider\//.test(f.key))) fail('a catch-all /webhook/:provider/ route is back')

// ═══ mutation checks: each plant must make the walk fail, on an in-memory copy of a real file ════
const failsWith = (rel: string, mutate: (s: string) => string): string[] => {
  const src = files.get(rel)
  if (src === undefined) return [`(no such file ${rel})`]
  const planted = mutate(src)
  if (planted === src) return ['(the mutation did not apply)']
  const j = judge(new Map([...files, [rel, planted]]))
  return [...j.findings.filter((f) => !f.ok).map((f) => f.key), ...j.unreadable.map((u) => 'unreadable ' + u)]
}
const selfTest = (name: string, ok: boolean, got: unknown) => { if (!ok) fail(`self-test: ${name} — got ${JSON.stringify(got).slice(0, 300)}`) }
const CT = 'templates/crm/backend/src/routes/calltracking.ts'
const m1 = failsWith(CT, (s) => s.replace("const v = verifyCallRailSignature(raw, c.req.header('signature'), row?.callrailSigningKey || undefined)\n  if (!v.ok) return refuseUnverifiedWebhook(c, 'CallRail call webhook', v.reason)", 'const v = { ok: true }'))
selfTest('removing the CallRail verify call fails exactly that route', m1.length === 1 && m1[0] === 'crm POST /api/calltracking/webhook/callrail/:companyId', m1)
const m2 = failsWith(CT, (s) => s.replace('\nexport default app', "\nconst r2 = app\nr2.post('/webhook/planted/:companyId', async (c) => c.json({ ok: true }))\nexport default app"))
selfTest('a route registered through an alias (const r2 = app) is seen and fails', m2.includes('crm POST /api/calltracking/webhook/planted/:companyId'), m2)
const m3 = failsWith('templates/crm/backend/src/routes/webhooks.ts', (s) => s.replace(/function verifyWebhook\(c: any\): boolean \{[\s\S]*?\n\}/, 'function verifyWebhook(c: any): boolean {\n  return true\n}'))
selfTest('a local verifyWebhook() that compares nothing fails the website-lead webhook', m3.includes('crm POST /api/webhooks/leads'), m3)
const AI = 'templates/crm-vet/backend/src/routes/aiReceptionist.ts'
const m4 = failsWith(AI, (s) => s.replace("  const payload: any = await parseTwilioBody(c)\n  const v = verifyTwilioRequest(c, payload, await twilioTokenFor(companyId))\n  if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio status webhook', v.reason)\n",
  "  const payload: any = await parseTwilioBody(c)\n  aiReceptionist.evaluateRules(companyId, { callLogId: '', callerNumber: payload.From, status: 'missed' })\n  const v = verifyTwilioRequest(c, payload, await twilioTokenFor(companyId))\n  if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio status webhook', v.reason)\n"))
selfTest('a write placed before the verify call fails', m4.includes('crm-vet POST /api/ai-receptionist/webhook/status/:companyId'), m4)
const m5 = failsWith('templates/crm-dispensary/backend/src/routes/marketplace.ts', (s) => s.replace("app.post('/webhook/:partnerId',", "app.on(['POST'], '/webhook/:partnerId',").replace(/if \(!verifyWebhookSecret\([^\n]*\n\s*return c\.json\(\{ error: 'Invalid webhook secret' \}, 401\)\n\s*\}/, ''))
selfTest('app.on([\'POST\'], …) is seen, and the marketplace webhook without its secret check fails', m5.includes('crm-dispensary POST /api/marketplace/webhook/:partnerId'), m5)
const m6 = failsWith('packages/tenant-backend/src/integrations/sms.ts', (s) => s.replace("app.post('/webhook/status', async (c) => {\n    const params = await parseTwilioBody(c)\n    const v = verifyTwilioRequest(c, params, await tokenFor(params))", "app.post('/webhook/status', async (c) => {\n    const params = await parseTwilioBody(c)\n    const v = { ok: true } as any"))
selfTest('the shared package is walked too (SMS status webhook without its verify fails)', m6.includes('packages/tenant-backend POST /webhook/status'), m6)
// Twilio routes that are NOT under /webhook/ — homecare's IVR (10/16)
const IVR = 'templates/crm-homecare/backend/src/routes/ivr.ts'
const IVR_KEYS = ['crm-homecare POST /api/ivr/voice', 'crm-homecare POST /api/ivr/verify-pin', 'crm-homecare POST /api/ivr/clock-in', 'crm-homecare POST /api/ivr/clock-out']
const m7 = failsWith(IVR, (s) => s.replace("app.use('*', validateTwilioSignature)\n", ''))
selfTest('the IVR without its router-level signature check fails every IVR route', IVR_KEYS.every((k) => m7.includes(k)), m7)
const m8 = failsWith(IVR, (s) => s.replace(/async function validateTwilioSignature\(c: Context, next: Next\) \{[\s\S]*?\n\}\n/, "async function validateTwilioSignature(c: Context, next: Next) {\n  if (process.env.NODE_ENV !== 'production') return next()\n  const authToken = process.env.TWILIO_AUTH_TOKEN\n  if (!authToken) return next()\n  const sig = c.req.header('X-Twilio-Signature')\n  const expected = createHmac('sha1', authToken).update(c.req.url).digest('base64')\n  if (sig !== expected) return c.body('', 403)\n  return next()\n}\n"))
selfTest('the IVR\'s old hand-rolled HMAC (skips without a token, no proxy forms) fails', IVR_KEYS.every((k) => m8.includes(k)), m8)
const m9 = failsWith('templates/crm-roof/backend/src/routes/sms.ts', (s) => s.replace('\nexport default app', "\nconst voice = app\nvoice.post('/voice-planted', async (c) => { const b = await c.req.parseBody(); return c.text(String(b.CallSid)) })\nexport default app"))
selfTest('a Twilio-shaped route outside /webhook/ (reads CallSid), through an alias, is seen and fails', m9.includes('crm-roof POST /api/sms/voice-planted'), m9)
const m10 = failsWith('templates/crm-roof/backend/src/routes/sms.ts', (s) => s.replace('\nexport default app', "\napp.post('/twiml-planted', (c) => c.text('<Response><Say>hi</Say></Response>'))\nexport default app"))
selfTest('a route that answers TwiML outside /webhook/ is seen and fails', m10.includes('crm-roof POST /api/sms/twiml-planted'), m10)

console.log(
  failures
    ? `\nprovider-webhooks-signed: ${failures} problem(s)`
    : `provider-webhooks-signed: ok — ${real.seen} webhook route(s) across ${new Set(real.findings.map((f) => f.key.split(' ')[0])).size} templates/packages verify the sender first (${Object.keys(ALLOW).length} allow-listed with a reason); 10 self-mutations caught`,
)
process.exit(failures ? 1 : 0)
