// The $19 site's function AS DEPLOYED: the bundle publish.ts builds (handler + entry + the real @netlify/blobs), run the way
// Netlify runs a Lambda-style function — `connectLambda(event)` with the event's Blobs context and site headers — against a
// stand-in of the Blobs edge API. 10/30: the live test site answered 500 on every route because the store was opened with
// strong consistency, which connectLambda's context (no `uncachedEdgeURL`) cannot do; the unit tests' fake store never knew.
//   bun test tests/unified/factory/web-presence-bundle.test.ts
import { test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { bundleFunction } from '../../../apps/api/src/webPresence/publish.ts'
import { mintSignin } from '../../../apps/api/src/webPresence/site/session.mjs'

const SITE_ROW = 'row-1', SECRET = 'a'.repeat(64)
const blobs = new Map<string, string>()
let srv: ReturnType<typeof Bun.serve>
let handler: (event: any) => Promise<any>
let dir = ''

beforeAll(async () => {
  // The Blobs edge API, as @netlify/blobs calls it: GET a key (404 when absent), PUT a key; `If-None-Match: *` is onlyIfNew (412 if it exists).
  srv = Bun.serve({ port: 0, async fetch(req) {
    const key = new URL(req.url).pathname
    if (req.method === 'GET') return blobs.has(key) ? new Response(blobs.get(key)) : new Response(null, { status: 404 })
    if (req.method === 'PUT') {
      if (req.headers.get('if-none-match') === '*' && blobs.has(key)) return new Response(null, { status: 412 })
      blobs.set(key, await req.text()); return new Response(null, { status: 200 })
    }
    return new Response(null, { status: 405 })
  } })
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-bundle-'))
  const code = await bundleFunction({ index: '<!doctype html><title>Acme</title><p>Acme Lawn</p>', privacy: '<p>privacy</p>', model: { v: 1, sections: [], forms: {} }, spec: {} })
  fs.writeFileSync(path.join(dir, 'site.mjs'), code)
  Object.assign(process.env, { WP_SITE_ID: SITE_ROW, WP_SECRET: SECRET, WP_FACTORY_URL: 'https://factory.invalid', WP_TENANT_ID: 't-1', WP_FACTORY_KEY: 'k' })
  const loaded = (await import(path.join(dir, 'site.mjs'))).handler
  // Run with Bun's own fetch: other test files in this process replace globalThis.fetch (some never restore it), and the
  // bundled Blobs client calls globalThis.fetch at request time.
  handler = async (ev: any) => { const before = globalThis.fetch; globalThis.fetch = Bun.fetch as any; try { return await loaded(ev) } finally { globalThis.fetch = before } }
}, 60_000)
afterAll(() => { srv?.stop(true); try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* temp */ } })

// What Netlify passes a Lambda-style function: the Blobs context (url + token, and NO uncachedEdgeURL) and the site headers.
const event = (r: string, method = 'GET', body: string | null = null) => ({
  rawUrl: `https://acme.netlify.app/.netlify/functions/site?r=${r}`, path: '/.netlify/functions/site', httpMethod: method,
  headers: { host: 'acme.netlify.app', 'x-nf-site-id': 'nf-site-1', 'x-nf-deploy-id': 'dep-1', ...(body ? { 'content-type': 'application/json' } : {}) },
  queryStringParameters: { r }, rawQuery: `r=${r}`, body, isBase64Encoded: false,
  blobs: Buffer.from(JSON.stringify({ url: `http://localhost:${srv.port}`, token: 'tok' })).toString('base64'),
})

test('the page, the privacy page and "am I signed in" answer 200 in the Lambda runtime', async () => {
  for (const r of ['page', 'privacy', 'api/me']) {
    const res = await handler(event(r))
    expect([r, res.statusCode]).toEqual([r, 200])
  }
  expect(String((await handler(event('page'))).body)).toContain('Acme Lawn')
  expect(String((await handler(event('privacy'))).body)).toContain('privacy')
  expect(String((await handler(event('api/me'))).body)).toContain('signedIn')
})

test('a sign-in link works once — the second use is refused (an atomic write, not a read)', async () => {
  const token = await mintSignin(SECRET, SITE_ROW, Date.now())
  const first = await handler(event('api/signin', 'POST', JSON.stringify({ token })))
  expect(first.statusCode).toBe(200)
  const again = await handler(event('api/signin', 'POST', JSON.stringify({ token })))
  expect(again.statusCode).toBe(401)
  expect(String(again.body)).toContain('already used')
})

test('the entry never asks Blobs for strong consistency (a Lambda-style function cannot)', () => {
  const entry = fs.readFileSync(path.join(import.meta.dir, '../../../apps/api/src/webPresence/site/entry.mjs'), 'utf8')
  const handlerSrc = fs.readFileSync(path.join(import.meta.dir, '../../../apps/api/src/webPresence/site/handler.mjs'), 'utf8')
  expect(/consistency:\s*['"]strong['"]/.test(entry.replace(/\/\/.*$/gm, '')) || /consistency:\s*['"]strong['"]/.test(handlerSrc.replace(/\/\/.*$/gm, ''))).toBe(false)
})
