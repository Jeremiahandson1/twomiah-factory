// Building what one Web presence site is made of, and putting it on its Netlify site.
//
//   static files   styles, fonts and library photos the page points at; the sitemap / robots / llms; the editor (/edit/);
//                  forms.html (the two forms, so Netlify Forms knows them); _redirects and _headers
//   one function   "site": serves the page and privacy page from the site's Blobs, signs the owner in, saves, stores photos and
//                  takes the forms (site/handler.mjs). Bundled with @netlify/blobs into a single file and zipped.
//
// There is NO index.html: the page is the function's, so an edit (saved to Blobs) shows with no deploy. The first version of the
// page rides inside the function bundle, and is what Blobs serves until the owner's first save.
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zip } from './zip.ts'
import type { OnePageOutput } from '../../../unified/server/site/onePage.ts'
import type { SiteSpec } from './spec.ts'
import { ROUTES } from './site/routes.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SITE_DIR = join(HERE, 'site')
const API_DIR = join(HERE, '..', '..')
// @netlify/blobs is declared by apps/unified (the Factory's own package.json is fenced), so the bundler is told where to find it.
const BLOBS_FROM = join(API_DIR, '..', 'unified')
const PUBLIC_DIR = join(HERE, '..', '..', '..', '..', 'unified', 'site', 'public')
const HERO_DIR = join(HERE, '..', '..', 'assets', 'hero-library')

export const FUNCTION_NAME = 'site'

/** The redirects: every dynamic address goes to the one function; each is spelled out (no pattern a host could read differently).
 *  The function tells them apart by the path (site/routes.mjs) — Netlify drops a query a rewrite rule adds. */
export function redirectsFile(): string {
  return Object.keys(ROUTES).map((from) => `${from.padEnd(18)} /.netlify/functions/${FUNCTION_NAME} 200`).join('\n') + '\n/edit              /edit/              301\n'
}

/** Headers for the static files. (The function sets its own on what it serves.) */
export function headersFile(): string {
  return [
    '/*', '  X-Content-Type-Options: nosniff', '  Referrer-Policy: strict-origin-when-cross-origin', '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '/styles/*', '  Cache-Control: public, max-age=31536000, immutable',
    '/fonts/*', '  Cache-Control: public, max-age=31536000, immutable',
    '/hero-library/*', '  Cache-Control: public, max-age=31536000, immutable',
    '/edit/*', '  Cache-Control: no-store', '  X-Robots-Tag: noindex, nofollow', '  X-Frame-Options: DENY',
    "  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    '/forms.html', '  X-Robots-Tag: noindex, nofollow',
  ].join('\n') + '\n'
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
/**
 * forms.html: the forms exactly as Netlify Forms must see them in a deploy (it finds forms in the deployed HTML). The page's own
 * forms post to /api/leads and /api/apply (the function checks them and passes them on); this file is how Netlify learns the
 * two form names and their fields. It is never linked and is not indexed.
 */
export function formsHtml(resumeExtraFields: number = 2): string {
  const extras = Array.from({ length: resumeExtraFields }, (_, i) => `<input name="extra${i + 1}">`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Forms</title></head><body>
<form name="lead" method="post" netlify netlify-honeypot="bot-field" hidden><input name="bot-field"><input name="name"><input name="email"><input name="phone"><textarea name="message"></textarea>${extras}</form>
<form name="apply" method="post" enctype="multipart/form-data" netlify netlify-honeypot="bot-field" hidden><input name="bot-field"><input name="name"><input name="email"><input name="phone"><textarea name="about"></textarea><input name="availability"><input name="job"><input type="file" name="resume"></form>
</body></html>\n`
}

/** The function's source bundle: handler + entry + the first page, model and spec, as one file. Cached by content. */
const bundleCache = new Map<string, string>()
export async function bundleFunction(payload: { index: string; privacy: string; model: unknown; spec: unknown }): Promise<string> {
  const payloadSrc = `export const INITIAL = ${JSON.stringify({ index: payload.index, privacy: payload.privacy, model: payload.model })};\nexport const SPEC = ${JSON.stringify(payload.spec)};\n`
  const key = String(Bun.hash(payloadSrc)) + ':' + String(Bun.hash(['handler', 'entry', 'lambda', 'clean', 'shapes', 'session'].map((f) => readFileSync(join(SITE_DIR, f + '.mjs'), 'utf8')).join('\n')))
  const hit = bundleCache.get(key)
  if (hit) return hit
  // The generated payload is written to a temp file and `./payload.mjs` is resolved to it. It was a virtual file
  // (Bun.build `files`), which the Bun the Factory runs on (1.3.4, Render's default) does not have: every live set-up failed
  // "Bundle failed — Could not resolve: ./payload.mjs" (10/30), while 1.4 on a laptop bundled it. A file works on any Bun.
  const payloadFile = join(tmpdir(), `wp-payload-${randomBytes(8).toString('hex')}.mjs`)
  writeFileSync(payloadFile, payloadSrc)
  let out: Awaited<ReturnType<typeof Bun.build>>
  try {
    out = await Bun.build({
      entrypoints: [join(SITE_DIR, 'entry.mjs')],
      plugins: [{ name: 'site-payload', setup(b) {
        b.onResolve({ filter: /^\.\/payload\.mjs$/ }, () => ({ path: payloadFile }))
        b.onResolve({ filter: /^@netlify\/blobs$/ }, () => ({ path: Bun.resolveSync('@netlify/blobs', BLOBS_FROM) }))
      } }],
      target: 'node', format: 'esm', minify: false, external: [],
    })
  } catch (e: any) {
    // Bun throws "Bundle failed" with the reasons in `errors`: say them (the alert said only "Bundle failed").
    throw new Error('The site function could not be bundled: ' + [e?.message, ...(e?.errors || []).map((x: any) => x?.message || String(x))].filter(Boolean).join('; '))
  } finally { try { unlinkSync(payloadFile) } catch { /* already gone */ } }
  if (!out.success || !out.outputs.length) throw new Error('The site function could not be bundled: ' + out.logs.map(String).join('; '))
  const code = await out.outputs[0].text()
  bundleCache.set(key, code)
  if (bundleCache.size > 20) bundleCache.delete(bundleCache.keys().next().value as string)
  return code
}

export interface SiteFiles { files: Record<string, string | Uint8Array>; functions: Record<string, Uint8Array> }

/** Everything one deploy carries. */
export async function buildSiteFiles(rendered: OnePageOutput, spec: SiteSpec): Promise<SiteFiles> {
  const files: Record<string, string | Uint8Array> = {}
  for (const [p, c] of Object.entries(rendered.files)) {
    if (p === 'index.html' || p === 'privacy/index.html') continue   // these two are the function's
    files[p] = c
  }
  for (const a of rendered.assets) {
    const src = a.startsWith('hero-library/') ? join(HERO_DIR, a.slice('hero-library/'.length)) : join(PUBLIC_DIR, a)
    if (existsSync(src)) files[a] = readFileSync(src)
  }
  files['edit/index.html'] = readFileSync(join(SITE_DIR, 'editor.html'), 'utf8')
  files['forms.html'] = formsHtml()
  files['_redirects'] = redirectsFile()
  files['_headers'] = headersFile()
  const code = await bundleFunction({ index: rendered.files['index.html'], privacy: rendered.files['privacy/index.html'], model: rendered.model, spec })
  return { files, functions: { [FUNCTION_NAME]: zip({ [FUNCTION_NAME + '.mjs']: code }) } }
}
