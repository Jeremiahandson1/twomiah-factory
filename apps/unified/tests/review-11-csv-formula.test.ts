// Code review 11-1, 2026-11-13: a cell that would run as a formula is kept as text in the server's spreadsheet files
// (packages/tenant-backend/src/csvSafe.ts), and every server CSV writer goes through it.
import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { csvFormulaSafe } from '@twomiah/tenant-backend'

test('what a visitor could type as a formula stays text; figures, dates and phone numbers are untouched', () => {
  for (const bad of ['=HYPERLINK("http://x.example","Open")', '+cmd|\' /C calc\'!A0', '-2+3+cmd', '@SUM(A1:A9)', '\t=1+1', '\r=1+1'])
    expect(csvFormulaSafe(bad)).toBe("'" + bad)
  for (const fine of ['Ann Able', '-12.50', '+1 (715) 555-0100', '2026-11-13', '09:30', '1,200.00', '', 'a=b', 'net-30'])
    expect(csvFormulaSafe(fine)).toBe(fine)
})

test('the server\'s CSV writers use it', () => {
  const root = path.resolve(import.meta.dir, '..', 'server')
  for (const f of ['crm/field/reportTables.ts', 'crm/field/jobReminderRoutes.ts', 'crm/homecare/billing/shared.ts', 'crm/homecare/core/payerRouter.ts',
    'crm/homecare/payroll/payRulesRoutes.ts', 'crm/office/export.ts', 'data/exportAll.ts', 'crm/homecare/planning/reportFiles.ts'])
    expect({ f, uses: fs.readFileSync(path.join(root, f), 'utf8').includes('csvFormulaSafe(') }).toEqual({ f, uses: true })
})
