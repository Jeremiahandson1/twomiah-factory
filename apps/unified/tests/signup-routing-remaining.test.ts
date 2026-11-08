// The sign-up's trade choices (twomiah.com signup.html <select id="industry">) each reach the right CRM and the right unified
// vertical. The live tests from landscaping on build their test sites directly (owner's decision 11/08: the sign-up itself was
// checked through four trades and is the same code for every one), so THIS is what stands in for picking the trade on the
// sign-up page: a landscaper must never be handed a contractor's system.
import { test, expect } from 'bun:test'
import { crmTemplateFor, verticalFor } from '../../api/src/config/industryRouting.ts'

// The unified vertical each Factory vertical runs as — the map in apps/api/src/unified/factory.ts (UNIFIED_VERTICAL_OF), read
// from its source so this test does not boot the Factory's deploy code.
const factorySource = await Bun.file(new URL('../../api/src/unified/factory.ts', import.meta.url)).text()
const mapText = factorySource.slice(factorySource.indexOf('const UNIFIED_VERTICAL_OF'), factorySource.indexOf('}', factorySource.indexOf('const UNIFIED_VERTICAL_OF')))
const unifiedOf = (v: string) => mapText.match(new RegExp(`\\b${v}: '([a-z]+)'`))?.[1] ?? null

// value on the sign-up page → [Factory vertical, CRM template, unified vertical]
const TRADES: Record<string, [string, string, string]> = {
  landscaping: ['landscaping', 'crm-landscaping', 'landscaping'],
  restaurant: ['events', 'crm-restaurant', 'restaurant'],
  bar_and_grill: ['bar', 'crm-bar', 'bar'],
  hvac: ['fieldservice', 'crm-fieldservice', 'fieldservice'],
  plumbing: ['fieldservice', 'crm-fieldservice', 'fieldservice'],
  electrical: ['fieldservice', 'crm-fieldservice', 'fieldservice'],
  painter: ['fieldservice', 'crm-fieldservice', 'fieldservice'],
  retail: ['store', 'crm-store', 'store'],
  other: ['basic', 'crm-basic', 'basic'],
}

for (const [value, [vertical, crm, unified]] of Object.entries(TRADES)) {
  test(`the sign-up's "${value}" becomes ${unified} (${crm})`, () => {
    expect(verticalFor(value) as string).toBe(vertical)
    expect(crmTemplateFor(value) as string).toBe(crm)
    expect(unifiedOf(vertical)).toBe(unified)
  })
}
