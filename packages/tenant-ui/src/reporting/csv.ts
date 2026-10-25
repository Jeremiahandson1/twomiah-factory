// One CSV export for the report tables. Live test 2026-10-22: the contractor's Reports page had no export at all,
// while home care's reports had CSV and PDF. Every table on the shared Reports page goes out through this.
//
// Each cell is quoted, quotes doubled, line breaks kept inside the quotes (RFC 4180). A cell a spreadsheet would read
// as a formula (= + - @, a tab or a carriage return first) is prefixed with ' so a customer's name can never run as
// one in Excel — except a plain number, which stays a number.
export type CsvCell = string | number | null | undefined

const NUMBER = /^-?\d+(\.\d+)?$/
export function csvCell(v: CsvCell): string {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s) && !NUMBER.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}

/** The file's text: a header row, then the rows. CRLF between rows, as spreadsheets expect. */
export function toCsv(head: string[], rows: CsvCell[][]): string {
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** "Top customers" + "Last 30 days" → "top-customers-last-30-days.csv". */
export const csvName = (...parts: string[]) => parts.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '.csv'

/** Hand the browser the file. The byte-order mark makes Excel read it as UTF-8 (a café's é, a dash). */
export function downloadCsv(filename: string, head: string[], rows: CsvCell[][]): string {
  const blob = new Blob(['﻿' + toCsv(head, rows)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 0)
  return filename
}
