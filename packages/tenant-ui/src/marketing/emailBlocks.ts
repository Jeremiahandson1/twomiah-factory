// What the email editor puts into an email, and how it decides what it can edit — no DOM here, so a test reads the
// exact markup the toolbar inserts (and that the server's allow-list, tenant-backend marketing/emailHtml.ts, keeps it
// as written). Salon live test, 2026-10-25: the campaign body was a raw HTML box; EmailEditor.tsx replaces it.
import type { MergeField } from './marketingCopy'

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The tags the visual editor writes and can edit back without changing them. A body with anything else — a table
 * layout, a <style> block, a whole page, an Outlook comment — was written as HTML: it opens in the HTML view and sends
 * exactly as written, unless the owner chooses to edit it visually.
 */
const VISUAL_TAGS = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'img', 'div', 'span', 'blockquote', 'hr'])
export function editsVisually(html: string): boolean {
  if (/<!--|<!doctype|<\?/i.test(html)) return false
  for (const m of String(html).matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)) if (!VISUAL_TAGS.has(m[1].toLowerCase())) return false
  return true
}

/**
 * Where a link may go, from what the owner typed: a web address (a bare "example.com" becomes https://), an email
 * address (mailto:) or a phone number written tel:. null for anything else — javascript:, data: — which the server
 * would strip anyway.
 */
export function linkHref(raw: string): string | null {
  const v = String(raw || '').trim()
  if (!v) return null
  if (/^(https?:\/\/|mailto:|tel:)\S+$/i.test(v)) return v
  if (/^[^\s@:/]+@[^\s@:/]+\.[^\s@:/]+$/.test(v)) return 'mailto:' + v
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null
  if (/^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(v)) return 'https://' + v
  return null
}

/**
 * An image's address an inbox can load: the photo library hands out '/media/…', which means nothing in someone's mail,
 * so it is made absolute against this app's own address. Only http(s).
 */
export function imageSrc(raw: string, origin: string): string | null {
  const v = String(raw || '').trim()
  if (!v) return null
  try {
    const u = new URL(v, origin)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch { return null }
}

export const linkHtml = (text: string, href: string) => `<a href="${esc(href)}">${esc(text)}</a>`
export const imageHtml = (src: string, alt = '') => `<img src="${esc(src)}" alt="${esc(alt)}" style="max-width:100%;height:auto;">`
/** A button is a link drawn as one, inline-styled: the only styling every inbox keeps. */
export const buttonHtml = (text: string, href: string, colour: string) =>
  `<p><a href="${esc(href)}" style="display:inline-block;padding:12px 24px;background-color:${colour};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">${esc(text)}</a></p>`

/**
 * The editor's own output, tidied: an editor left empty holds `<p><br></p>`, which is not a body.
 */
export function editorOutput(innerHtml: string): string {
  const html = String(innerHtml || '').trim()
  return /^(<(p|div)>)?(<br\s*\/?>)?(<\/(p|div)>)?$/i.test(html) ? '' : html
}

/**
 * How an email reads in an inbox that has no styles of its own: the editor and the preview both draw it this way. Only
 * what a mail client would itself default to. In a browser run of the editor, a size set here was copied onto every
 * block it inserted (font-size: 15px on each image), and a rule here for images made it DROP the image's own
 * max-width:100% as redundant — which the inbox, without this sheet, needs. So neither is set here.
 */
const EMAIL_CSS = 'html{background:#ffffff}body{margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;background:#ffffff;word-wrap:break-word}'

/** The editing surface: an empty page in the email's look, filled by EmailEditor once it loads. */
export const editorDoc = () => `<!doctype html><html><head><meta charset="utf-8"><style>${EMAIL_CSS}body{min-height:calc(100% - 32px)}body:focus{outline:none}</style></head><body></body></html>`

const MERGE_TOKEN = /\{\{\s*([A-Za-z_]\w*)\s*\}\}|\{\s*([A-Za-z_]\w*)\s*\}/g
/**
 * The preview: the body with the merge fields filled from a sample person, in the email's look. The frame that shows it
 * runs nothing (sandbox), so a body written as HTML is shown as it is, never executed in the app.
 */
export function previewDoc(body: string, sample: Record<string, string>, fields: MergeField[]): string {
  const known = new Map(fields.map((f) => [f.key.toLowerCase(), f.key]))
  const filled = String(body || '').replace(MERGE_TOKEN, (whole, a, b) => {
    const key = known.get(String(a ?? b).toLowerCase())
    return key ? esc(sample[key] ?? '') : whole
  })
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>${EMAIL_CSS}</style></head><body>${filled}</body></html>`
}
/** The subject line as the sample person would read it. */
export function previewSubject(subject: string, sample: Record<string, string>, fields: MergeField[]): string {
  const known = new Map(fields.map((f) => [f.key.toLowerCase(), f.key]))
  return String(subject || '').replace(MERGE_TOKEN, (whole, a, b) => { const key = known.get(String(a ?? b).toLowerCase()); return key ? sample[key] ?? '' : whole })
}
