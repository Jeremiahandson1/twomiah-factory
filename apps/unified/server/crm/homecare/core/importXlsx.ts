// An Excel workbook (.xlsx) as a header row and rows of text (row 9, docs/parity/homecare-import.md), read without a
// library: the workbook is a zip of XML parts (importZip.ts). Shared strings, inline strings, numbers, booleans and
// dates are read; a cell styled as a date comes out as year-month-day, so Excel's date serials never reach the date
// cleaner as numbers. Formulas give their last computed value. Pure.
import { readZip, looksLikeZip } from './importZip.ts'

export interface Workbook { sheets: Array<{ name: string; rows: string[][] }> }

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const attr = (tag: string, name: string): string | null => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? unescape(m[1]) : null }
const text = (xml: string) => unescape(xml.replace(/<[^>]+>/g, ''))

/** Column letters → 0-based index: A → 0, Z → 25, AA → 26. */
export function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase()
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** An Excel date serial (days since 1899-12-30) as year-month-day, with the time when it has one. */
export function serialToDate(serial: number, withTime: boolean): string {
  const ms = Math.round((serial - 25569) * 86_400_000)
  const d = new Date(ms)
  const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  if (!withTime) return ymd
  return `${ymd} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

const BUILT_IN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])
const BUILT_IN_TIME_ONLY = new Set([18, 19, 20, 21, 45, 46, 47])

/** Is this number format a date (or a time)? Custom formats are read for d, m, y and h outside quoted text and [colour] tags. */
export function isDateFormat(code: string): { date: boolean; timeOnly: boolean } {
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '').toLowerCase()
  const hasDay = /d/.test(bare), hasYear = /y/.test(bare), hasMonth = /m/.test(bare), hasHour = /h/.test(bare)
  const date = hasDay || hasYear || (hasMonth && hasHour) || (hasMonth && !/[#0]/.test(bare))
  return { date: date || hasHour, timeOnly: hasHour && !hasDay && !hasYear }
}

/** Which cell styles (by index into cellXfs) are dates, from styles.xml. */
function dateStyles(stylesXml: string | null): Map<number, { timeOnly: boolean }> {
  const out = new Map<number, { timeOnly: boolean }>()
  if (!stylesXml) return out
  const custom = new Map<number, string>()
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*\/?>/g)) {
    const id = Number(attr(m[0], 'numFmtId')), code = attr(m[0], 'formatCode')
    if (Number.isInteger(id) && code !== null) custom.set(id, code)
  }
  const xfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)
  if (!xfs) return out
  let i = 0
  for (const m of xfs[1].matchAll(/<xf\b[^>]*\/?>/g)) {
    const id = Number(attr(m[0], 'numFmtId') ?? '0')
    if (BUILT_IN_DATE.has(id)) out.set(i, { timeOnly: BUILT_IN_TIME_ONLY.has(id) })
    else if (custom.has(id)) { const f = isDateFormat(custom.get(id)!); if (f.date) out.set(i, { timeOnly: f.timeOnly }) }
    i++
  }
  return out
}

/** A number as Excel shows it in General format: no trailing zeros, no exponent for the sizes a sheet holds. */
function numberText(v: string): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toPrecision(15)))
}

/** The workbook's sheets, or a plain-English problem. Only the cells that hold something are read; empty rows are dropped. */
export function readXlsx(buf: Buffer): Workbook | { problem: string; code: string } {
  if (!looksLikeZip(buf)) return { problem: 'That is not an Excel (.xlsx) file. Save the sheet as .xlsx or .csv and try again.', code: 'bad_xlsx' }
  const entries = readZip(buf)
  if ('problem' in entries) return { problem: 'That is not an Excel (.xlsx) file. Save the sheet as .xlsx or .csv and try again.', code: 'bad_xlsx' }
  const part = (name: string) => { const e = entries.find((x) => x.name.toLowerCase() === name.toLowerCase()); return e ? e.data().toString('utf8') : null }
  const workbook = part('xl/workbook.xml')
  if (!workbook) return { problem: 'That is not an Excel (.xlsx) file. Save the sheet as .xlsx or .csv and try again.', code: 'bad_xlsx' }
  const rels = new Map<string, string>()
  for (const m of (part('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = attr(m[0], 'Id'), target = attr(m[0], 'Target')
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'))
  }
  const shared: string[] = []
  const sst = part('xl/sharedStrings.xml')
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescape(t[1])).join(''))
  const dates = dateStyles(part('xl/styles.xml'))

  const sheets: Workbook['sheets'] = []
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = attr(m[0], 'name') ?? `Sheet ${sheets.length + 1}`
    const rid = attr(m[0], 'r:id') ?? attr(m[0], 'id')
    const target = (rid && rels.get(rid)) || `xl/worksheets/sheet${sheets.length + 1}.xml`
    const xml = part(target)
    if (!xml) continue
    const rows: string[][] = []
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = []
      for (const c of r[1].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const head = c[1], body = c[2] ?? ''
        const ref = attr(`<c${head}>`, 'r') ?? ''
        const col = ref ? columnIndex(ref) : cells.length
        const type = attr(`<c${head}>`, 't')
        const style = Number(attr(`<c${head}>`, 's') ?? '-1')
        let value = ''
        const v = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)
        if (type === 's') value = shared[Number(v?.[1] ?? -1)] ?? ''
        else if (type === 'inlineStr') value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescape(t[1])).join('')
        else if (type === 'b') value = v?.[1] === '1' ? 'yes' : 'no'
        else if (type === 'str' || type === 'e') value = v ? text(v[1]) : ''
        else if (v) {
          const raw = unescape(v[1])
          const d = dates.get(style)
          const n = Number(raw)
          // a date cell is the day only (a time-only cell its clock time): the date cleaner reads year-month-day
          value = d && Number.isFinite(n) ? (d.timeOnly ? serialToDate(n, true).slice(11) : serialToDate(n, false)) : numberText(raw)
        }
        while (cells.length < col) cells.push('')
        cells[col] = value.trim()
      }
      if (cells.some((x) => x !== '')) rows.push(cells)
    }
    sheets.push({ name, rows })
  }
  if (!sheets.length) return { problem: 'The workbook has no sheets.', code: 'empty_file' }
  return { sheets }
}
