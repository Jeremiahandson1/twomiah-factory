// Unit tests for sanitizeSections — the function that filters Claude's
// composer output to keep only valid section type/variant combinations
// the template can actually render. Pure logic, no external deps,
// runs in CI.
//
// Run from apps/api:
//   bun run scripts/verify-sanitize-sections.ts
import { SECTION_SCHEMA } from '../src/services/sectionComposer'

// sanitizeSections is not exported — we re-implement the test interface
// by importing through composeSite's behavior. But for direct unit
// testing, we re-declare the same logic here. Keep in sync with
// sectionComposer.ts sanitizeSections.
function sanitizeSections(raw: any): Array<{ type: string; variant: string; data: any }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ type: string; variant: string; data: any }> = []
  for (const s of raw.slice(0, 12)) {
    if (!s || typeof s !== 'object') continue
    const type = String(s.type || '').toLowerCase()
    const variant = String(s.variant || '').toLowerCase()
    if (!(type in SECTION_SCHEMA)) continue
    const variants = (SECTION_SCHEMA as any)[type]
    if (!(variant in variants)) continue
    const data = (s.data && typeof s.data === 'object') ? s.data : {}
    if (Array.isArray(data.items)) data.items = data.items.slice(0, 8)
    if (Array.isArray(data.stats)) data.stats = data.stats.slice(0, 6)
    if (Array.isArray(data.bullets)) data.bullets = data.bullets.slice(0, 6)
    out.push({ type, variant, data })
  }
  return out
}

interface Case { name: string; input: any; expectedLength: number; check?: (result: any[]) => string | null }
const cases: Case[] = [
  { name: 'null input', input: null, expectedLength: 0 },
  { name: 'undefined input', input: undefined, expectedLength: 0 },
  { name: 'empty array', input: [], expectedLength: 0 },
  { name: 'non-array (string)', input: 'not an array', expectedLength: 0 },
  { name: 'non-array (object)', input: {}, expectedLength: 0 },
  {
    name: 'one valid hero/full-bleed',
    input: [{ type: 'hero', variant: 'full-bleed', data: { title: 'X' } }],
    expectedLength: 1,
  },
  {
    name: 'mixed valid + invalid type',
    input: [
      { type: 'hero', variant: 'full-bleed', data: { title: 'X' } },
      { type: 'nonsense', variant: 'whatever', data: {} },
      { type: 'cta', variant: 'banner', data: { heading: 'Y' } },
    ],
    expectedLength: 2,
  },
  {
    name: 'mixed valid + invalid variant',
    input: [
      { type: 'hero', variant: 'full-bleed', data: {} },
      { type: 'hero', variant: 'sparkly-disco-ball', data: {} },  // invalid variant
    ],
    expectedLength: 1,
  },
  {
    name: 'case-normalized type/variant',
    input: [{ type: 'HERO', variant: 'Full-Bleed', data: {} }],
    expectedLength: 1,
  },
  {
    name: 'missing data → defaults to empty object',
    input: [{ type: 'cta', variant: 'banner' }],
    expectedLength: 1,
    check: (r) => typeof r[0].data === 'object' && r[0].data !== null ? null : 'data should be an object',
  },
  {
    name: 'caps items at 8',
    input: [{
      type: 'services',
      variant: 'cards-grid',
      data: { items: Array.from({ length: 20 }, (_, i) => ({ title: 'S' + i })) },
    }],
    expectedLength: 1,
    check: (r) => r[0].data.items.length === 8 ? null : 'items should be capped at 8, got ' + r[0].data.items.length,
  },
  {
    name: 'caps stats at 6',
    input: [{
      type: 'hero',
      variant: 'centered-stats',
      data: { stats: Array.from({ length: 15 }, (_, i) => ({ value: i, label: 'L' + i })) },
    }],
    expectedLength: 1,
    check: (r) => r[0].data.stats.length === 6 ? null : 'stats should be capped at 6, got ' + r[0].data.stats.length,
  },
  {
    name: 'caps bullets at 6',
    input: [{
      type: 'cta',
      variant: 'split',
      data: { bullets: Array.from({ length: 10 }, (_, i) => 'B' + i) },
    }],
    expectedLength: 1,
    check: (r) => r[0].data.bullets.length === 6 ? null : 'bullets should be capped at 6, got ' + r[0].data.bullets.length,
  },
  {
    name: 'caps total sections at 12',
    input: Array.from({ length: 20 }, () => ({ type: 'cta', variant: 'banner', data: { heading: 'X' } })),
    expectedLength: 12,
  },
  {
    name: 'all new section types (about/team/contact) sanitize through',
    input: [
      { type: 'about', variant: 'story', data: { title: 'Our story' } },
      { type: 'team', variant: 'grid', data: { members: [] } },
      { type: 'contact', variant: 'form-info', data: { heading: 'Talk to us' } },
    ],
    expectedLength: 3,
  },
  {
    name: 'null entries inside array are skipped',
    input: [null, undefined, { type: 'cta', variant: 'banner', data: {} }, false],
    expectedLength: 1,
  },
]

let passed = 0
let failed = 0
for (const c of cases) {
  const result = sanitizeSections(c.input)
  let status: 'ok' | 'fail' = 'ok'
  let detail = ''
  if (result.length !== c.expectedLength) {
    status = 'fail'
    detail = `expected ${c.expectedLength} sections, got ${result.length}`
  } else if (c.check) {
    const checkResult = c.check(result)
    if (checkResult) { status = 'fail'; detail = checkResult }
  }
  if (status === 'ok') { passed++; console.log('OK   ' + c.name) }
  else { failed++; console.log('FAIL ' + c.name + ' — ' + detail) }
}

console.log(`\n${passed}/${cases.length} tests passed.`)
process.exit(failed === 0 ? 0 : 1)
