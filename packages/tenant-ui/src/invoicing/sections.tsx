// A quote's lines in phases (sections), each with its subtotal — the editor, the quote page and the customer's page all
// group the same way (tenant-backend invoicing/quoteSections.ts is the server's copy of this rule: sections in the order
// they first appear, an unticked optional line shown but not counted). A quote with no sections and no allowances is
// drawn as it always was.
import React from 'react'
import { money } from '../money'

export interface SectionLine { section?: string | null; allowance?: boolean | null; optional?: boolean | null; selected?: boolean | null; total?: unknown; quantity?: unknown; unitPrice?: unknown }

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export const lineSection = (l: SectionLine) => String(l.section ?? '').trim()
export const hasSectionStructure = (lines: SectionLine[]) => lines.some((l) => lineSection(l) !== '' || !!l.allowance)
const lineTotal = (l: SectionLine) => (l.total !== undefined && l.total !== null && l.total !== '' ? Number(l.total) : Number(l.quantity ?? 1) * Number(l.unitPrice ?? 0))
const counts = (l: SectionLine) => !l.optional || l.selected !== false

export interface LineGroup<T> { name: string; items: { line: T; index: number }[]; subtotal: number; allowance: number }
export function groupLines<T extends SectionLine>(lines: T[]): LineGroup<T>[] {
  const groups = new Map<string, LineGroup<T>>()
  lines.forEach((line, index) => {
    const name = lineSection(line)
    const g = groups.get(name) || { name, items: [], subtotal: 0, allowance: 0 }
    groups.set(name, g)
    g.items.push({ line, index })
    if (counts(line)) {
      const t = lineTotal(line)
      g.subtotal = cents(g.subtotal + t)
      if (line.allowance) g.allowance = cents(g.allowance + t)
    }
  })
  return [...groups.values()]
}

/** The "Allowance" tag beside a line's text: the customer chooses against this figure rather than buying it as priced. */
export const AllowanceTag = () => <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">Allowance</span>

/**
 * The body rows of a lines table: a heading row for each section, its lines (drawn by `row`), then a subtotal row.
 * `colSpan` is the table's width; the subtotal sits in the last column.
 */
export function SectionedRows<T extends SectionLine>({ lines, colSpan, row, pad = 'px-4 py-2' }: { lines: T[]; colSpan: number; row: (line: T, index: number) => React.ReactNode; /** The padding of the heading and subtotal cells, to match the table they sit in. */ pad?: string }) {
  if (!hasSectionStructure(lines)) return <>{lines.map((l, i) => row(l, i))}</>
  const groups = groupLines(lines)
  const named = groups.some((g) => g.name !== '')
  return (
    <>
      {groups.map((g) => (
        <React.Fragment key={`g-${g.name}`}>
          {named && <tr className="bg-gray-50 dark:bg-slate-800/60"><th colSpan={colSpan} scope="colgroup" className={`${pad} text-left text-sm font-semibold text-gray-900 dark:text-white`}>{g.name || 'Other lines'}</th></tr>}
          {g.items.map(({ line, index }) => row(line, index))}
          {named && <tr className="text-gray-900 dark:text-slate-100"><td colSpan={colSpan - 1} className={`${pad} text-right text-xs text-gray-600 dark:text-slate-300`}>{g.name || 'Other lines'} subtotal</td><td className={`${pad} text-right text-sm font-semibold`}>{money(g.subtotal)}</td></tr>}
        </React.Fragment>
      ))}
    </>
  )
}
