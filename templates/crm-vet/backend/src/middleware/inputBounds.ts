import type { Context, Next } from 'hono'

// Hard ceiling on any single text field in a JSON write body. Prevents a
// 10,000+ char "name" (which breaks table layout downstream) and unbounded input
// generally. Free-text notes get more headroom via MAX_LONG.
const MAX_LONG = parseInt(process.env.MAX_INPUT_STRING || '') || 20000

/**
 * Neutralize stored-XSS vectors while leaving ordinary text (including a benign
 * "<" as in "weight < 5kg") intact. We strip the dangerous tags/attributes rather
 * than all HTML, so notes/descriptions aren't mangled but a stored <script> can't
 * later execute on a non-React surface (email, PDF). The UI already escapes on
 * render; this is the server-side belt-and-suspenders.
 */
export function neutralizeHtml(s: string): string {
  return s
    // paired dangerous elements incl. their contents
    .replace(/<\s*(script|iframe|object|embed|style|link|meta|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    // stray/self-closing dangerous elements
    .replace(/<\s*\/?\s*(script|iframe|object|embed|style|link|meta|svg|math)\b[^>]*>/gi, '')
    // inline event handlers: onload=, onerror=, onclick=, ...
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // javascript:/data: URIs in href/src-like values
    .replace(/javascript\s*:/gi, '')
}

// Walk a JSON body: return true if any string exceeds MAX_LONG; otherwise mutate
// each string in place to neutralize dangerous HTML.
function boundAndSanitize(obj: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const v = obj[i]
      if (typeof v === 'string') { if (v.length > MAX_LONG) return true; obj[i] = neutralizeHtml(v) }
      else if (v && typeof v === 'object') { if (boundAndSanitize(v, depth + 1)) return true }
    }
  } else if (obj && typeof obj === 'object') {
    const rec = obj as Record<string, unknown>
    for (const k of Object.keys(rec)) {
      const v = rec[k]
      if (typeof v === 'string') { if (v.length > MAX_LONG) return true; rec[k] = neutralizeHtml(v) }
      else if (v && typeof v === 'object') { if (boundAndSanitize(v, depth + 1)) return true }
    }
  }
  return false
}

/**
 * On every JSON write: reject a body with a string longer than MAX_LONG, and strip
 * dangerous HTML from every string field. Applies only to JSON requests (multipart
 * uploads are handled by the file validator). Hono caches the parsed body, so
 * downstream handlers read the sanitized object.
 */
export async function boundInputLengths(c: Context, next: Next) {
  const method = c.req.method
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const ct = c.req.header('content-type') || ''
    if (ct.includes('application/json')) {
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        // Malformed/empty body — let the route handle it.
        return next()
      }
      if (boundAndSanitize(body)) {
        return c.json({ error: `A text field exceeds the ${MAX_LONG.toLocaleString()}-character limit.` }, 400)
      }
    }
  }
  await next()
}
