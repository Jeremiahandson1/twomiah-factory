// Contractor parity row 9 — the formula language (packages/tenant-backend invoicing/formulas.ts): parameters and other lines by
// name, the operators and functions, the order lines are worked out in, and every error in words. Pure; no server.
import { describe, test, expect } from 'bun:test'
import { evaluate, workOut, cleanParameters, mergeParameters, namesIn } from '../../../packages/tenant-backend/src/invoicing/formulas.ts'

const scope = (o: Record<string, number>) => new Map(Object.entries(o))
const err = (f: () => unknown) => { try { f(); return null } catch (e: any) { return e.message } }

describe('a formula', () => {
  test('arithmetic, brackets, powers and the functions', () => {
    expect(evaluate('sqft * 1.1', scope({ sqft: 200 }))).toBeCloseTo(220)
    expect(evaluate('(wall_height - 0.5) * 2 ^ 2', scope({ wall_height: 8.5 }))).toBe(32)
    expect(evaluate('-3 + 5', scope({}))).toBe(2)
    expect(evaluate('roundup(37, 10)', scope({}))).toBe(40)
    expect(evaluate('ceil(perimeter / 8) + 1', scope({ perimeter: 60 }))).toBe(9)
    expect(evaluate('round(10 / 3, 2)', scope({}))).toBe(3.33)
    expect(evaluate('max(openings, 2) * min(4, 6)', scope({ openings: 5 }))).toBe(20)
    expect(evaluate('SQFT', scope({ sqft: 3 }))).toBe(3) // names are not case-sensitive
    expect(namesIn('ceil(studs / 8) + waste')).toEqual(['studs', 'waste'])
  })

  test('mistakes are said in words', () => {
    expect(err(() => evaluate('sqfft * 2', scope({ sqft: 1 })))).toBe('Nothing is called "sqfft": no parameter or line has that name')
    expect(err(() => evaluate('10 / (a - a)', scope({ a: 2 })))).toBe('Dividing by zero')
    expect(err(() => evaluate('(sqft * 2', scope({ sqft: 1 })))).toBe('A bracket is not closed')
    expect(err(() => evaluate('1,200 * 2', scope({})))).toBe('Write numbers without commas (1200, not 1,200)')
    expect(err(() => evaluate('2sqft', scope({ sqft: 1 })))).toBe('Put a * between the number and "sqft"')
    expect(err(() => evaluate('sum(1, 2)', scope({})))).toMatch(/no function called "sum"/)
    expect(err(() => evaluate('ceil(1, 2)', scope({})))).toBe('ceil takes 1 number')
    expect(err(() => evaluate('a $ b', scope({})))).toBe('"$" cannot be used in a formula')
    expect(err(() => evaluate('', scope({})))).toBe('The formula is empty')
    // nothing can be run: there is no way to reach code
    expect(err(() => evaluate('constructor', scope({})))).toMatch(/Nothing is called/)
    expect(err(() => evaluate('process.exit(1)', scope({})))).toBe('"." cannot be used in a formula')
  })
})

describe('a quote’s lines', () => {
  const params = [{ key: 'wall_length', value: 96 }, { key: 'wall_height', value: 8 }]
  test('lines read each other by name, in whatever order they are listed', () => {
    const { results, firstError } = workOut([
      { formulaKey: 'plates', quantityFormula: 'ceil(studs / 8) * 2' },
      { formulaKey: 'studs', quantityFormula: 'ceil(wall_length * 12 / 16) + 1' },
      { quantityFormula: 'wall_length * wall_height', priceFormula: '2.5 * 1.15' },
      { description: 'fixed', quantity: 3, unitPrice: 10 } as any,
    ], params)
    expect(firstError).toBeNull()
    expect(results.map((r) => [r.quantity, r.unitPrice])).toEqual([[20, undefined], [73, undefined], [768, 2.88], [undefined, undefined]])
  })

  test('a loop, a bad name, a repeat and a line reading a broken line are each the line’s error', () => {
    const loop = workOut([{ formulaKey: 'a', quantityFormula: 'b + 1' }, { formulaKey: 'b', quantityFormula: 'a + 1' }], [])
    expect(loop.firstError?.message).toMatch(/^A loop: a uses b uses a|^A loop: b uses a uses b/)
    expect(workOut([{ formulaKey: 'two words', quantityFormula: '1' }], []).firstError?.message).toMatch(/cannot be a line's name/)
    expect(workOut([{ formulaKey: 'x', quantity: 1 }, { formulaKey: 'X', quantity: 2 }], []).firstError).toEqual({ line: 1, message: 'Two lines are called "X"' })
    const chain = workOut([{ formulaKey: 'base', quantityFormula: 'nope * 2' }, { quantityFormula: 'base + 1' }], [])
    expect(chain.results[1].error).toBe('It uses base, which has a problem: Nothing is called "nope": no parameter or line has that name')
    expect(workOut([{ quantityFormula: 'wall_length - 200' }], params).firstError?.message).toBe('The quantity works out to -104; it must be more than zero')
    expect(workOut([{ formulaKey: 'wall_height', quantity: 1 }], params).firstError?.message).toBe('"wall_height" is already a parameter\'s name')
  })
})

describe('parameters', () => {
  test('cleaned: names, numbers, no repeats, no function names; the quote’s own win over its project’s', () => {
    expect(cleanParameters([{ key: 'sqft', label: 'Floor area', value: '1200', unit: 'sq ft' }])).toEqual({ parameters: [{ key: 'sqft', value: 1200, label: 'Floor area', unit: 'sq ft' }] })
    expect(cleanParameters([{ key: 'floor area', value: 1 }])).toEqual({ error: '"floor area" cannot be a parameter\'s name: use letters, digits and _ (like sqft or wall_height)' })
    expect(cleanParameters([{ key: 'a', value: 1 }, { key: 'A', value: 2 }])).toEqual({ error: 'Two parameters are called "A"' })
    expect(cleanParameters([{ key: 'ceil', value: 1 }])).toEqual({ error: '"ceil" is a function\'s name; call the parameter something else' })
    expect(cleanParameters([{ key: 'sqft', label: 'Floor area', value: 'lots' }])).toEqual({ error: 'Floor area needs a number' })
    expect(mergeParameters([{ key: 'sqft', value: 1000 }, { key: 'pitch', value: 6 }], [{ key: 'SQFT', value: 1200 }]).map((p) => [p.key, p.value])).toEqual([['SQFT', 1200], ['pitch', 6]])
  })
})
