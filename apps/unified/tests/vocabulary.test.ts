// One vocabulary per business (VerticalSettings.vocabulary, packages/tenant-ui labels/vocabulary.ts), and the screens
// every business shares speaking from it — not a contractor's words, and not a sentence per screen per vertical. The bar
// live test (2026-10-25) found "Their jobs and records stay", "customers and crew members", "ask for a quote" and a
// Reviews page promising requests "when jobs are completed" on a bar; the restaurant's own Reviews override said the
// same, and the vet's promised requests "after a visit" that nothing sends.
import { describe, test, expect, afterAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { getFeaturesForTemplate } from '../../../packages/tenant-backend/src/featureRegistry.ts'
import { registerVocabulary, JOB_TRADE } from '../../../packages/tenant-ui/src/labels/vocabulary.ts'
import { reviewsCopy } from '../../../packages/tenant-ui/src/reviews/reviewsCopy.ts'
import { privacyHtml, termsHtml } from '../server/site/legal.ts'

const ROOT = path.join(import.meta.dir, '..')
const REPO = path.join(ROOT, '..', '..')
const verticals = fs.readdirSync(path.join(ROOT, 'verticals')).filter((v) => fs.existsSync(path.join(ROOT, 'verticals', v, 'settings.ts')))
const load = async (v: string) => (await import(path.join(ROOT, 'verticals', v, 'settings.ts'))).default as any
afterAll(() => registerVocabulary(null))

describe('every business has its vocabulary', () => {
  for (const v of verticals) {
    test(v, async () => {
      const w = (await load(v)).vocabulary
      expect(w).toBeTruthy()
      for (const k of ['customer', 'team']) expect(typeof w[k].one === 'string' && typeof w[k].many === 'string').toBe(true)
      expect(w.work === null || (typeof w.work.one === 'string' && typeof w.work.many === 'string')).toBe(true)
      expect(['Portfolio', 'Gallery']).toContain(w.gallery)
      expect(typeof w.customerCompany).toBe('boolean')
    })
  }

  // reviewAfter says what the server does: a finished job (crm/services.ts, the roof's jobs.ts) or a salon visit
  // (salon/appointments.ts). Anything else claims a request nothing sends.
  for (const v of verticals) {
    test(`${v}: "asks by itself after …" only where the server does`, async () => {
      const s = await load(v)
      const offered = new Set(getFeaturesForTemplate(s.featureSet).map((f) => f.id))
      const sends = offered.has('jobs') || v === 'salon'
      expect(s.vocabulary.reviewAfter !== null).toBe(sends)
    })
  }
})

describe('the Reviews page, in each business\'s words', () => {
  for (const v of verticals) {
    test(v, async () => {
      const s = await load(v)
      const offered = new Set(getFeaturesForTemplate(s.featureSet).map((f) => f.id))
      registerVocabulary(s.vocabulary)
      const copy = reviewsCopy({ hasFeature: (f: string) => offered.has(f) })
      const words = Object.values(copy).filter((x) => typeof x === 'string').join(' | ')
      // a job only where the business's own work is one (a dealer's "service job" counts)
      if (!/\bjob\b/.test(s.vocabulary.work?.one || '')) expect(words).not.toMatch(/\bjobs?\b/i)
      expect(words).toContain(s.vocabulary.customer.one)
      // Nothing asks by itself: no automatic switch, no "after …" promise
      if (!s.vocabulary.reviewAfter) expect({ auto: copy.auto, help: copy.autoRequestHelp }).toEqual({ auto: false, help: '' })
      // The Send review request button is on every customer's page; on a job's only where the jobs screens are
      expect(!!s.vocabulary.work && copy.manualHelp.includes(`${s.vocabulary.work.one}'s page`)).toBe(offered.has('jobs'))
    })
  }

  test('a template (no vocabulary registered) reads as it was written: a contractor\'s', () => {
    registerVocabulary(null)
    const copy = reviewsCopy()
    expect(copy.subjectLabel).toBe('Job')
    expect(copy.auto).toBe(true)
    expect(copy.subtitle).toContain(JOB_TRADE.reviewAfter!)
  })
})

describe('the public Privacy and Terms fit every business', () => {
  test('no quote, no service visit', () => {
    const s = { companyName: 'Tavern', email: 'a@b.c', phone: '', address: '' } as any
    for (const html of [privacyHtml(s), termsHtml(s)]) expect(html).not.toMatch(/ask for a quote|provide the service|completed visit/)
  })
})

/**
 * The screens every business sees speak no trade's words of their own: what changes by business comes from the
 * vocabulary or a feature. Read from the source — each string and each piece of JSX text, not the comments.
 */
const SHARED_SCREENS = [
  'packages/tenant-ui/src/reviews/ReviewsPage.tsx',
  'packages/tenant-ui/src/settings/IntegrationsPage.tsx',
  'packages/tenant-ui/src/shell/SettingsPage.tsx',
  'packages/tenant-ui/src/settings/AccountOffboardPage.tsx',
  'packages/tenant-ui/src/leads/NewLeadsPage.tsx',
  'packages/tenant-ui/src/invoicing/InvoicesPage.tsx',
  'packages/tenant-ui/src/people/ExpensesPage.tsx',
  // Marketing (salon live test, 2026-10-25): "All contacts with an email", sentences about "contacts" to a salon.
  'packages/tenant-ui/src/marketing/MarketingPage.tsx',
  'packages/tenant-ui/src/marketing/EmailEditor.tsx',
  'packages/tenant-ui/src/marketing/marketingCopy.ts',
  'apps/unified/server/site/legal.ts',
]
const TRADE = /\b(jobs?|crews?|quotes?|contractors?|subcontractors?)\b/i
/** Who the business serves comes from the vocabulary too: a bar's Integrations still said "customers" four times (bar recheck). */
const SERVED = /\b(customers?|clients?|guests?)\b/i
/** A word that only shows behind its feature: `hasFeature('quotes') ? 'quotes and ' : ''`. */
const GATED = /hasFeature\(\s*'(quotes|jobs)'\s*\)/

function readableStrings(src: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = []
  src.split(/\r?\n/).forEach((l, i) => {
    const t = l.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*') || t.startsWith('import ')) return
    if (GATED.test(l)) return
    const code = l.replace(/\{\/\*.*?\*\/\}/g, '').replace(/\/\/.*$/, '')
    for (const m of code.matchAll(/(['"`])((?:(?!\1).)*)\1/g)) {
      const s = m[2].replace(/\$\{[^}]*\}/g, ' ')
      if (/\s/.test(s.trim()) || /^[A-Z]/.test(s)) out.push({ line: i + 1, text: s })
    }
    for (const m of code.matchAll(/>([^<>{}]+)</g)) if (m[1].trim()) out.push({ line: i + 1, text: m[1] })
  })
  return out
}

describe('shared screens carry no trade words of their own', () => {
  for (const file of SHARED_SCREENS) {
    test(file, () => {
      const src = fs.readFileSync(path.join(REPO, file), 'utf8')
      const found = readableStrings(src).filter((s) => TRADE.test(s.text) || SERVED.test(s.text)).map((s) => `${s.line}: ${s.text.trim().slice(0, 100)}`)
      expect(found).toEqual([])
    })
  }

  // Marketing's audience is the vocabulary's people, never "contacts" (salon live test, 2026-10-25: "All contacts with an
  // email" on a salon). Elsewhere "contact" names the record, so this is the marketing screens' rule only.
  for (const file of SHARED_SCREENS.filter((f) => f.includes('/marketing/'))) {
    test(`${file}: whom an email goes to is the business's word`, () => {
      const src = fs.readFileSync(path.join(REPO, file), 'utf8')
      expect(readableStrings(src).filter((s) => /\bcontacts?\b/i.test(s.text)).map((s) => `${s.line}: ${s.text.trim()}`)).toEqual([])
    })
  }
  test('the marketing rule reads the old audience line as a violation (mutation check)', () => {
    expect(readableStrings(`<option value="all">All contacts with an email</option>`).some((s) => /\bcontacts?\b/i.test(s.text))).toBe(true)
  })

  test('the reader finds a trade word where one is written (mutation check)', () => {
    expect(readableStrings(`  const x = 'Their jobs and records stay.'`).some((s) => TRADE.test(s.text))).toBe(true)
    expect(readableStrings(`  <p>Send updates to customers and crew members.</p>`).some((s) => TRADE.test(s.text))).toBe(true)
    expect(readableStrings(`  // a comment about jobs`).length).toBe(0)
  })
})
