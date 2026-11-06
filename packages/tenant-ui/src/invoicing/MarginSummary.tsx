// What the quote earns us, shown under its totals while it is built (markup_defaults): our cost, the profit, the margin — over the
// lines that have a cost, and a plain count of the lines that do not. Cost-side, so it is only drawn for a seat that may see cost.
import React from 'react'
import type { LineItemInput } from './types'
import { quoteMargin } from './markup'
import { money } from './ui'

export function MarginSummary({ lines }: { lines: LineItemInput[] }) {
  const m = quoteMargin(lines)
  if (m.price <= 0 && m.uncosted === 0) return null
  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" data-testid="margin-summary">
      <p className="font-medium">Our margin <span className="text-xs font-normal text-gray-600 dark:text-slate-300">(you see this; the customer does not)</span></p>
      {m.price > 0 && <p>Cost {money(m.cost)} · Profit {money(m.profit)}{m.margin !== null ? ` · Margin ${m.margin}%` : ''}</p>}
      {m.uncosted > 0 && <p className="text-xs text-gray-600 dark:text-slate-300">{m.uncosted} {m.uncosted === 1 ? 'line has' : 'lines have'} no cost entered, so {m.uncosted === 1 ? 'it is' : 'they are'} left out of this.</p>}
    </div>
  )
}
