// Home care's day-one guides (verticals/homecare/settings.ts HOMECARE_STARTER) send the office to "Section › Item" in the menu. Every
// such path must be one the menu has: the template's guides named menu paths, buttons and tabs that had changed or
// never existed (rewritten and checked against the code, 2026-10-19). This keeps the menu half honest as screens move.
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import homecare from '../verticals/homecare/settings.ts'

const HOMECARE_STARTER = homecare.starter!

const WEB = path.resolve(import.meta.dir, '..', 'web', 'src', 'crm')
const read = (p: string) => fs.readFileSync(path.join(WEB, p), 'utf8')

/** Menu path → its label, from every home-care group's nav. */
const labels = new Map<string, string>()
for (const g of fs.readdirSync(path.join(WEB, 'pages', 'homecare'))) {
  const f = path.join('pages', 'homecare', g, 'index.tsx')
  if (!fs.existsSync(path.join(WEB, f))) continue
  for (const m of read(f).matchAll(/\{\s*to:\s*'([^']+)'[^}]*?label:\s*'([^']+)'/g)) labels.set(m[1], m[2])
}
/** "Section › Label" for every menu item, as the menu shows it. */
const menu = new Set<string>()
for (const m of read('verticals/homecare.tsx').matchAll(/\['(\/crm\/[^']+)',\s*'([^']+)'\]/g)) {
  const label = labels.get(m[1])
  if (label) menu.add(`${m[2]} › ${label}`)
}

const SECTIONS = 'Operations|Scheduling|Daily care|Caregivers|Financial|Compliance|Communication|Settings'
/**
 * Each "Section › …" in a text, as the menu item it names: the longest item of that section the words start with, or —
 * when none does — the next three words, which the menu does not have.
 */
const named = (text: string) => [...text.matchAll(new RegExp(`\\b(${SECTIONS}) › `, 'g'))].map((m) => {
  const rest = text.slice(m.index! + m[0].length)
  const hit = [...menu].filter((p) => p.startsWith(`${m[1]} › `)).map((p) => p.slice(m[1].length + 3))
    .filter((label) => rest.startsWith(label) && !/[\w]/.test(rest.charAt(label.length)))
    .sort((a, b) => b.length - a.length)[0]
  return `${m[1]} › ${hit ?? rest.split(/\s+/).slice(0, 3).join(' ')}`
})

describe("home care's guides name the menu as it is", () => {
  test('the menu was read', () => {
    expect(menu.size).toBeGreaterThan(30)
    expect(menu.has('Financial › Payroll')).toBe(true)
  })

  test('every "Section › Item" a guide names is on the menu', () => {
    const wrong: string[] = []
    for (const a of HOMECARE_STARTER.helpArticles) for (const p of named(a.content)) if (!menu.has(p)) wrong.push(`${a.title}: ${p}`)
    expect(wrong).toEqual([])
  })

  test('the check catches a path the menu does not have (mutation check)', () => {
    expect(named('Go to Operations › Referrals for new leads.')).toEqual(['Operations › Referrals for new'])
    expect(menu.has('Operations › Referrals for new')).toBe(false)
    expect(named('Go to Financial › Payroll. Then Scheduling › Schedule Hub.')).toEqual(['Financial › Payroll', 'Scheduling › Schedule Hub'])
  })

  test('no guide carries a template placeholder', () => {
    expect(HOMECARE_STARTER.helpArticles.filter((a) => /\{\{|\}\}/.test(a.content)).map((a) => a.title)).toEqual([])
  })
})
