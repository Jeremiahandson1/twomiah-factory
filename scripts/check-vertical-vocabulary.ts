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
const defaultsOf = (modulePath: string, constName: string): string[] => {
  const src = read(`${ROOT}packages/tenant-ui/src/${modulePath}/types.ts`)
  const m = new RegExp(`${constName}[^=]*=\\s*\\{([^}]*)\\}`).exec(src)
  return m ? (m[1].match(/(\w+)\s*:/g) || []).map((x) => x.replace(/\s*:$/, '')) : []
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

if (failed) { console.error(`\nvertical vocabulary: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`vertical vocabulary: ${wrappers} wrapper(s) pass their own config rather than inheriting the contractor default, ${fieldChecks} config(s) answer for EVERY field rather than leaving some to it, and ${configFiles} config file(s) across ${NON_TRADE.length} non-trade verticals carry no building-trade vocabulary`)
