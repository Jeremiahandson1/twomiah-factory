// THE HTML A MARKETING EMAIL MAY CARRY — one allow-list, applied where an email body is SAVED (a campaign, a template, a
// drip step), whoever wrote it: the visual editor, the HTML view, or a request made by hand.
//
// Salon live test, 2026-10-25: the campaign body was a raw HTML box, and the only cleaning on the way in was a regex
// that took out <script> blocks — an onerror= on an image, a javascript: link or an <iframe> went through to every
// customer's inbox as written. The editor that replaces the box produces ordinary markup (headings, paragraphs, bold,
// links, lists, an image, a button), but the server cannot trust where a body came from, so this decides.
//
// HOW: a small tokenizer, no DOM and no dependency (this file is vendored into every template's backend as ../shared).
// Everything it emits it has parsed to a strict shape — text with no `<` in it, tags from the list below with only the
// attributes allowed on them, every value double-quoted. Anything it cannot read to that shape is dropped or shown as
// text (`&lt;`), never passed through: dropping too much is safe, emitting something a browser parses differently is not.
//
//   · no script, no event handlers (on…=), no frames, objects, forms, SVG or MathML (dropped with what is inside them);
//   · a link goes to http(s) — or mailto:/tel:, which are an email's own kinds of link and run nothing; an image loads
//     from http(s) only. Any other scheme (javascript:, data:, vbscript:, a relative path an inbox cannot resolve) loses
//     the attribute; an image without a usable src is dropped;
//   · style="" and <style> blocks stay (an email's layout lives there) unless they could run or fetch something:
//     expression(), javascript:, behaviors/bindings, @import, CSS escapes, or url() that is not http(s);
//   · comments are dropped — Outlook's <!--[if mso]> blocks are markup the browser never checks.
//
// A tag already in the allowed shape is kept byte for byte, so an ordinary body — and every email saved before this —
// comes back unchanged, and running it twice changes nothing. Merge fields ({{firstName}}) are text and pass through.

/** Elements kept, with the attributes below. Layout tags (table…) stay because emails built before the editor use them. */
const KEEP = new Set([
  'a', 'abbr', 'address', 'article', 'b', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup',
  'dd', 'del', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'font', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'i', 'img', 'ins', 'li', 'main', 'mark', 'ol', 'p', 'pre', 'q', 's', 'section', 'small', 'span',
  'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
])
/** Elements dropped together with everything inside them: what they hold is code, or text no one meant as the email. */
const DROP_WITH_CONTENT = new Set([
  // (embed, frame: no content and no end tag — they are dropped as tags, below, like meta and input)
  'script', 'iframe', 'frameset', 'object', 'applet', 'noscript', 'noembed', 'noframes', 'template',
  'title', 'textarea', 'select', 'svg', 'math', 'xmp', 'plaintext', 'canvas', 'audio', 'video',
])
/** Attributes allowed on any kept element (presentation only). */
const ATTRS = new Set([
  'style', 'class', 'id', 'title', 'dir', 'lang', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'face', 'size',
  'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'span', 'nowrap', 'start', 'type', 'role', 'alt',
])
/** Attributes allowed on one element only. */
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel', 'name']),
  img: new Set(['src']),
}
/** A link's own schemes: the web, an email address, a phone number. Checked on the text as written, before entities. */
const LINK = /^(https?:\/\/|mailto:|tel:)/i
const IMAGE = /^https?:\/\//i

// A start tag in the one shape this file reads: a name, then attributes separated by whitespace, each optionally `=`
// a double-quoted, single-quoted or plain value. Anything else after `<` is not read as a tag (it is shown as text).
const START_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y
const ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const END_TAG = /<\/([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/y

const NAMED: Record<string, string> = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', colon: ':', lpar: '(', rpar: ')', bsol: '\\', sol: '/', tab: '\t', newline: '\n', nbsp: ' ' }
/** Entities decoded for the CSS check; null when a named entity we do not know is left (it could hide anything). */
function decodeForCheck(s: string): string | null {
  const out = s
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_m, d) => String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
  return /&[a-z0-9]+;/i.test(out) ? null : out
}

/** CSS that runs nothing and fetches nothing but http(s). Applied to style="" values and <style> blocks. */
export function isSafeCss(css: string): boolean {
  const decoded = decodeForCheck(css)
  if (decoded === null) return false
  if (decoded.includes('\\')) return false // a CSS escape can spell any of the words below
  const flat = decoded.replace(/\/\*[\s\S]*?\*\//g, '').replace(/[\s\u0000-\u001f]+/g, '').toLowerCase()
  if (/expression\(|javascript:|vbscript:|behavior:|-moz-binding|@import/.test(flat)) return false
  for (const m of flat.matchAll(/url\(([^)]*)\)/g)) if (!/^["']?https?:\/\//.test(m[1])) return false
  return true
}

const quoteValue = (v: string) => v.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The kept form of one start tag, or null to drop it. `raw` is returned untouched when it is already that form. */
function cleanStartTag(name: string, rawAttrs: string, selfClosing: string, raw: string): string | null {
  const own = TAG_ATTRS[name]
  const kept: Array<[string, string | null]> = []
  const seen = new Set<string>()
  let untouched = true
  for (const m of rawAttrs.matchAll(ATTR)) {
    const attr = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? null
    // A browser keeps the first of two same-named attributes; so does this, and rewrites the tag.
    if (seen.has(attr)) { untouched = false; continue }
    seen.add(attr)
    if (m[2] === undefined && value !== null) untouched = false // single-quoted or plain: rewritten double-quoted
    let ok = ATTRS.has(attr) || !!own?.has(attr)
    if (ok && attr === 'href') ok = value !== null && LINK.test(value.trim())
    if (ok && attr === 'src') ok = value !== null && IMAGE.test(value.trim())
    if (ok && attr === 'style') ok = value !== null && isSafeCss(value)
    if (ok && attr === 'target') ok = value === '_blank'
    if (!ok) { untouched = false; continue }
    kept.push([attr, value])
  }
  if (name === 'img' && !kept.some(([a]) => a === 'src')) return null
  if (untouched && raw === raw.replace(/<([a-zA-Z][a-zA-Z0-9-]*)/, (_m, n) => '<' + n.toLowerCase())) return raw
  const attrs = kept.map(([a, v]) => (v === null ? ` ${a}` : ` ${a}="${quoteValue(v)}"`)).join('')
  return `<${name}${attrs}${selfClosing ? ' /' : ''}>`
}

/** Where `</name …>` starts and ends from `from`; null when the element is never closed. */
function closeTag(html: string, name: string, from: number): { start: number; end: number } | null {
  const re = new RegExp(`</${name}\\b[^>]*>`, 'gi')
  re.lastIndex = from
  const m = re.exec(html)
  return m ? { start: m.index, end: m.index + m[0].length } : null
}

/** An email body reduced to the allowed HTML. Idempotent: sanitizeEmailHtml(sanitizeEmailHtml(x)) === sanitizeEmailHtml(x). */
export function sanitizeEmailHtml(input: string | null | undefined): string {
  const html = String(input ?? '')
  let out = ''
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) { out += html.slice(i); break }
    out += html.slice(i, lt)
    i = lt
    if (html.startsWith('<!--', i)) { const end = html.indexOf('-->', i + 4); i = end === -1 ? html.length : end + 3; continue }
    const next = html[i + 1] || ''
    if (next === '/') {
      END_TAG.lastIndex = i
      const m = END_TAG.exec(html)
      if (m) { const name = m[1].toLowerCase(); if (KEEP.has(name)) out += `</${name}>`; i += m[0].length; continue }
      // `</ x>`, `</>`: a browser reads these as a comment — dropped up to its `>`.
      const gt = html.indexOf('>', i); if (gt === -1) { out += '&lt;'; i++ } else i = gt + 1
      continue
    }
    if (next === '!' || next === '?') { const gt = html.indexOf('>', i); i = gt === -1 ? html.length : gt + 1; continue }
    if (!/[a-zA-Z]/.test(next)) { out += '&lt;'; i++; continue }
    START_TAG.lastIndex = i
    const m = START_TAG.exec(html)
    if (!m) { out += '&lt;'; i++; continue }
    const [raw, rawName, rawAttrs, selfClosing] = m
    const name = rawName.toLowerCase()
    i += raw.length
    if (name === 'style') {
      const close = closeTag(html, 'style', i)
      if (!close) { i = html.length; continue }
      const css = html.slice(i, close.start)
      if (isSafeCss(css)) out += `<style>${css}</style>`
      i = close.end
      continue
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (name === 'plaintext') { i = html.length; continue }
      i = closeTag(html, name, i)?.end ?? html.length
      continue
    }
    // html, head, body, form, button, input, meta, link …: the tag goes, what it holds is read on (a full page's
    // <head><style> keeps its style; its <title> and <meta> go).
    if (!KEEP.has(name)) continue
    const kept = cleanStartTag(name, rawAttrs, selfClosing, raw)
    if (kept) out += kept
  }
  return out
}
