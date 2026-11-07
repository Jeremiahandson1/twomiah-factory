// A payment plan split evenly (contractor parity row 12): pure, so the invoice panel and the tests share it.
export type Inst = { id?: string; dueDate: string; amount: number; paid?: number; owed?: number; state?: string }

/** Split `total` into `n` installments a month apart from `first` (YYYY-MM-DD); the last takes the cents left over. */
export function evenPlan(total: number, n: number, first: string): Inst[] {
  const each = Math.floor((total / n) * 100) / 100
  const [y, m, d] = first.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const dt = new Date(Date.UTC(y, m - 1 + i, Math.min(d, 28)))
    return { dueDate: dt.toISOString().slice(0, 10), amount: i === n - 1 ? Math.round((total - each * (n - 1)) * 100) / 100 : each }
  })
}
