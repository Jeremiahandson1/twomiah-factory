// Provider webhook signatures — the verifiers every CRM's provider webhooks call. (10/15)
//
// Until 10/15 the call-tracking and AI-receptionist webhooks in nine CRMs accepted ANY caller: anyone
// with a company id could write call-log rows, fire the AI receptionist's missed-call rules or feed it
// a recording. They now call these verifiers first and answer 403 when one says no. This file pins the
// verifiers themselves, against the providers' own rules:
//
//   CallRail — `Signature` = Base64(HMAC-SHA1(signing key, RAW body)). The official test vector from
//              apidocs.callrail.com ("Webhooks Security") is fixtures/callrail-vector.json, which must
//              produce UZAHbUdfm3GqL7qzilGozGzWV64= with key 072e77e426f92738a72fe23c4d1953b4.
//   Twilio   — X-Twilio-Signature = Base64(HMAC-SHA1(auth token, URL + sorted key+value)), checked
//              against the URL Twilio requested, which behind Render's proxy is not c.req.url.
//   Plaid    — Plaid-Verification is an ES256 JWT carrying the SHA-256 of the body, max 5 minutes old.
//
// The behaviour through real routes (403, nothing written) is in the template suites:
// tests/{crm,homecare,roof}/webhook-signatures-*.test.ts.
//
//   bun tests/shared/webhook-signatures.test.ts
const { readFileSync } = await import('node:fs')
const crypto = await import('node:crypto')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const { verifyCallRailSignature, callRailSignatureFor, mapCallRailPayload } = await import(ROOT + 'packages/tenant-backend/src/integrations/callrail.ts')
const { verifyTwilioRequest, twilioSignatureFor } = await import(ROOT + 'packages/tenant-backend/src/integrations/twilio.ts')
const { verifyPlaidWebhook } = await import(ROOT + 'packages/tenant-backend/src/integrations/plaid.ts')
const { verifyWebhookSecret } = await import(ROOT + 'packages/tenant-backend/src/integrations/webhookAuth.ts')
// The package index is read as TEXT: importing it pulls in zod, drizzle and the rest, and this file runs with no install.
const INDEX = readFileSync(ROOT + 'packages/tenant-backend/src/index.ts', 'utf8')

const withEnv = <T>(name: string, value: string | undefined, fn: () => T): T => {
  const before = process.env[name]
  if (value === undefined) delete process.env[name]; else process.env[name] = value
  try { return fn() } finally { if (before === undefined) delete process.env[name]; else process.env[name] = before }
}
const withEnvAsync = async <T>(name: string, value: string | undefined, fn: () => Promise<T>): Promise<T> => {
  const before = process.env[name]
  if (value === undefined) delete process.env[name]; else process.env[name] = value
  try { return await fn() } finally { if (before === undefined) delete process.env[name]; else process.env[name] = before }
}

console.log('\n══════════ exported from the package index (what the templates import) ══════════')
for (const n of ['verifyCallRailSignature', 'callRailSignatureFor', 'mapCallRailPayload', 'verifyTwilioRequest', 'parseTwilioBody', 'verifyPlaidWebhook', 'plaidKeyFetcher', 'refuseUnverifiedWebhook', 'verifyWebhookSecret', 'verifyFactoryKey'])
  check(`${n} is exported from the package index`, new RegExp('^export \\{[^}]*\\b' + n + '\\b[^}]*\\}', 'm').test(INDEX))

// ══════════════════════════════════════════════════════════════════════════════ CallRail
console.log('\n══════════ CallRail: the official test vector ══════════')
const KEY = '072e77e426f92738a72fe23c4d1953b4'
const VECTOR = readFileSync(ROOT + 'tests/shared/fixtures/callrail-vector.json', 'utf8').replace(/\r?\n$/, '')
const EXPECTED = 'UZAHbUdfm3GqL7qzilGozGzWV64='
check('the fixture is the vector as published (one line, no trailing newline)', !VECTOR.includes('\n') && VECTOR.startsWith('{"answered":false') && VECTOR.endsWith('"}'), VECTOR.slice(-20))
check('callRailSignatureFor(key, vector) is CallRail\'s expected signature', callRailSignatureFor(KEY, VECTOR) === EXPECTED, callRailSignatureFor(KEY, VECTOR))
withEnv('NODE_ENV', 'production', () => {
  check('the vector verifies', verifyCallRailSignature(VECTOR, EXPECTED, KEY).ok === true)
  check('…with surrounding whitespace on the header too', verifyCallRailSignature(VECTOR, ` ${EXPECTED} `, KEY).ok === true)
  const tampered = VECTOR.replace('"customer_name":"Kaylah Mills"', '"customer_name":"Kaylah Millz"')
  check('a tampered body is refused', tampered !== VECTOR && verifyCallRailSignature(tampered, EXPECTED, KEY).ok === false)
  const reserialised = JSON.stringify(JSON.parse(VECTOR), null, 1)
  check('re-serialised JSON is refused (the RAW body is what is signed)', verifyCallRailSignature(reserialised, EXPECTED, KEY).ok === false)
  const wrong = verifyCallRailSignature(VECTOR, EXPECTED, KEY.replace(/^0/, '1'))
  check('the wrong key is refused', wrong.ok === false && wrong.reason === 'signature mismatch', wrong)
  const missing = verifyCallRailSignature(VECTOR, undefined, KEY)
  check('a missing Signature header is refused, and says so', missing.ok === false && /missing Signature/.test(missing.reason || ''), missing)
  check('an empty Signature header is refused', verifyCallRailSignature(VECTOR, '', KEY).ok === false)
  check('a signature of the wrong length is refused (no throw)', verifyCallRailSignature(VECTOR, 'abc', KEY).ok === false)
  const noKey = verifyCallRailSignature(VECTOR, EXPECTED, undefined)
  check('production, no signing key configured → refused, naming the missing key', noKey.ok === false && /CallRail signing key not configured/.test(noKey.reason || ''), noKey)
  check('production, empty-string key → refused', verifyCallRailSignature(VECTOR, EXPECTED, '').ok === false)
})
withEnv('NODE_ENV', 'test', () => {
  const dev = verifyCallRailSignature(VECTOR, undefined, undefined)
  check('outside production, no key → allowed (local dev, the harness)', dev.ok === true && /non-production/.test(dev.reason || ''), dev)
  check('outside production WITH a key, a forged body is still refused', verifyCallRailSignature(VECTOR + ' ', EXPECTED, KEY).ok === false)
})

console.log('\n══════════ CallRail: the payload maps CallRail\'s real field names ══════════')
{
  const m = mapCallRailPayload(JSON.parse(VECTOR))
  check('caller number from customer_phone_number', m.callerNumber === '+12148654559', m)
  check('caller name from customer_name', m.callerName === 'Kaylah Mills', m)
  check('caller city / state from customer_city / customer_state', m.callerCity === 'Rochester' && m.callerState === 'PA', m)
  check('tracking number from tracking_phone_number', m.trackingNumber === '+14045558514', m)
  check('source from source_name', m.source === 'Google AdWords', m)
  check('an unanswered call is missed', m.status === 'missed', m)
  check('duration "13" → 13', m.duration === 13, m)
  check('provider id is the CallRail call id, as text', m.providerId === '766970532', m)
  const legacy = mapCallRailPayload({ caller_phone_number: '+15550001111', caller_name: 'Old Tool', answered: true })
  check('the old caller_* names still map (a tool that posted them keeps working)', legacy.callerNumber === '+15550001111' && legacy.callerName === 'Old Tool' && legacy.status === 'completed', legacy)
}

// ══════════════════════════════════════════════════════════════════════════════ Twilio
console.log('\n══════════ Twilio: X-Twilio-Signature, with the URL forms Render\'s proxy produces ══════════')
const TOKEN = 'twilio-test-auth-token-0123456789ab'
const params = { CallSid: 'CA123', From: '+16085550123', To: '+16085559999', CallStatus: 'no-answer', Direction: 'inbound' }
const PUBLIC = 'https://crm.example.com/api/ai-receptionist/webhook/status/co_1?x=1'
const ctx = (url: string, headers: Record<string, string>) => ({ req: { url, header: (n: string) => headers[n.toLowerCase()] } })
const sig = twilioSignatureFor(TOKEN, PUBLIC, params)
check('twilioSignatureFor is Base64(HMAC-SHA1(token, url + sorted key+value))',
  sig === crypto.createHmac('sha1', TOKEN).update(PUBLIC + 'CallSidCA123CallStatusno-answerDirectioninboundFrom+16085550123To+16085559999').digest('base64'))
withEnv('NODE_ENV', 'production', () => {
  // Render: TLS ends at the proxy, so the app sees http on the internal port; host + x-forwarded-proto carry the public form.
  const behindRender = ctx('http://crm.example.com:10000/api/ai-receptionist/webhook/status/co_1?x=1', { 'x-twilio-signature': sig, host: 'crm.example.com', 'x-forwarded-proto': 'https' })
  check('signed for https://host/… , received as http://host:10000/… behind the proxy → accepted', verifyTwilioRequest(behindRender, params, TOKEN).ok === true)
  const forwardedHost = ctx('http://10.0.0.5:10000/api/ai-receptionist/webhook/status/co_1?x=1', { 'x-twilio-signature': sig, 'x-forwarded-host': 'crm.example.com', 'x-forwarded-proto': 'https' })
  check('…received on an internal address with x-forwarded-host → accepted', verifyTwilioRequest(forwardedHost, params, TOKEN).ok === true)
  const noProto = ctx('http://crm.example.com:10000/api/ai-receptionist/webhook/status/co_1?x=1', { 'x-twilio-signature': sig, host: 'crm.example.com:10000' })
  check('…no forwarded headers at all: the https + port-less form is still tried → accepted', verifyTwilioRequest(noProto, params, TOKEN).ok === true)
  const plainSig = twilioSignatureFor(TOKEN, 'http://localhost/api/calltracking/webhook/twilio/co_1', params)
  check('the request URL itself (no proxy) → accepted', verifyTwilioRequest(ctx('http://localhost/api/calltracking/webhook/twilio/co_1', { 'x-twilio-signature': plainSig }), params, TOKEN).ok === true)
  check('a tampered param is refused', verifyTwilioRequest(behindRender, { ...params, From: '+19995550000' }, TOKEN).ok === false)
  check('an added param is refused', verifyTwilioRequest(behindRender, { ...params, RecordingUrl: 'https://evil.example/x.mp3' }, TOKEN).ok === false)
  check('the wrong auth token is refused', verifyTwilioRequest(behindRender, params, TOKEN + 'x').ok === false)
  const otherPath = ctx('http://crm.example.com:10000/api/ai-receptionist/webhook/status/co_2?x=1', { 'x-twilio-signature': sig, host: 'crm.example.com', 'x-forwarded-proto': 'https' })
  check('a signature for one company\'s URL does not verify on another company\'s URL', verifyTwilioRequest(otherPath, params, TOKEN).ok === false)
  const noHeader = verifyTwilioRequest(ctx('http://localhost/x', {}), params, TOKEN)
  check('a missing X-Twilio-Signature is refused, and says so', noHeader.ok === false && /missing X-Twilio-Signature/.test(noHeader.reason || ''), noHeader)
  const noToken = withEnv('TWILIO_AUTH_TOKEN', undefined, () => verifyTwilioRequest(ctx('http://localhost/x', { 'x-twilio-signature': sig }), params, undefined))
  check('production, no auth token anywhere → refused, naming TWILIO_AUTH_TOKEN', noToken.ok === false && /TWILIO_AUTH_TOKEN/.test(noToken.reason || ''), noToken)
})
withEnv('NODE_ENV', 'test', () => {
  const dev = withEnv('TWILIO_AUTH_TOKEN', undefined, () => verifyTwilioRequest(ctx('http://localhost/x', {}), params, undefined))
  check('outside production, no token → allowed', dev.ok === true, dev)
})

// ══════════════════════════════════════════════════════════════════════════════ Plaid
console.log('\n══════════ Plaid: the Plaid-Verification JWT ══════════')
{
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as any), kid: 'k1', alg: 'ES256', use: 'sig' }
  const fetchKey = async (kid: string) => (kid === 'k1' ? jwk : null)
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const body = JSON.stringify({ webhook_type: 'TRANSFER_EVENTS', webhook_code: 'TRANSFER_EVENTS_UPDATE' }, null, 2)
  const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
  const jwtFor = (o: { alg?: string; kid?: string; iat?: number; bodySha?: string; key?: any }) => {
    const h = b64({ alg: o.alg ?? 'ES256', kid: o.kid ?? 'k1', typ: 'JWT' })
    const p = b64({ iat: o.iat ?? Math.floor(Date.now() / 1000), request_body_sha256: o.bodySha ?? sha(body) })
    const s = crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key: o.key ?? privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
    return `${h}.${p}.${s}`
  }
  await withEnvAsync('NODE_ENV', 'production', async () => {
    check('a genuine Plaid webhook verifies', (await verifyPlaidWebhook(body, jwtFor({}), fetchKey)).ok === true)
    check('a tampered body is refused', (await verifyPlaidWebhook(body.replace('UPDATE', 'UPDATF'), jwtFor({}), fetchKey)).ok === false)
    check('signed by another key is refused', (await verifyPlaidWebhook(body, jwtFor({ key: other.privateKey }), fetchKey)).ok === false)
    check('alg other than ES256 is refused', (await verifyPlaidWebhook(body, jwtFor({ alg: 'HS256' }), fetchKey)).reason === 'Plaid-Verification alg is not ES256')
    check('an unknown kid is refused', (await verifyPlaidWebhook(body, jwtFor({ kid: 'nope' }), fetchKey)).ok === false)
    check('older than 5 minutes is refused', /more than 5 minutes/.test((await verifyPlaidWebhook(body, jwtFor({ iat: Math.floor(Date.now() / 1000) - 301 }), fetchKey)).reason || ''))
    check('a request_body_sha256 for another body is refused', (await verifyPlaidWebhook(body, jwtFor({ bodySha: sha('{}') }), fetchKey)).ok === false)
    check('a missing header is refused', (await verifyPlaidWebhook(body, undefined, fetchKey)).ok === false)
    check('garbage in the header is refused (no throw)', (await verifyPlaidWebhook(body, 'not.a.jwt', fetchKey)).ok === false)
    // expired_at: Unix seconds, null while the key is live
    const nowS = Math.floor(Date.now() / 1000)
    const withExpiry = (expired_at: unknown) => async (kid: string) => (kid === 'k1' ? { ...jwk, expired_at } : null)
    check('a key Plaid reports expired_at: null verifies', (await verifyPlaidWebhook(body, jwtFor({}), withExpiry(null))).ok === true)
    const expired = await verifyPlaidWebhook(body, jwtFor({}), withExpiry(nowS - 60))
    check('a key Plaid retired a minute ago is refused, and says so', expired.ok === false && /expired/.test(expired.reason || ''), expired)
    check('a key whose expiry is still ahead verifies', (await verifyPlaidWebhook(body, jwtFor({}), withExpiry(nowS + 3600))).ok === true)
    check('a garbage expired_at is refused, not read as "live"', (await verifyPlaidWebhook(body, jwtFor({}), withExpiry('soon'))).ok === false)
    const noCfg = await verifyPlaidWebhook(body, jwtFor({}), null)
    check('production, Plaid not configured → refused, naming what is missing', noCfg.ok === false && /Plaid not configured/.test(noCfg.reason || ''), noCfg)
  })
  await withEnvAsync('NODE_ENV', 'test', async () => {
    check('outside production, Plaid not configured → allowed', (await verifyPlaidWebhook(body, undefined, null)).ok === true)
  })
}

// ══════════════════════════════════════════════════════════════════════════════ shared secret
console.log('\n══════════ a partner\'s shared webhook secret ══════════')
check('the right secret passes', verifyWebhookSecret('whsec_abc', 'whsec_abc') === true)
check('the wrong secret is refused', verifyWebhookSecret('whsec_abd', 'whsec_abc') === false)
check('a different length is refused (no throw)', verifyWebhookSecret('whsec_ab', 'whsec_abc') === false)
check('no secret on the install → refused, not "anything goes"', verifyWebhookSecret('anything', null) === false && verifyWebhookSecret('', '') === false)
check('no secret sent → refused', verifyWebhookSecret(undefined, 'whsec_abc') === false)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
