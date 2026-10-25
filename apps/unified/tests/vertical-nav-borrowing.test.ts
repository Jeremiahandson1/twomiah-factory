// One vertical's own menu items (web/src/crm/verticals/<v>.tsx `nav`) all go into one shell, each shown by its features
// (shell.ts SHARED_NAV). So a feature two verticals share puts one's page in the other's menu — on purpose for the bar,
// whose parties are the restaurant's events pages, and by accident for the salon: loyalty_rewards gave a salon the
// bar's Regulars ("points on food and drink, at the register") beside its own Loyalty, and the page asked
// /api/bar/menu and was refused (live sweep, 2026-10-21). The bar already left the salon's Loyalty out (navHidden);
// the salon did not return the favour.
//
// Every page a vertical borrows from another, on ANY feature it offers (not only those on by default — an owner can
// switch one on), minus its screens.navHidden, must be one listed here. A new borrowing is a decision: list it, or
// hide it in the borrower's settings. Read from the source, as the shell's own files read `document` on import.
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { getFeaturesForTemplate } from '../../../packages/tenant-backend/src/featureRegistry.ts'

const ROOT = path.join(import.meta.dir, '..')

/** What each vertical borrows, by design. */
const BORROWS: Record<string, string[]> = {
  // A bar's private parties are the restaurant's events module (verticals/bar/settings.ts: Parties, Party Packages).
  bar: ['restaurant:/crm/events', 'restaurant:/crm/spaces', 'restaurant:/crm/menus'],
  // A restaurant (and a food truck) runs the bar's food side — menu, register, grill orders, kiosk, online ordering —
  // each behind its own feature switch; taps only with draft_taps (10/25).
  restaurant: ['bar:/crm/bar-settings', 'bar:/crm/kiosk', 'bar:/crm/menu', 'bar:/crm/orders', 'bar:/crm/register', 'bar:/crm/register-settings', 'bar:/crm/taps', 'bar:/crm/tonight', 'bar:/crm/whats-on'],
}

/** The menu items written as a literal `export const nav` array, with their owner and features. */
function ownedItems() {
  const items: { owner: string; to: string; features: string[] }[] = []
  const dir = path.join(ROOT, 'web/src/crm/verticals')
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8')
    const at = src.indexOf('export const nav: NavItem[] = [')
    if (at < 0) continue // roof / store / homecare: their nav is their own vertical's only (isRoofing, isStore, isHomecare)
    const body = src.slice(at, src.indexOf('\n]', at) + 2)
    // features: ['a', 'b'] or a constant of the file's (rv: features: DEALERSHIP, const DEALERSHIP = [...])
    const ids = (list: string) => [...list.matchAll(/'([^']+)'/g)].map((x) => x[1])
    for (const m of body.matchAll(/\{[^{}]*?to: '(\/crm\/[^']+)'[^{}]*?\}/g)) {
      const literal = /features: \[([^\]]*)\]/.exec(m[0])
      const named = /features: ([A-Z_][A-Z0-9_]*)/.exec(m[0])
      const constant = named && new RegExp(`const ${named[1]}\\b[^=]*= \\[([^\\]]*)\\]`).exec(src)
      if (named && !constant) throw new Error(`${file}: ${m[1]} is gated by ${named[1]}, which this test cannot read`)
      items.push({ owner: file.replace(/\.tsx$/, ''), to: m[1], features: literal ? ids(literal[1]) : constant ? ids(constant[1]) : [] })
    }
  }
  return items
}

describe("a vertical's menu shows another vertical's page only where that is the design", () => {
  const owned = ownedItems()

  test('the reader finds the items (the bar\'s Regulars, the salon\'s Loyalty)', () => {
    expect(owned.some((i) => i.owner === 'bar' && i.to === '/crm/regulars' && i.features.includes('loyalty_rewards'))).toBe(true)
    expect(owned.some((i) => i.owner === 'salon' && i.to === '/crm/loyalty')).toBe(true)
    // an item with no features shows everywhere: none of a vertical's own may be ungated
    expect(owned.filter((i) => i.features.length === 0)).toEqual([])
  })

  const verticals = fs.readdirSync(path.join(ROOT, 'verticals')).filter((v) => fs.existsSync(path.join(ROOT, 'verticals', v, 'settings.ts')))
  for (const v of verticals) {
    test(v, async () => {
      const s: any = (await import(path.join(ROOT, 'verticals', v, 'settings.ts'))).default
      const offered = new Set(getFeaturesForTemplate(s.featureSet).map((d) => d.id))
      const hidden = new Set<string>(s.screens?.navHidden || [])
      const borrowed = owned
        .filter((i) => i.owner !== v && !hidden.has(i.to) && i.features.some((f) => offered.has(f)))
        .map((i) => `${i.owner}:${i.to}`).sort()
      expect(borrowed).toEqual([...(BORROWS[v] || [])].sort())
    })
  }
})
