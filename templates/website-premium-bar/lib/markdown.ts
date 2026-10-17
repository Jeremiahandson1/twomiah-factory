/**
 * lib/markdown.ts — tiny markdown → HTML converter (headings, paragraphs,
 * lists, links, bold/italic, code, blockquotes, images). Used for blog
 * posts, timeline entries, and menu-item stories. Partials receive it as
 * the `md` local. Kept dependency-free on purpose.
 */
import { isSafeUrl } from './security'

export function markdownToHtml(md: string): string {
  if (!md) return ''
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let inList = false, listTag: 'ul' | 'ol' = 'ul'
  let inBlockquote = false
  let inCode = false, codeLang = ''
  for (let raw of lines) {
    // Fenced code block
    const fence = raw.match(/^```(\w*)\s*$/)
    if (fence) {
      if (inCode) { out.push('</code></pre>'); inCode = false } else { codeLang = fence[1] || ''; out.push('<pre><code' + (codeLang ? ' class="lang-' + codeLang + '"' : '') + '>'); inCode = true }
      continue
    }
    if (inCode) { out.push(escape(raw)); continue }
    let line = raw
    // Headings
    const h = line.match(/^(#{1,6})\s+(.+)$/)
    if (h) { if (inList) { out.push('</' + listTag + '>'); inList = false } if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false } out.push('<h' + h[1].length + '>' + inlineMd(escape(h[2])) + '</h' + h[1].length + '>'); continue }
    // List items
    const ul = line.match(/^\s*[-*]\s+(.+)$/)
    const ol = line.match(/^\s*\d+\.\s+(.+)$/)
    if (ul || ol) {
      const targetTag: 'ul' | 'ol' = ul ? 'ul' : 'ol'
      if (!inList || listTag !== targetTag) { if (inList) out.push('</' + listTag + '>'); listTag = targetTag; out.push('<' + listTag + '>'); inList = true }
      out.push('<li>' + inlineMd(escape((ul || ol)![1])) + '</li>')
      continue
    } else if (inList) { out.push('</' + listTag + '>'); inList = false }
    // Blockquote
    if (line.match(/^>\s?(.*)$/)) {
      const bq = line.match(/^>\s?(.*)$/)![1]
      if (!inBlockquote) { out.push('<blockquote>'); inBlockquote = true }
      out.push('<p>' + inlineMd(escape(bq)) + '</p>')
      continue
    } else if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false }
    // Image: ![alt](url) — scheme-validate the URL so data:/javascript: can't sneak in
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/)
    if (img) {
      const rawUrl = img[2]
      if (isSafeUrl(rawUrl) && /^(https?:|\/)/i.test(rawUrl)) {
        out.push('<p><img src="' + escape(rawUrl) + '" alt="' + escape(img[1]) + '" loading="lazy"></p>')
      }
      continue
    }
    // Blank line
    if (line.trim() === '') { continue }
    // Paragraph
    out.push('<p>' + inlineMd(escape(line)) + '</p>')
  }
  if (inList) out.push('</' + listTag + '>')
  if (inBlockquote) out.push('</blockquote>')
  if (inCode) out.push('</code></pre>')
  return out.join('\n')
}

export function inlineMd(s: string): string {
  // Order matters — bold before italic. Links are scheme-validated to
  // strip javascript:/data:/vbscript: payloads even though body text is
  // already HTML-escaped upstream (defense in depth).
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
      const safe = isSafeUrl(href) ? href : '#'
      const external = /^https?:/i.test(safe)
      const attrs = external ? ' rel="noopener noreferrer" target="_blank"' : ''
      return '<a href="' + safe + '"' + attrs + '>' + text + '</a>'
    })
}
