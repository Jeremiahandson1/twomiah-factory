// Input/output hygiene for free-text fields (QA F-09: product/customer names stored
// raw `<img onerror=…>` / `<script>` markup verbatim). React escapes on render, but the
// receipt HTML, label PDFs, emails and CSV exports are NOT React — so strip markup on
// the way IN and escape on every non-React way OUT.

/** Remove HTML tags/comments and collapse whitespace. Keeps plain apostrophes/ampersands. */
export function stripHtml(value: string): string {
  return String(value)
    // script/style blocks go WITH their contents — `<script>alert(1)</script>` must not
    // survive as the name "alert(1)".
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/<\/?[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Escape a value for interpolation into HTML (receipts, labels, emails). */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escape a CSV cell (quotes, delimiters, newlines, and formula-injection prefixes). */
export function escapeCsv(value: unknown): string {
  let s = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}
