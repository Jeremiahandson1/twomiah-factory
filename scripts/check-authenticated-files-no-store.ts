// CI guard: a route that serves a private file behind authentication must not let the browser keep it.
//
// GET /api/documents/file/* answered `Cache-Control: private, max-age=86400`. So the browser held the
// file for a day and served it again from its OWN cache, without the credentials this route checks.
// The report proved it: fetch a document with a token, then fetch it again with none, and the file
// came back. On a shared office machine the next person to sit down can open it from history after
// the first has signed out. (T32 M12)
//
// `private` is not enough. It stops a shared proxy caching the response and explicitly PERMITS the
// browser doing so, which is the cache that matters here. `Vary: Authorization` would cover a
// header-authenticated fetch and not a URL opened in a tab — which is how a preview or a download
// link actually gets used.
//
// WHY A GUARD AND NOT A TEST
// --------------------------
// These routes read bytes from R2, which is unconfigured in a sandbox, so a behavioural test could
// only ever assert the handler's source. That is this file's job. And the report found ONE of the two
// sites — the photo route carried the identical header and was missed only because nobody fetched a
// site photo twice, which is precisely how a finding comes back next round.
//
//   bun scripts/check-authenticated-files-no-store.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
// A string-aware stripper: this guard reads files/documents.ts, whose `'/file/*'` route pattern the
// one-line regex version reads as a comment opener. See scripts/lib/stripComments.ts.
import { stripSource } from './lib/stripComments.ts'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0, checked = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

/** Every .ts under a directory. */
const walk = (rel: string): string[] => {
  const out: string[] = []
  const stack = [rel]
  while (stack.length) {
    const d = stack.pop()!
    let entries: string[] = []
    try { entries = readdirSync(ROOT + d) } catch { continue }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue
      const p = `${d}/${e}`
      let isDir = false
      try { isDir = statSync(ROOT + p).isDirectory() } catch { continue }
      if (isDir) stack.push(p)
      else if (e.endsWith('.ts') || e.endsWith('.tsx')) out.push(p)
    }
  }
  return out
}

/**
 * THREE THINGS THAT LOOK THE SAME AND ARE NOT. The first draft of this guard lit up 74 times because
 * it could not tell them apart:
 *
 *  1. A Cache-Control RESPONSE header on a route behind `authenticate` — the fault. The browser is
 *     allowed to replay it without the credentials the route checks.
 *  2. The same header on a PUBLIC media proxy (`public, max-age=31536000, immutable`, hashed keys,
 *     no authenticate anywhere in the file). Correct, wanted, and ~60 of the 74.
 *  3. `CacheControl:` on a PutObjectCommand — metadata on the stored object for the CDN, not a
 *     response header at all.
 *
 * The discriminator is authentication: a module that mounts `authenticate` or gates on
 * `requirePermission` is serving somebody's private file. A public proxy has neither.
 */
const SERVES_STORED_OBJECTS = /getObject\s*\(/
const IS_AUTHENTICATED = /\bauthenticate\b|\brequirePermission\s*\(/
/** The response header, with a dash and in quotes — never the `CacheControl` object property. */
const CACHEABLE = /['"]Cache-Control['"]\s*[,:]\s*['"][^'"]*max-age=\s*(\d+)/g

const roots = ['packages/tenant-backend/src', 'templates']
for (const root of roots) {
  for (const rel of walk(root)) {
    let src = ''
    try { src = readFileSync(ROOT + rel, 'utf8').replace(/\r\n/g, '\n') } catch { continue }
    if (!SERVES_STORED_OBJECTS.test(src)) continue
    // The vendored copy of a shared module is generated; reporting it as well as its source doubles
    // every message and sends people to edit a file that gets overwritten.
    if (/\/src\/shared\//.test(rel)) continue
    const code = stripSource(src)
    // Counted here, BEFORE the header test: a module that correctly says no-store sets no max-age and
    // would otherwise not be counted at all, which made the total read "1" and left the gone-blind
    // check below unable to tell "nothing to flag" from "found nothing".
    if (IS_AUTHENTICATED.test(code)) checked++
    const headers = [...code.matchAll(CACHEABLE)]
    if (!headers.length) continue               // sets no Cache-Control response header at all

    /**
     * PER FUNCTION, not per file. `createMediaRoutes` is a genuinely public proxy — no authenticate,
     * hashed `photos/` keys, `public, max-age=31536000, immutable`, all correct — and it lives in
     * jobs.ts next to the authenticated job routes. Judging the file flagged it, which would have
     * meant either a false failure forever or an exemption that also blinds the guard to the real
     * routes in the same file.
     */
    const bounds: number[] = [0]
    for (const m of code.matchAll(/^export (?:async )?function /gm)) bounds.push(m.index!)
    bounds.push(code.length)
    const blockFor = (at: number) => {
      let lo = 0, hi = code.length
      for (let i = 0; i < bounds.length - 1; i++) {
        if (at >= bounds[i] && at < bounds[i + 1]) { lo = bounds[i]; hi = bounds[i + 1]; break }
      }
      return code.slice(lo, hi)
    }

    for (const m of headers) {
      const seconds = Number(m[1])
      if (seconds <= 0) continue
      if (!IS_AUTHENTICATED.test(blockFor(m.index!))) continue  // public proxy — a long cache is right
      fail(`${rel} serves private files behind authentication and sets Cache-Control max-age=${seconds} — the browser will replay it without credentials, which is how a document survives sign-out on a shared machine. Use no-store.`)
    }
  }
}

if (!checked) fail('no authenticated file route was found — this guard has gone blind (did getObject get renamed?)')

console.log(failed
  ? `authenticated files no-store: ${failed} check(s) FAILED`
  : `authenticated files no-store: ${checked} module(s) serving private files, none cacheable by the browser`)
process.exit(failed ? 1 : 0)
