// CI guard: crm-restaurant (events) pages show calendar days in the viewer's timezone, not UTC.
//  T14 HIGH-4: a payment paid 21:30 CDT (02:30Z next day) rendered "Paid 2026-09-14" because the badge
//  used new Date(paidAt).toISOString().slice(0, 10). The overdue checks on the event page and dashboard
//  used the same UTC "today", so after ~7pm a payment due today showed overdue.
//   bun scripts/check-events-local-dates.ts
import { readFileSync, readdirSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const dir = new URL('../templates/crm-restaurant/frontend/src/pages/events/', import.meta.url)

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// (1) no UTC day-slicing anywhere in the events pages.
for (const f of readdirSync(dir).filter(n => n.endsWith('.tsx'))) {
  const src = strip(readFileSync(new URL(f, dir), 'utf8'))
  if (/toISOString\(\)\s*\.\s*(slice|substring|substr|split)\(/.test(src)) fail(`${f}: derives a calendar day from toISOString() (UTC) — use localDay()`)
}

// (2) the one helper builds the day from local getters, and the payment badge uses it.
const eventsPage = strip(readFileSync(new URL('EventsPage.tsx', dir), 'utf8'))
if (!/export function localDay\([\s\S]*?getFullYear\(\)[\s\S]*?getMonth\(\)[\s\S]*?getDate\(\)/.test(eventsPage)) fail('EventsPage.tsx must export localDay() built from getFullYear/getMonth/getDate')
// Paid state now comes from the event's invoice (#149), so there is no paid-date badge; what still
// compares against "today" is the overdue check on both pages, and it must use the local day.
for (const f of ['EventDetailPage.tsx', 'DashboardPage.tsx']) {
  const src = strip(readFileSync(new URL(f, dir), 'utf8'))
  if (!/function isOverdue[\s\S]{0,200}?<\s*localDay\(\)/.test(src)) fail(`${f}: isOverdue must compare against localDay()`)
}

if (failed) { console.error(`\nevents local dates: ${failed} check(s) FAILED`); process.exit(1) }
console.log('events local dates: no UTC day-slicing; overdue checks use the viewer\'s calendar day')
