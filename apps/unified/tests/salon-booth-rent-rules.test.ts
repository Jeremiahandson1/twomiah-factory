// Booth rent, the pure rules (server/crm/salon/boothRentRules.ts): when rent falls due, what a form may say, the ledger and the statement.
import { describe, test, expect } from 'bun:test'
import { buildLedger, buildStatement, dueInMonth, firstDue, nextPeriod, parseRenter, rentWords, statementCsv, type LedgerEvent } from '../server/crm/salon/boothRentRules.ts'

describe('booth rent: when the rent falls due', () => {
  test('weekly: the first due day is the renter\'s weekday on or after the start; then every seven days', () => {
    expect(firstDue('2026-11-02', 'weekly', 5, null)).toBe('2026-11-06')      // Monday start, Friday rent
    expect(firstDue('2026-11-06', 'weekly', 5, null)).toBe('2026-11-06')      // a Friday start is due that day
    expect(firstDue('2026-11-07', 'weekly', 5, null)).toBe('2026-11-13')
    expect(nextPeriod('2026-11-06', 'weekly', null)).toBe('2026-11-13')
    expect(nextPeriod('2026-12-28', 'weekly', null)).toBe('2027-01-04')       // across a year
  })
  test('monthly: the day of the month, or that month\'s last day when it has fewer — and it comes back to the day after', () => {
    expect(firstDue('2026-11-03', 'monthly', null, 15)).toBe('2026-11-15')
    expect(firstDue('2026-11-16', 'monthly', null, 15)).toBe('2026-12-15')
    expect(firstDue('2026-11-30', 'monthly', null, 31)).toBe('2026-11-30')
    expect(dueInMonth('2026-02-10', 31)).toBe('2026-02-28')
    expect(dueInMonth('2028-02-10', 31)).toBe('2028-02-29')
    // the 31st: Oct 31 → Nov 30 → Dec 31 (rolling the month blindly skipped a month)
    expect(nextPeriod('2026-10-31', 'monthly', 31)).toBe('2026-11-30')
    expect(nextPeriod('2026-11-30', 'monthly', 31)).toBe('2026-12-31')
    expect(nextPeriod('2026-12-31', 'monthly', 31)).toBe('2027-01-31')
    expect(nextPeriod('2027-01-31', 'monthly', 31)).toBe('2027-02-28')
  })
})

describe('booth rent: the form', () => {
  const today = '2026-11-01'
  test('a good weekly and a good monthly rent', () => {
    expect(parseRenter({ rent: 250, frequency: 'weekly', dueWeekday: 5 }, { today })).toEqual({ values: { rentCents: 25000, frequency: 'weekly', dueWeekday: 5, dueDay: null, startDate: today, notes: null } })
    expect(parseRenter({ rentCents: 90000, frequency: 'monthly', dueDay: 1, startDate: '2026-12-01', notes: ' Chair 4 ' }, { today })).toEqual({ values: { rentCents: 90000, frequency: 'monthly', dueWeekday: null, dueDay: 1, startDate: '2026-12-01', notes: 'Chair 4' } })
  })
  test('each wrong box is named in words', () => {
    const r = parseRenter({ rent: 'lots', frequency: 'daily' }, { today }) as { fields: Record<string, string> }
    expect(Object.keys(r.fields).sort()).toEqual(['frequency', 'rent'])
    expect((parseRenter({ rent: 0.5, frequency: 'weekly', dueWeekday: 2 }, { today }) as any).fields.rent).toContain('from $1')
    expect((parseRenter({ rent: 250, frequency: 'weekly' }, { today }) as any).fields.dueWeekday).toContain('day of the week')
    expect((parseRenter({ rent: 250, frequency: 'weekly', dueWeekday: 9 }, { today }) as any).fields.dueWeekday).toContain('day of the week')
    expect((parseRenter({ rent: 250, frequency: 'monthly', dueDay: 32 }, { today }) as any).fields.dueDay).toContain('1 to 31')
    expect((parseRenter({ rent: 250, frequency: 'monthly' }, { today }) as any).fields.dueDay).toContain('day of the month')
    expect((parseRenter({ rent: 250, frequency: 'weekly', dueWeekday: 1, startDate: '2026-02-30' }, { today }) as any).fields.startDate).toContain('date')
    expect((parseRenter({ rent: 250, frequency: 'weekly', dueWeekday: 1, notes: 'x'.repeat(1001) }, { today }) as any).fields.notes).toContain('1000')
  })
  test('an update keeps what it does not name, and switching to monthly drops the weekday', () => {
    const cur = { rentCents: 25000, frequency: 'weekly' as const, dueWeekday: 5, dueDay: null, startDate: '2026-10-01', notes: 'a' }
    expect(parseRenter({ rent: 275 }, { today, current: cur })).toEqual({ values: { ...cur, rentCents: 27500 } })
    expect(parseRenter({ frequency: 'monthly', dueDay: 3 }, { today, current: cur })).toEqual({ values: { ...cur, frequency: 'monthly', dueWeekday: null, dueDay: 3 } })
    expect((parseRenter({ frequency: 'monthly' }, { today, current: cur }) as any).fields.dueDay).toBeTruthy()
  })
  test('the rent in words', () => {
    expect(rentWords({ rentCents: 25000, frequency: 'weekly', dueWeekday: 5, dueDay: null })).toBe('$250 a week, due Fridays')
    expect(rentWords({ rentCents: 90050, frequency: 'monthly', dueWeekday: null, dueDay: 1 })).toBe('$900.50 a month, due on the 1st')
    expect(rentWords({ rentCents: 90000, frequency: 'monthly', dueWeekday: null, dueDay: 22 })).toBe('$900 a month, due on the 22nd')
    expect(rentWords({ rentCents: 90000, frequency: 'monthly', dueWeekday: null, dueDay: 12 })).toBe('$900 a month, due on the 12th')
  })
})

describe('booth rent: ledger and statement', () => {
  const ev = (date: string, kind: LedgerEvent['kind'], chargeCents: number, paymentCents: number, at = 0, description: string = kind): LedgerEvent => ({ date, at, kind, description, chargeCents, paymentCents, invoiceNumber: null, invoiceId: null })
  const events = [
    ev('2026-10-02', 'rent', 25000, 0), ev('2026-10-02', 'payment', 0, 25000, 5),
    ev('2026-10-09', 'rent', 25000, 0), ev('2026-10-16', 'waived', 0, 0), ev('2026-10-23', 'rent', 25000, 0),
    ev('2026-10-25', 'payment', 0, 10000),
  ]
  test('a running balance: what is owed after each line, a payment the day it is due after the charge', () => {
    const l = buildLedger(events)
    expect(l.map((x) => x.balanceCents)).toEqual([25000, 0, 25000, 25000, 50000, 40000])
    expect(buildLedger([ev('2026-10-02', 'payment', 0, 25000, 1), ev('2026-10-02', 'rent', 25000, 0, 9)]).map((x) => x.kind)).toEqual(['rent', 'payment'])
    expect(buildLedger([])).toEqual([])
  })
  test('a statement: opening balance, the lines in the stretch, closing balance — the same figures as the ledger', () => {
    const s = buildStatement(events, '2026-10-09', '2026-10-24')
    expect(s.openingCents).toBe(0)
    expect(s.lines.map((x) => x.date)).toEqual(['2026-10-09', '2026-10-16', '2026-10-23'])
    expect([s.chargesCents, s.paymentsCents, s.closingCents]).toEqual([50000, 0, 50000])
    const all = buildStatement(events, '2026-10-01', '2026-10-31')
    expect([all.openingCents, all.chargesCents, all.paymentsCents, all.closingCents]).toEqual([0, 75000, 35000, 40000])
    const later = buildStatement(events, '2026-10-24', '2026-10-31')
    expect([later.openingCents, later.closingCents, later.lines.length]).toEqual([50000, 40000, 1])
    expect(buildStatement(events, '2025-01-01', '2025-01-31').closingCents).toBe(0)
  })
  test('the spreadsheet file quotes what needs it and ends with the totals', () => {
    const csv = statementCsv('Rae "R" Jones', buildStatement([ev('2026-10-02', 'rent', 25000, 0, 0, 'Rent, week one')], '2026-10-01', '2026-10-31'))
    expect(csv).toContain('"Rae ""R"" Jones"')
    expect(csv).toContain('2026-10-02,"Rent, week one",,250.00,,250.00')
    expect(csv.trim().split('\r\n').slice(-3)).toEqual(['Charged,250.00', 'Paid,0.00', 'Closing balance,250.00'])
  })
})
