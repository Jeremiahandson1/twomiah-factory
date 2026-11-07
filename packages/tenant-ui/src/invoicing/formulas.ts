// Formula estimating (contractor parity row 9; JobTread's parameters and formulas; feature quote_formulas, not ready).
//
// A quote — or the project it is on — carries PARAMETERS: named numbers such as `sqft` (floor area), `wall_height`, `openings`.
// A line's quantity, and its unit price, may be a FORMULA over those parameters and over other lines: a line given a key (say
// `studs`) is read in another line's formula as that line's quantity, so `plates = studs / 8` follows the studs. Change a
// parameter and every formula is worked out again; the server does it on every save, so what is stored always agrees.
//
// The language is small on purpose, and evaluated here — never by eval / Function:
//   numbers (12, 0.5, 1,200 is NOT allowed — write 1200), names (letters, digits and _; a parameter key or a line key),
//   + - * / ^ and parentheses, unary minus, and the functions
//     round(x)  round(x, places)   ceil(x)  floor(x)   roundup(x, step)  (up to the next whole step: roundup(37, 10) = 40)
//     min(a, b, …)  max(a, b, …)   abs(x)   sqrt(x)
// Anything wrong is answered in words: an unknown name, a typo in the formula, dividing by zero, a loop between lines.

export type Parameter = { key: string; label?: string; value: number; unit?: string }
export type FormulaLine = { formulaKey?: string | null; quantityFormula?: string | null; priceFormula?: string | null; quantity?: number; unitPrice?: number }

export class FormulaError extends Error {
  constructor(message: string) { super(message); this.name = 'FormulaError' }
}

const KEY = /^[a-z_][a-z0-9_]{0,39}$/i
export const isFormulaKey = (k: string) => KEY.test(k)
const FUNCS: Record<string, { min: number; max: number; f: (...a: number[]) => number }> = {
  round: { min: 1, max: 2, f: (x, p = 0) => { const m = 10 ** Math.round(p); return Math.round((x + Number.EPSILON) * m) / m } },
  ceil: { min: 1, max: 1, f: Math.ceil },
  floor: { min: 1, max: 1, f: Math.floor },
  roundup: { min: 2, max: 2, f: (x, step) => { if (!step) throw new FormulaError('roundup needs a step that is not zero, like roundup(x, 10)'); return Math.ceil(x / step - 1e-9) * step } },
  min: { min: 1, max: 50, f: Math.min },
  max: { min: 1, max: 50, f: Math.max },
  abs: { min: 1, max: 1, f: Math.abs },
  sqrt: { min: 1, max: 1, f: (x) => { if (x < 0) throw new FormulaError('sqrt of a negative number'); return Math.sqrt(x) } },
}

type Tok = { k: 'num'; v: number } | { k: 'name'; v: string } | { k: 'op'; v: string }
function tokens(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i))
      if (!m) throw new FormulaError(`"${ch}" is not a number`)
      out.push({ k: 'num', v: Number(m[1]) }); i += m[1].length
      if (/[a-z_]/i.test(src[i] || '')) throw new FormulaError(`Put a * between the number and "${/^[a-z_][a-z0-9_]*/i.exec(src.slice(i))![0]}"`)
      continue
    }
    if (/[a-z_]/i.test(ch)) { const m = /^[a-z_][a-z0-9_]*/i.exec(src.slice(i))!; out.push({ k: 'name', v: m[0] }); i += m[0].length; continue }
    if ('+-*/^(),'.includes(ch)) { out.push({ k: 'op', v: ch }); i++; continue }
    throw new FormulaError(`"${ch}" cannot be used in a formula`)
  }
  return out
}

/** The names a formula reads (to order the lines and find loops). Throws a FormulaError on a typo. */
export function namesIn(src: string): string[] {
  return [...new Set(tokens(src).filter((t, i, all) => t.k === 'name' && !(all[i + 1]?.k === 'op' && all[i + 1].v === '(')).map((t) => (t as any).v.toLowerCase()))]
}

/** Work a formula out against `scope` (names lower-case). Answers a finite number or throws a FormulaError in words. */
export function evaluate(src: string, scope: Map<string, number>): number {
  const text = String(src ?? '').trim()
  if (!text) throw new FormulaError('The formula is empty')
  if (text.length > 500) throw new FormulaError('A formula is 500 characters or fewer')
  const ts = tokens(text)
  let p = 0
  const peek = () => ts[p]
  const isOp = (v: string) => peek()?.k === 'op' && (peek() as any).v === v
  const expect = (v: string) => { if (!isOp(v)) throw new FormulaError(v === ')' ? 'A bracket is not closed' : `Expected "${v}"`); p++ }
  const expr = (): number => {
    let v = term()
    while (isOp('+') || isOp('-')) { const o = (ts[p++] as any).v; const r = term(); v = o === '+' ? v + r : v - r }
    return v
  }
  const term = (): number => {
    let v = power()
    while (isOp('*') || isOp('/')) {
      const o = (ts[p++] as any).v; const r = power()
      if (o === '/' && r === 0) throw new FormulaError('Dividing by zero')
      v = o === '*' ? v * r : v / r
    }
    return v
  }
  const power = (): number => { const b = unary(); if (isOp('^')) { p++; return b ** power() } return b }
  const unary = (): number => { if (isOp('-')) { p++; return -unary() } if (isOp('+')) { p++; return unary() } return atom() }
  const atom = (): number => {
    const t = peek()
    if (!t) throw new FormulaError('The formula stops too soon')
    if (t.k === 'num') { p++; return t.v }
    if (t.k === 'op' && t.v === '(') { p++; const v = expr(); expect(')'); return v }
    if (t.k === 'name') {
      p++
      const name = t.v.toLowerCase()
      if (isOp('(')) {
        const fn = FUNCS[name]
        if (!fn) throw new FormulaError(`There is no function called "${t.v}" (use round, ceil, floor, roundup, min, max, abs or sqrt)`)
        p++
        const args: number[] = []
        if (!isOp(')')) { args.push(expr()); while (isOp(',')) { p++; args.push(expr()) } }
        expect(')')
        if (args.length < fn.min || args.length > fn.max) throw new FormulaError(`${name} takes ${fn.min === fn.max ? fn.min : `${fn.min} to ${fn.max}`} ${fn.max === 1 ? 'number' : 'numbers'}`)
        return fn.f(...args)
      }
      if (!scope.has(name)) throw new FormulaError(`Nothing is called "${t.v}": no parameter or line has that name`)
      return scope.get(name)!
    }
    throw new FormulaError(`"${(t as any).v}" is out of place`)
  }
  const v = expr()
  if (p < ts.length) throw new FormulaError((ts[p] as any).v === ',' ? 'Write numbers without commas (1200, not 1,200)' : `"${(ts[p] as any).v}" is out of place`)
  if (!Number.isFinite(v)) throw new FormulaError('The answer is not a number')
  return v
}

export type LineResult = { quantity?: number; unitPrice?: number; error?: string }

/**
 * Every line's quantity and price, worked out from the parameters and from each other in the order the formulas need. A line
 * without a formula keeps what it has. Answers one result per line (an `error` in words where its formula fails — a line that
 * reads a failing line fails too) and the first error, for a save to refuse with.
 */
export function workOut(lines: FormulaLine[], parameters: Parameter[]): { results: LineResult[]; firstError: { line: number; message: string } | null } {
  const scope = new Map<string, number>()
  for (const prm of parameters || []) if (prm?.key) scope.set(String(prm.key).toLowerCase(), Number(prm.value) || 0)
  const keyOf = new Map<string, number>()
  const results: LineResult[] = lines.map(() => ({}))
  lines.forEach((l, i) => {
    const k = String(l.formulaKey || '').trim().toLowerCase()
    if (!k) return
    if (!isFormulaKey(k)) results[i].error = `"${l.formulaKey}" cannot be a line's name: use letters, digits and _ (like studs or wall_area)`
    else if (scope.has(k) && !keyOf.has(k)) results[i].error = `"${l.formulaKey}" is already a parameter's name`
    else if (keyOf.has(k)) results[i].error = `Two lines are called "${l.formulaKey}"`
    else keyOf.set(k, i)
  })
  // Line keys read as quantities: set those without a quantity formula now; the rest as they are worked out.
  lines.forEach((l, i) => { const k = String(l.formulaKey || '').trim().toLowerCase(); if (k && keyOf.get(k) === i && !l.quantityFormula) scope.set(k, Number(l.quantity) || 0) })
  const state = lines.map(() => 0) // 0 not done, 1 working, 2 done
  const lineName = (i: number) => lines[i].formulaKey || `line ${i + 1}`
  const visit = (i: number, path: number[]) => {
    if (state[i] === 2) return
    if (state[i] === 1) throw new FormulaError(`A loop: ${[...path.slice(path.indexOf(i)), i].map(lineName).join(' uses ')}`)
    state[i] = 1
    const l = lines[i]
    try {
      if (results[i].error) throw new FormulaError(results[i].error!)
      for (const f of [l.quantityFormula, l.priceFormula]) {
        if (!f || !String(f).trim()) continue
        for (const n of namesIn(String(f))) { const j = keyOf.get(n); if (j !== undefined && j !== i) { visit(j, [...path, i]); if (results[j].error) throw new FormulaError(results[j].error!.startsWith('A loop:') ? results[j].error! : `It uses ${lineName(j)}, which has a problem: ${results[j].error}`) } }
      }
      if (l.quantityFormula && String(l.quantityFormula).trim()) {
        const q = Math.round((evaluate(String(l.quantityFormula), scope) + Number.EPSILON) * 100) / 100
        if (!(q > 0)) throw new FormulaError(`The quantity works out to ${q}; it must be more than zero`)
        results[i].quantity = q
        const k = String(l.formulaKey || '').trim().toLowerCase(); if (k && keyOf.get(k) === i) scope.set(k, q)
      }
      if (l.priceFormula && String(l.priceFormula).trim()) {
        const v = Math.round((evaluate(String(l.priceFormula), scope) + Number.EPSILON) * 100) / 100
        if (v < 0) throw new FormulaError(`The price works out to ${v}; it cannot be negative`)
        results[i].unitPrice = v
      }
    } catch (e) {
      if (!(e instanceof FormulaError)) throw e
      results[i] = { error: e.message }
    }
    state[i] = 2
  }
  lines.forEach((_, i) => { try { visit(i, []) } catch (e) { if (e instanceof FormulaError) results[i] = { error: e.message }; else throw e; state[i] = 2 } })
  const bad = results.findIndex((r) => r.error)
  return { results, firstError: bad >= 0 ? { line: bad, message: results[bad].error! } : null }
}

/** Parameters as a quote or project stores them: keyed, labelled, numbers, no repeats. Answers the clean list or the problem. */
export function cleanParameters(input: unknown): { parameters: Parameter[] } | { error: string } {
  if (input === undefined || input === null) return { parameters: [] }
  if (!Array.isArray(input)) return { error: 'Parameters are a list' }
  if (input.length > 100) return { error: 'A quote has 100 parameters or fewer' }
  const out: Parameter[] = []
  const seen = new Set<string>()
  for (const raw of input as any[]) {
    const key = String(raw?.key ?? '').trim()
    if (!isFormulaKey(key)) return { error: `"${key || '(blank)'}" cannot be a parameter's name: use letters, digits and _ (like sqft or wall_height)` }
    if (FUNCS[key.toLowerCase()]) return { error: `"${key}" is a function's name; call the parameter something else` }
    if (seen.has(key.toLowerCase())) return { error: `Two parameters are called "${key}"` }
    seen.add(key.toLowerCase())
    const value = Number(raw?.value)
    if (!Number.isFinite(value)) return { error: `${raw?.label || key} needs a number` }
    out.push({ key, value, ...(raw?.label ? { label: String(raw.label).slice(0, 80) } : {}), ...(raw?.unit ? { unit: String(raw.unit).slice(0, 20) } : {}) })
  }
  return { parameters: out }
}

/** A quote's parameters over its project's: the quote's own win, the project's fill in the rest. */
export const mergeParameters = (project: Parameter[] | null | undefined, own: Parameter[] | null | undefined): Parameter[] => {
  const by = new Map<string, Parameter>()
  for (const p of project || []) by.set(p.key.toLowerCase(), p)
  for (const p of own || []) by.set(p.key.toLowerCase(), p)
  return [...by.values()]
}
