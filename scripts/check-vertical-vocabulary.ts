// CI guard: a vertical speaks its own language, and never inherits the contractor's by silence.
//
// WHY THIS EXISTS. crm-vet, crm-salon, crm-restaurant and crm-rv were cloned from the contractor CRM, so
// contractor content was their starting state rather than something added. On top of that, every shared
// module that speaks a vertical's language takes a `config` prop and falls back to a default — and every
// one of those defaults is the CONTRACTOR answer:
//
//     defaultReportingConfig = { jobsLabel: 'Jobs', jobs: true, quotes: true, projects: true, team: true }
//     leads/types.ts: "Platforms this vertical offers. Default: the trades set (Angi, HomeAdvisor, …)"
//
// So SILENCE MEANS CONTRACTOR. A wrapper that forgets its config does not render a neutral page, it
// renders a roofer's page — in a veterinary clinic — and nothing complains. That is how a dashboard
// headed "Open Jobs", documents typed "Contract / Permit / Drawing" and lead sources reading
// "Angi / HomeAdvisor" ended up in a vet CRM (vet F-11, restaurant H-02).
//
// Those are fixed. This guard is what stops them coming back, and what catches the NEXT vertical or the
// next shared page getting it wrong — because the fix so far is convention, not structure.
//
// check-vet-vocabulary.ts covers a handful of hand-named vet strings; this is the general rule.
//
//   bun scripts/check-vertical-vocabulary.ts
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/** Shared pages that take a vertical `config`. Adding one here without wiring it is the point. */
const CONFIGURED = [
  'ReportsPage', 'JobsDashboardPage', 'DocumentsPage', 'LeadsPage', 'InvoicesPage', 'QuotesPage',
  'ContactsPage', 'SchedulePage', 'BookingsPage', 'TeamPage', 'ExpensesPage', 'MarketingPage',
  'PricebookPage', 'FleetPage', 'EquipmentPage', 'AgreementsPage', 'AppShell',
]

/**
 * Verticals that do NOT sell a trade. A contractor, roofer, field-service or landscaping CRM may name
 * Angi and permits all it likes; a clinic, salon, restaurant, dealership, dispensary or shop may not.
 */
const NON_TRADE = ['crm-vet', 'crm-salon', 'crm-restaurant', 'crm-rv', 'crm-dispensary', 'crm-store']

/**
 * Trade-only words. Every one is \b-anchored and checked case-insensitively — note `lien` is a substring
 * of CLIENT, which is why a naive scan reported eighteen phantom hits across four clean templates. Match
 * whole words, and prefer the compound (`lien_waiver`) over the bare one wherever a bare form collides.
 */
const TRADE_WORDS = [
  'angi', 'homeadvisor', 'thumbtack', 'houzz', 'jobber', 'servicetitan', 'housecall',
  'submittal', 'lien_waiver', 'subcontractor', 'draw_schedule', 'punch_list', 'takeoff',
]

const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'shared' || e === 'dist') continue
    const p = `${dir}/${e}`
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e)) out.push(p)
  }
  return out
}
const read = (p: string) => { try { return readFileSync(p, 'utf8') } catch { return '' } }

const templates = readdirSync(`${ROOT}templates`).filter((t) => /^crm(-|$)/.test(t))
let wrappers = 0, configFiles = 0

for (const t of templates) {
  const root = `${ROOT}templates/${t}/frontend/src`
  if (!existsSync(root)) continue

  // ── 1. no wrapper may inherit the contractor default by saying nothing ───────────────────────────
  for (const f of walk(root)) {
    const src = read(f)
    const imports = (src.match(/import\s*\{([^}]*)\}\s*from\s*'(?:\.\.\/)+shared'/g) || []).join(' ')
    if (!imports) continue
    for (const page of CONFIGURED) {
      const m = new RegExp(`\\b${page}\\b(?:\\s+as\\s+(\\w+))?`).exec(imports)
      if (!m) continue
      wrappers++
      const local = m[1] || page
      const render = new RegExp(`<${local}\\b([^>]*)`, 'g')
      let r: RegExpExecArray | null
      while ((r = render.exec(src))) {
        if (!/\bconfig=/.test(r[1])) {
          fail(`${t}: ${f.replace(root + '/', '')} renders <${local}> (${page}) with no config — it will inherit the CONTRACTOR default, silently`)
        }
      }
    }
  }

  // ── 2. a non-trade vertical must not carry trade vocabulary in its vertical configs ──────────────
  if (!NON_TRADE.includes(t)) continue
  for (const f of readdirSync(root).filter((n) => /Config\.tsx?$/.test(n))) {
    configFiles++
    const src = read(`${root}/${f}`)
    for (const w of TRADE_WORDS) {
      if (new RegExp(`\\b${w}\\b`, 'i').test(src)) {
        fail(`${t}/${f} names "${w}" — that is a building-trade word, and this vertical does not sell a trade`)
      }
    }
  }
}

// ── 3. a vertical must ANSWER for every field, not inherit the contractor's answer for the silent ones ──
//
// Naming three fields and staying quiet about the rest is the subtle half of the same defect:
// resolveReportingConfig spreads the contractor default underneath, so each unstated field becomes the
// contractor's choice. crm-restaurant inherited `jobs: true, quotes: true` for two modules the feature
// registry does not offer it, which put a Quote-conversion tile on an events venue's Reports page —
// `showJobs` masked the jobs half, nothing masked quotes.
//
// Requiring every field is also what makes a NEW capability safe: add one to ReportingConfig and every
// vertical has to say what it wants, rather than being handed the contractor's answer in silence.
/**
 * The object literal starting at `from` (the index of its `{`), brace-matched and string-aware.
 *
 * A regex cannot do this. `/\{([^}]*)\}/` stops at the first closing brace, and every one of these
 * defaults contains `\${id}` inside a template literal — so invoicing parsed as ONE field when it has
 * thirteen, two of them the contractor-shaped `projects: true` and `jobs: true`. A guard built on that
 * reads a truncated set and reports nothing wrong for ever.
 */
function objectAt(src: string, from: number): string {
  let depth = 0
  let str: string | null = null
  const tmpl: number[] = []
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (str) {
      if (c === '\\') { i++; continue }
      if (c === str) { str = null; continue }
      if (str === '\`' && c === '$' && src[i + 1] === '{') { tmpl.push(depth); str = null; i++; depth++; continue }
      continue
    }
    if (c === "'" || c === '"' || c === '\`') { str = c; continue }
    if (c === '{') { depth++; continue }
    if (c === '}') {
      depth--
      if (tmpl.length && depth === tmpl[tmpl.length - 1]) { tmpl.pop(); str = '\`'; continue }
      if (depth === 0) return src.slice(from, i + 1)
    }
  }
  return ''
}

/** Top-level `name:` keys of an object literal, skipping anything nested inside it. */
function keysOf(obj: string): string[] {
  const inner = obj.slice(1, -1)
  const keys: string[] = []
  let depth = 0, token = ''
  let str: string | null = null
  const tmpl: number[] = []
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (str) {
      if (c === '\\') { i++; continue }
      if (c === str) { str = null; continue }
      if (str === '\`' && c === '$' && inner[i + 1] === '{') { tmpl.push(depth); str = null; i++; depth++; continue }
      continue
    }
    if (c === "'" || c === '"' || c === '\`') { str = c; token = ''; continue }
    if (c === '{' || c === '[' || c === '(') { depth++; continue }
    if (c === '}' || c === ']' || c === ')') {
      depth--
      if (tmpl.length && depth === tmpl[tmpl.length - 1]) { tmpl.pop(); str = '\`' }
      continue
    }
    if (depth !== 0) continue
    if (c === ':') { const k = token.trim(); if (/^\w+$/.test(k)) keys.push(k); token = ''; continue }
    if (c === ',') { token = ''; continue }
    token += c
  }
  return keys
}

const defaultsOf = (modulePath: string, constName: string): string[] => {
  const src = read(`${ROOT}packages/tenant-ui/src/${modulePath}/types.ts`)
  const at = new RegExp(`export const ${constName}\\b[\\s\\S]*?=\\s*\\{`).exec(src)
  if (!at) return []
  const body = objectAt(src, src.indexOf('{', at.index + at[0].length - 1))
  return body ? keysOf(body) : []
}

const PER_FIELD: Array<[label: string, modulePath: string, constName: string, file: string, exportName: string]> = [
  ['reporting', 'reporting', 'defaultReportingConfig', 'reportingConfig.ts', 'REPORTING'],
]

let fieldChecks = 0
for (const [label, modulePath, constName, file, exportName] of PER_FIELD) {
  const fields = defaultsOf(modulePath, constName)
  if (!fields.length) { fail(`could not read ${constName} — this guard cannot check ${label} fields`); continue }
  for (const t of templates) {
    const p = `${ROOT}templates/${t}/frontend/src/${file}`
    if (!existsSync(p)) continue // a vertical with its own Reports page (roof, dispensary) has no such config
    const src = read(p)
    const block = new RegExp(`${exportName}[^=]*=\\s*\\{([^}]*)\\}`).exec(src)
    if (!block) { fail(`${t}/${file} has no ${exportName} export`); continue }
    const stated = new Set((block[1].match(/(\w+)\s*:/g) || []).map((x) => x.replace(/\s*:$/, '')))
    fieldChecks++
    const silent = fields.filter((f) => !stated.has(f))
    if (silent.length) {
      fail(`${t}/${file} does not state ${silent.join(', ')} — each one silently becomes the CONTRACTOR default (${constName}); say what this vertical wants`)
    }
  }
}

// ── 4. the shared defaults are PINNED, so one cannot gain a field or flip a value unnoticed ─────
//
// Every vertical sits underneath these. When a default gains a field, each vertical silently inherits
// whatever that field says — which is precisely how crm-restaurant came to render a Quote-conversion
// tile for a module the registry does not offer it.
//
// All five were surveyed against all templates before this pin was written. Only `reporting` carried a
// harmful default (jobs/quotes = true); it is now stated by every template and enforced by PER_FIELD
// above. The other four are inherited safely, each verified rather than assumed:
//   booking        every template already states every field
//   documents      the silent ones are projects=false / markup=false (inheriting OFF adds nothing), and
//                  versions=true is backed by a documentVersion table and GET /:id/versions everywhere
//   invoicing      clientPath = /crm/contacts/:id, and vet / salon / restaurant / RV all route contacts/:id
//   jobsDashboard  jobsPath = /crm/jobs is silent only in the four trade templates, where it is correct
//
// So this does not demand the field sets stay frozen — it demands that changing one is a decision
// somebody makes on purpose, having looked at the verticals underneath.
const PINNED: Record<string, { module: string; fields: string[] }> = {
  defaultBookingConfig: { module: 'booking', fields: ['calendarLabel', 'calendarPath', 'serviceMenuPath', 'concurrentLabel', 'concurrentHelp'] },
  defaultDocumentsConfig: { module: 'files', fields: ['projects', 'types', 'markup', 'versions'] },
  // Thirteen fields, not one. `projects: true` and `jobs: true` here are contractor-shaped — every
  // template does state both, which is why invoicing has no restaurant-style defect; the pin is what
  // keeps it that way if a fourteenth field arrives.
  defaultConfig: { module: 'invoicing', fields: ['clientLabel', 'clientPath', 'jobPath', 'projects', 'jobs', 'tips', 'quoteSites', 'quoteEquipment', 'quoteCustomerMessage', 'quoteDecline', 'extraInvoiceStatuses', 'quoteNamePlaceholder', 'quickbooks'] },
  defaultReportingConfig: { module: 'reporting', fields: ['jobsLabel', 'jobs', 'quotes', 'projects', 'team', 'eventsPipeline', 'dealership'] },
  defaultJobsDashboardConfig: { module: 'reporting', fields: ['jobsLabel', 'jobsPath', 'todayBoard', 'projects'] },
}

for (const [constName, { module, fields }] of Object.entries(PINNED)) {
  const actual = defaultsOf(module, constName)
  if (!actual.length) { fail(`${module}/types.ts no longer declares ${constName} — the pin below is stale`); continue }
  const added = actual.filter((f) => !fields.includes(f))
  const gone = fields.filter((f) => !actual.includes(f))
  if (added.length) {
    fail(`${constName} gained ${added.join(', ')} — every vertical now silently inherits whatever that says. Decide what each one wants, then add the field to the pin in this guard.`)
  }
  if (gone.length) {
    fail(`${constName} no longer has ${gone.join(', ')} — if that was deliberate, update the pin in this guard so it keeps meaning something.`)
  }
}

// ── 5. the chrome wears the TENANT's colour, not a hardcoded one ────────────────────────────────
//
// tailwind.config.js maps `orange`, `primary` and `brand` to generatePalette('{{PRIMARY_COLOR}}') in
// every template, so a class in those families IS the tenant's colour — that mapping is how the fleet is
// branded, and there is no CSS-variable system (nor any need for one). crm-roof's sidebar used
// `bg-blue-600`; blue is NOT mapped, so a roofer's own colour never reached their own chrome, and the
// defect read as "brand colour is never applied" (Summit Ridge M-06).
//
// Chrome only. Page content may legitimately be blue — a semantic "in progress" chip should stay blue
// whatever the brand — so this checks the one file that draws the shell.
const BRAND_FAMILIES = ['orange', 'primary', 'brand']
const CHROME = ['components/layout/AppLayout.tsx']
// Parked templates are excluded because they may not be modified (CLAUDE.md: 'Do NOT modify
// crm-automotive'; homecare is parked too). crm-automotive's chrome IS blue and its tailwind.config.js
// has no palette mapping at all — real, and deliberately left alone rather than failing a build over a
// rule nobody is allowed to satisfy.
const PARKED = ['crm-automotive', 'crm-homecare']
let chromeFiles = 0
for (const t of templates) {
  if (PARKED.includes(t)) continue
  for (const rel of CHROME) {
    const p = `${ROOT}templates/${t}/frontend/src/${rel}`
    if (!existsSync(p)) continue
    const src = read(p)
    // A shell that delegates to the shared AppShell has no accents of its own to check.
    if (/AppShell/.test(src)) continue
    chromeFiles++
    const accents = [...src.matchAll(/(?:bg|text|border|ring|from|to)-([a-z]+)-[0-9]{2,3}/g)]
      .map((m) => m[1])
      .filter((hue) => !['gray', 'slate', 'zinc', 'neutral', 'stone', 'white', 'black', 'red', 'amber', 'yellow', 'green', 'emerald'].includes(hue))
    const offPalette = [...new Set(accents.filter((hue) => !BRAND_FAMILIES.includes(hue)))]
    if (offPalette.length) {
      fail(`${t}/${rel} paints its chrome ${offPalette.map((h) => `${h}-*`).join(', ')} — those families are not mapped to the tenant's palette, so the customer's own colour never reaches their own sidebar. Use brand-* (or orange-*/primary-*), which tailwind.config.js maps to generatePalette('{{PRIMARY_COLOR}}').`)
    }
  }
}

if (failed) { console.error(`\nvertical vocabulary: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`vertical vocabulary: ${wrappers} wrapper(s) pass their own config rather than inheriting the contractor default, ${fieldChecks} config(s) answer for EVERY field rather than leaving some to it, ${configFiles} config file(s) across ${NON_TRADE.length} non-trade verticals carry no building-trade vocabulary, and ${chromeFiles} own-layout chrome(s) wear the tenant's palette rather than a hardcoded hue`)
