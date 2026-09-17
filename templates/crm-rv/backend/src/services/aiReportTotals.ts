// AI Reports arithmetic — pure helpers (no database or network), used by routes/aiReports.ts and checked in CI.
// Arithmetic is done by code, not the model (RV T19 H4: rows summed to $156,084, the report said $194,584) ----
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const cents = (n: number) => Math.round(n * 100) / 100

/** Exact counts and totals the model copies instead of adding numbers itself. */
export function precomputedTotals(units: any[], leads: any[], ros: any[], invoices: any[]) {
  const group = <T,>(rows: T[], key: (r: T) => string, sums: Record<string, (r: T) => number>) => {
    const out: Record<string, any> = {}
    for (const r of rows) {
      const k = key(r)
      out[k] ||= { count: 0, ...Object.fromEntries(Object.keys(sums).map((s) => [s, 0])) }
      out[k].count++
      for (const [s, f] of Object.entries(sums)) out[k][s] = cents(out[k][s] + f(r))
    }
    return out
  }
  const unitSums = { internetPriceTotal: (u: any) => num(u.internetPrice), costTotal: (u: any) => num(u.cost) }
  return {
    unitsByStatus: group(units, (u) => u.status || 'unknown', unitSums),
    unitsByStatusAndCategory: group(units, (u) => `${u.status || 'unknown'} / ${u.category || 'uncategorized'}`, unitSums),
    unitsByStatusAndCondition: group(units, (u) => `${u.status || 'unknown'} / ${u.condition || 'unknown'}`, unitSums),
    leadsByStage: group(leads, (l) => l.stage || 'unknown', {}),
    repairOrdersByStatus: group(ros, (r) => r.status || 'unknown', { estimatedTotal: (r: any) => num(r.estimatedTotal), actualTotal: (r: any) => num(r.actualTotal) }),
    invoicesByStatus: group(invoices, (i) => i.status || 'unknown', { total: (i: any) => num(i.total), amountPaid: (i: any) => num(i.amountPaid) }),
  }
}

/**
 * Check every Markdown table's "Total" row against the rows above it and correct any column that doesn't add up;
 * the wrong figure is also corrected wherever else the report repeats it (e.g. the headline). Returns the report and
 * the corrections made (for a visible note).
 */
export function fixReportTotals(report: string): { report: string; corrections: { wrong: string; right: string }[] } {
  const lines = report.split('\n')
  const corrections: { wrong: string; right: string }[] = []
  const cellsOf = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line)
  const isSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)
  const parse = (cell: string) => {
    const bare = cell.replace(/\*\*|__|`/g, '').trim()
    if (!/^-?\$?\s*-?[\d,]+(\.\d+)?$/.test(bare)) return null
    return { value: Number(bare.replace(/[$,\s]/g, '')), money: bare.includes('$'), decimals: (bare.split('.')[1] || '').length }
  }
  const format = (n: number, money: boolean, decimals: number) =>
    `${n < 0 ? '-' : ''}${money ? '$' : ''}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`

  for (let i = 0; i < lines.length; i++) {
    if (!isTableLine(lines[i]) || !isSeparator(lines[i + 1] || '')) continue
    let end = i + 2
    while (end < lines.length && isTableLine(lines[end])) end++
    const body = lines.slice(i + 2, end)
    const dataRows: string[][] = [], totalRows: number[] = []
    body.forEach((l, k) => { const cells = cellsOf(l); if (/^(\*\*|__)?\s*(grand\s+)?total\b/i.test(cells[0] || '')) totalRows.push(i + 2 + k); else dataRows.push(cells) })
    for (const t of totalRows) {
      const cells = cellsOf(lines[t])
      let changed = false
      for (let col = 1; col < cells.length; col++) {
        const stated = parse(cells[col])
        if (!stated || /%/.test(cells[col])) continue
        const values = dataRows.map((r) => parse(r[col] ?? ''))
        if (!values.length || values.some((v) => v === null)) continue // only columns where every row is a number
        const sum = cents(values.reduce((s, v) => s + (v as any).value, 0))
        if (Math.abs(sum - stated.value) <= 0.5) continue
        const wrong = cells[col].replace(/\*\*|__|`/g, '').trim()
        const right = format(sum, stated.money, stated.decimals)
        cells[col] = cells[col].replace(wrong, right)
        corrections.push({ wrong, right })
        changed = true
      }
      if (changed) lines[t] = `| ${cells.join(' | ')} |`
    }
    i = end - 1
  }
  let out = lines.join('\n')
  for (const { wrong, right } of corrections) {
    // the same wrong figure elsewhere (headline, bullets) — whole-number match only, so $194,584 doesn't hit $1,194,584.10
    const esc = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`(?<![\\d,.])${esc}(?![\\d,]|\\.\\d)`, 'g'), right)
  }
  return { report: out, corrections }
}
