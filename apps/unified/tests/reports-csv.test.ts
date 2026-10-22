// The shared Reports page exports each table as CSV through one helper (live test 2026-10-22: the contractor's Reports
// page had no export; home care's had CSV and PDF). The helper's escaping, then the page in a real DOM (happy-dom)
// against a stand-in API: every card's CSV button hands the browser a file with that table's rows.
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'
import { toCsv, csvCell, csvName } from '../../../packages/tenant-ui/src/reporting/csv.ts'

describe('the CSV helper', () => {
  test('quotes every cell, doubles quotes, keeps line breaks inside the quotes, CRLF between rows', () => {
    expect(toCsv(['Name', 'Note'], [['Ann "AJ" Lee', 'line one\nline two'], [12.5, null]])).toBe('"Name","Note"\r\n"Ann ""AJ"" Lee","line one\nline two"\r\n"12.5",""\r\n')
  })
  test('a cell a spreadsheet would run as a formula is defused; a negative number stays a number', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+1 555')).toBe(`"'+1 555"`)
    expect(csvCell('@cmd')).toBe(`"'@cmd"`)
    expect(csvCell('-12.50')).toBe('"-12.50"')
  })
  test('file names say the table and the period', () => {
    expect(csvName('Top customers', 'Last 30 days')).toBe('top-customers-last-30-days.csv')
  })
})

// ── The page ────────────────────────────────────────────────────────────────────────────────────────────────────────
const win: any = new Window({ url: 'https://crm.example.com/crm/reports' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const files: Array<{ name: string; text: string }> = []
const blobs = new Map<string, Blob>()
let n = 0
URL.createObjectURL = ((b: Blob) => { const u = `blob:${++n}`; blobs.set(u, b); return u }) as any
URL.revokeObjectURL = (() => {}) as any
win.HTMLAnchorElement.prototype.click = function (this: any) { const b = blobs.get(this.href); if (b) pending.push(b.arrayBuffer().then((buf) => { files.push({ name: this.download, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf) }) })) }
const pending: Promise<void>[] = []

const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom')
// .tsx screens: imported by paths held in variables, so the server's tsconfig (no JSX) does not type-check the UI here.
const AUTH = '../../../packages/tenant-ui/src/auth/AuthContext.tsx', REPORTS = '../../../packages/tenant-ui/src/reporting/ReportsPage.tsx'
const { AuthContext } = await import(AUTH) as any
const { ReportsPage } = await import(REPORTS) as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }); await Promise.all(pending) }

const CUSTOMERS = [{ contact: { name: 'Ann Lee', company: 'Lee Co' }, invoiceCount: 2, invoiced: 900, collected: 850 }, { contact: { name: '=SUM(A1)' }, invoiceCount: 1, invoiced: 100, collected: 100 }]
const replies: Record<string, (p: any) => any> = {
  '/api/reports/dashboard': () => ({
    period: '30', revenue: { collected: 950, invoiced: 1000, outstanding: 50, overdue: 0, overdueCount: 0, collectionRate: 95 },
    jobs: { total: 4, completed: 3, completionRate: 75, scheduled: 1 }, projects: { total: 2, active: 1, completed: 1, totalValue: 12000 },
    quotes: { total: 5, approved: 2, conversionRate: 40, rejected: 3 },
    recentActivity: [{ type: 'invoice', number: 'INV-0001', status: 'paid', createdAt: '2026-10-21T15:00:00Z', total: '450.00' }],
  }),
  '/api/reports/revenue/monthly': () => [{ month: '2026-09', invoiced: 400, collected: 300 }, { month: '2026-10', invoiced: 600, collected: 650 }],
  '/api/reports/revenue/customers': (p) => CUSTOMERS.slice(0, Number(p?.limit) || 5),
  '/api/reports/team': () => [{ user: { firstName: 'Fran', lastName: 'Field' }, jobsCompleted: 3, hoursWorked: 21.5 }],
}
const calls: Array<{ path: string; params: any }> = []
const api = { get: async (path: string, params?: any) => { calls.push({ path, params }); return replies[path] ? replies[path](params) : null }, post: async () => ({}), put: async () => ({}), delete: async () => ({}) }

describe('the Reports page (shared screen, real DOM)', () => {
  test('every table has a CSV button, and each file holds that table', async () => {
    const el = document.createElement('div'); document.body.appendChild(el)
    const auth = { hasFeature: (f: string) => f !== 'multi_location' } as any
    await act(async () => { createRoot(el).render(h(MemoryRouter, null, h(AuthContext.Provider, { value: auth }, h(ReportsPage, { api, config: { team: true, projects: true, jobs: true, quotes: true } } as any)))) })
    await settle()
    const buttons = [...el.querySelectorAll('button')].filter((b: any) => /CSV/.test(b.textContent))
    const labels = buttons.map((b: any) => b.getAttribute('aria-label'))
    expect(labels).toEqual(expect.arrayContaining([
      'Download the summary as CSV', 'Download Revenue trend · last 2 months as CSV', 'Download Job status as CSV',
      'Download Top customers as CSV', 'Download Team productivity as CSV', 'Download Recent activity as CSV', 'Download Project summary as CSV',
    ]))
    for (const b of buttons) await act(async () => { (b as any).click() })
    await settle()
    const file = (name: string) => files.find((f) => f.name === name)?.text ?? ''
    expect(file('report-summary-last-30-days.csv')).toContain('"Revenue collected","950.00"')
    expect(file('revenue-trend-last-2-months.csv')).toContain('"2026-10","600.00","650.00"')
    expect(file('job-status-last-30-days.csv')).toContain('"Completed","3"')
    expect(file('team-productivity-last-30-days.csv')).toContain('"Fran Field","3","21.5"')
    expect(file('recent-activity-last-30-days.csv')).toContain('"invoice","INV-0001","","paid","450.00"')
    expect(file('project-summary-last-30-days.csv')).toContain('"Total value","12000.00"')
    // The customers file is every paying customer in the period, fetched for the export, not the card's five.
    const cust = file('top-customers-last-30-days.csv')
    expect(cust).toContain('"Ann Lee","Lee Co","2","900.00","850.00"')
    expect(cust).toContain(`"'=SUM(A1)"`)
    expect(calls.some((c) => c.path === '/api/reports/revenue/customers' && c.params?.limit === 1000 && c.params?.startDate)).toBe(true)
    expect(files.every((f) => f.text.charCodeAt(0) === 0xfeff)).toBe(true)
  })

  // The Project summary is offered only where this business can open Projects — the vertical has them AND this tenant
  // has the feature (Contractor T29 L2: it pointed at a page that said "Projects isn't part of this CRM").
  test('the Project summary shows only when this business has Projects', async () => {
    const render = async (auth: any, projects: boolean) => {
      const el = document.createElement('div'); document.body.appendChild(el)
      await act(async () => { createRoot(el).render(h(MemoryRouter, null, h(AuthContext.Provider, { value: auth }, h(ReportsPage, { api, config: { team: true, projects, jobs: true, quotes: true } } as any)))) })
      await settle()
      return /Project summary/.test(el.textContent || '')
    }
    expect(await render({ hasFeature: () => true }, true)).toBe(true)
    expect(await render({ hasFeature: (f: string) => f !== 'projects' }, true)).toBe(false)
    expect(await render({ hasFeature: () => true }, false)).toBe(false)
  })
})
