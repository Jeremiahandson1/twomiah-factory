// The site's function in Netlify's CURRENT format (v2: Request in, Response out). Lambda-compatibility mode stops being accepted on
// July 1, 2027. Covers: the package as Netlify's CLI builds one (entry point, bootstrap, metadata, the function); the deploy telling
// Netlify the format (functions_config build_data + the upload's runtime and invocation mode) and the Lambda-style deploy unchanged;
// the per-site switch; and the bundled v2 function run against a stand-in of Netlify Blobs — its reads come from the UNCACHED
// address (strongly consistent), so a save shows at once.
//   bun test tests/unified/factory/web-presence-v2.test.ts
import { test, expect, describe, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { bundleFunction, v2Zip } from '../../../apps/api/src/webPresence/publish.ts'
import { Netlify } from '../../../apps/api/src/webPresence/netlify.ts'
import { functionFormatFor } from '../../../apps/api/src/webPresence/service.ts'

/** Read back a zip made by apps/api/src/webPresence/zip.ts (deflate, sizes in the local headers). */
function unzip(buf: Uint8Array): Record<string, string> {
  const b = Buffer.from(buf), out: Record<string, string> = {}
  let o = 0
  while (b.readUInt32LE(o) === 0x04034b50) {
    const comp = b.readUInt32LE(o + 18), nameLen = b.readUInt16LE(o + 26), extraLen = b.readUInt16LE(o + 28)
    const name = b.subarray(o + 30, o + 30 + nameLen).toString('utf8')
    const start = o + 30 + nameLen + extraLen
    out[name] = inflateRawSync(b.subarray(start, start + comp)).toString('utf8')
    o = start + comp
  }
  return out
}

const payload = { index: '<p>first page</p>', privacy: '<p>privacy</p>', model: { v: 1, sections: [], forms: {} }, spec: {}, css: '/* look */', cssVersion: 'v1' }

describe('the package', () => {
  test("as Netlify's CLI builds a current-format function: entry point → bootstrap → the function; metadata; Node 22, streamed", async () => {
    const code = await bundleFunction(payload, 'v2')
    const { zip, meta } = v2Zip(code)
    const files = unzip(zip)
    expect(Object.keys(files).sort()).toEqual(['___netlify-bootstrap.mjs', '___netlify-entry-point.mjs', '___netlify-metadata.json', 'site.mjs'])
    expect(files['___netlify-entry-point.mjs']).toBe("import * as bootstrap from './___netlify-bootstrap.mjs';export const handler = bootstrap.getLambdaHandler('./site.mjs')")
    expect(files['___netlify-bootstrap.mjs']).toContain('getLambdaHandler')
    const md = JSON.parse(files['___netlify-metadata.json'])
    expect(md).toEqual({ bootstrap_version: '2.29.1', branch: 'main', version: 1 })
    expect(meta).toEqual({ runtime: 'nodejs22.x', invocationMode: 'stream', buildData: { runtimeAPIVersion: 2, bootstrapVersion: '2.29.1' } })
    expect(files['site.mjs']).toContain('export {')                       // an ES module with a default export
    expect(files['site.mjs']).not.toContain('connectLambda(')             // no Lambda-style wiring in the current format
  })
  test('the Lambda-style bundle is still built as before (the default)', async () => {
    const code = await bundleFunction(payload)
    expect(code).toContain('connectLambda(')
    expect(code).toMatch(/export\s*\{[^}]*handler/)
  })
})

describe('the deploy names the format', () => {
  function fakeNetlify() {
    const calls: Array<{ method: string; url: string; body: any }> = []
    const fetch = async (url: string, init: any = {}) => {
      const m = init.method || 'GET', u = new URL(url)
      calls.push({ method: m, url: u.pathname + u.search, body: typeof init.body === 'string' ? JSON.parse(init.body) : null })
      if (m === 'POST' && /\/deploys$/.test(u.pathname)) return new Response(JSON.stringify({ id: 'dep-1', required: [], required_functions: [Object.values(JSON.parse(init.body).functions)[0]] }))
      if (m === 'GET' && /\/deploys\/dep-1$/.test(u.pathname)) return new Response(JSON.stringify({ state: 'ready' }))
      return new Response('{}')
    }
    return { calls, nl: new Netlify({ token: 't', team: 'twomiah', fetch: fetch as any, sleep: async () => {} }) }
  }
  test('current format: build_data in the deploy\'s functions_config, runtime nodejs22.x + invocation_mode stream on the upload', async () => {
    const { calls, nl } = fakeNetlify()
    await nl.deploy('site-1', {}, { site: new Uint8Array([1, 2, 3]) }, { functionMeta: { site: { runtime: 'nodejs22.x', invocationMode: 'stream', buildData: { runtimeAPIVersion: 2, bootstrapVersion: '2.29.1' } } } })
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.body.functions_config).toEqual({ site: { build_data: { runtimeAPIVersion: 2, bootstrapVersion: '2.29.1' } } })
    expect(calls.find((c) => c.method === 'PUT')!.url).toBe('/api/v1/deploys/dep-1/functions/site?runtime=nodejs22.x&invocation_mode=stream')
  })
  test('Lambda-style (no meta): exactly as before — runtime=js, no functions_config', async () => {
    const { calls, nl } = fakeNetlify()
    await nl.deploy('site-1', {}, { site: new Uint8Array([1, 2, 3]) })
    expect('functions_config' in calls.find((c) => c.method === 'POST')!.body).toBe(false)
    expect(calls.find((c) => c.method === 'PUT')!.url).toBe('/api/v1/deploys/dep-1/functions/site?runtime=js')
  })
})

describe('the switch', () => {
  test("unset: every site stays Lambda-style; a list names the sites to try; 'all' moves every site", () => {
    expect(functionFormatFor({}, 'row-1')).toBe('lambda')
    expect(functionFormatFor({ WEB_PRESENCE_FUNCTIONS_V2: '' }, 'row-1')).toBe('lambda')
    expect(functionFormatFor({ WEB_PRESENCE_FUNCTIONS_V2: 'row-2, row-1' }, 'row-1')).toBe('v2')
    expect(functionFormatFor({ WEB_PRESENCE_FUNCTIONS_V2: 'row-2' }, 'row-1')).toBe('lambda')
    expect(functionFormatFor({ WEB_PRESENCE_FUNCTIONS_V2: 'ALL' }, 'row-9')).toBe('v2')
  })
})

describe('the bundled current-format function, run', () => {
  // Two stand-ins for Netlify Blobs: the cached edge (still the OLD page) and the uncached address (the NEW one). A strong read must
  // come from the second.
  const edge = new Map<string, string>(), uncached = new Map<string, string>()
  const serve = (m: Map<string, string>) => Bun.serve({ port: 0, async fetch(req) {
    const key = new URL(req.url).pathname
    if (req.method === 'GET') return m.has(key) ? new Response(m.get(key)) : new Response(null, { status: 404 })
    if (req.method === 'PUT') { m.set(key, await req.text()); return new Response(null, { status: 200 }) }
    return new Response(null, { status: 405 })
  } })
  let a: ReturnType<typeof Bun.serve>, b: ReturnType<typeof Bun.serve>, dir = '', fn: (req: Request, ctx: any) => Promise<Response>
  beforeAll(async () => {
    a = serve(edge); b = serve(uncached)
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-v2-'))
    fs.writeFileSync(path.join(dir, 'site.mjs'), await bundleFunction(payload, 'v2'))
    process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: `http://localhost:${a.port}`, uncachedEdgeURL: `http://localhost:${b.port}`, siteID: 'nf-site-1', deployID: 'dep-1', token: 'tok' })).toString('base64')
    Object.assign(process.env, { WP_SITE_ID: 'row-1', WP_SECRET: 'b'.repeat(64), WP_FACTORY_URL: 'https://factory.invalid' })
    const loaded = (await import(path.join(dir, 'site.mjs'))).default
    fn = async (req, ctx) => { const before = globalThis.fetch; globalThis.fetch = Bun.fetch as any; try { return await loaded(req, ctx) } finally { globalThis.fetch = before } }
  }, 60_000)
  afterAll(() => { a?.stop(true); b?.stop(true); delete process.env.NETLIFY_BLOBS_CONTEXT; try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* temp */ } })

  test('a page is served by its path, read from the UNCACHED address (the latest save), and marked strong', async () => {
    for (const m of [edge, uncached]) for (const k of [...m.keys()]) m.delete(k)
    // Blobs keys are /<siteID>/<store>/<key>: put the old page at the cached edge and the new one at the uncached address.
    const key = (k: string) => `/nf-site-1/site:wp/${k}`
    edge.set(key('page'), '<p>OLD page</p>'); uncached.set(key('page'), '<p>NEW page</p>')
    const res = await fn(new Request('https://acme.netlify.app/'), { site: { id: 'nf-site-1' } })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<p>NEW page</p>')
    expect(res.headers.get('x-wp-read')).toBe('strong')
    expect(res.headers.get('netlify-cache-tag')).toBe('wp-page')
  })
  test('the privacy page by its path; nothing stored yet = the page it was deployed with', async () => {
    for (const m of [edge, uncached]) for (const k of [...m.keys()]) m.delete(k)
    expect(await (await fn(new Request('https://acme.netlify.app/privacy'), { site: { id: 'nf-site-1' } })).text()).toBe('<p>privacy</p>')
    expect(await (await fn(new Request('https://acme.netlify.app/'), { site: { id: 'nf-site-1' } })).text()).toBe('<p>first page</p>')
  })
})
