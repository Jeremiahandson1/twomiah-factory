// Formula estimating on the quote screen (contractor parity row 9; JobTread; feature quote_formulas, not ready). The parameters
// panel, and the live working-out of each line's formulas as they are typed. formulas.ts here is the server's own
// (packages/tenant-backend/src/invoicing/formulas.ts), copied because each package is vendored on its own — a test holds the two
// copies the same. The server works every formula out again on save; this is so the person sees the numbers as they type.
import { workOut, mergeParameters, type Parameter } from './formulas'
import type { LineItemInput } from './types'

export type { Parameter }
export { mergeParameters }

/** The lines with every formula worked out against `parameters`, and each line's problem in words (index → message). */
export function applyLineFormulas(items: LineItemInput[], parameters: Parameter[]): { items: LineItemInput[]; errors: Record<number, string> } {
  if (!items.some((l) => l.quantityFormula || l.priceFormula)) return { items, errors: {} }
  const { results } = workOut(items.map((l) => (l.type === 'text' ? { ...l, quantityFormula: undefined, priceFormula: undefined } : l)), parameters)
  const errors: Record<number, string> = {}
  const next = items.map((l, i) => {
    const r = results[i]
    if (r.error) { errors[i] = r.error; return l }
    return { ...l, ...(r.quantity !== undefined ? { quantity: r.quantity } : {}), ...(r.unitPrice !== undefined ? { unitPrice: r.unitPrice } : {}) }
  })
  return { items: next, errors }
}

const box = 'w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

/**
 * The quote's parameters: name (what formulas read), label, value, unit. The job's own (`fromProject`) are listed for reading;
 * one given again here is the quote's, and wins.
 */
export function ParametersPanel({ parameters, fromProject, onChange }: { parameters: Parameter[]; fromProject: Parameter[]; onChange: (p: Parameter[]) => void }) {
  const set = (i: number, patch: Partial<Parameter>) => onChange(parameters.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const shadowed = new Set(parameters.map((p) => String(p.key).toLowerCase()))
  return (
    <section className="rounded-lg border border-gray-200 p-3 dark:border-slate-700" aria-labelledby="quote-parameters-h" data-testid="quote-parameters">
      <h3 id="quote-parameters-h" className="text-sm font-semibold text-gray-900 dark:text-slate-100">Parameters</h3>
      <p className="text-xs text-gray-600 dark:text-slate-300">Numbers the line formulas read by name, like <code>deck_sqft * 1.1</code>. Change one and every line that uses it is worked out again.</p>
      {fromProject.length > 0 && (
        <p className="mt-2 text-xs text-gray-700 dark:text-slate-200" data-testid="project-parameters">
          From the job: {fromProject.map((p) => <span key={p.key} className={shadowed.has(p.key.toLowerCase()) ? 'line-through' : ''}>{p.key} = {p.value}{p.unit ? ` ${p.unit}` : ''} </span>)}
        </p>
      )}
      {parameters.length > 0 && (
        <table className="mt-2 w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-600 dark:text-slate-400"><th className="pr-2">Name</th><th className="pr-2">Label</th><th className="pr-2">Value</th><th className="pr-2">Unit</th><th /></tr></thead>
          <tbody>
            {parameters.map((p, i) => (
              <tr key={i}>
                <td className="pr-2 py-1"><input aria-label="Parameter name" value={p.key} onChange={(e) => set(i, { key: e.target.value })} placeholder="deck_sqft" className={box} /></td>
                <td className="pr-2 py-1"><input aria-label="Parameter label" value={p.label || ''} onChange={(e) => set(i, { label: e.target.value })} placeholder="Deck area" className={box} /></td>
                <td className="pr-2 py-1"><input aria-label={`Value of ${p.key || 'parameter'}`} type="number" step="any" value={Number.isFinite(p.value) ? String(p.value) : ''} onChange={(e) => set(i, { value: e.target.value === '' ? 0 : Number(e.target.value) })} className={box} /></td>
                <td className="pr-2 py-1"><input aria-label="Parameter unit" value={p.unit || ''} onChange={(e) => set(i, { unit: e.target.value })} placeholder="sq ft" className={box} /></td>
                <td className="py-1"><button type="button" onClick={() => onChange(parameters.filter((_, j) => j !== i))} aria-label={`Remove ${p.key || 'parameter'}`} className="px-1 text-red-600 dark:text-red-300">×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" onClick={() => onChange([...parameters, { key: '', value: 0 }])} className="mt-2 text-sm text-orange-700 hover:underline dark:text-orange-200">+ Add parameter</button>
    </section>
  )
}
