// CI guard: the owner can set their own branding. company.logo and company.primaryColor have existed on the
// row and been accepted by PUT /api/company all along, and the portal header, the Stripe payment form and the
// invoice PDF already read them — there was simply no field anywhere to set them. (Contractor T14 M8)
//
// The colour is the part that needs the care: it goes straight into a CSS value and into Stripe's appearance
// object, where anything that is not a hex paints nothing at all. Refuse it rather than store it.
//   bun scripts/check-branding-settings.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const page = read('packages/tenant-ui/src/shell/SettingsPage.tsx')
if (!page) fail('packages/tenant-ui/src/shell/SettingsPage.tsx is missing')

// the fields exist, are typed, and are filled from what is stored
if (!/interface CompanyForm \{[^}]*logo: string; primaryColor: string/s.test(page)) fail('the company form must carry logo and primaryColor')
if (!/logo: company\.logo \|\| '', primaryColor: company\.primaryColor \|\| '',/.test(page)) fail('…and must load what is already stored, or saving would wipe it')
if (!/>Branding</.test(page)) fail('the Company tab needs a Branding section — there was nowhere to set either value')
if (!/placeholder="https:\/\/example\.com\/logo\.png"/.test(page)) fail('a logo field must be offered')
if (!/aria-label="Pick brand colour"/.test(page) || !/type="color"/.test(page)) fail('a colour picker must be offered, not only a text box')
if (!/alt="Company logo preview"/.test(page)) fail('the logo should be previewed, so a broken link is obvious before saving')

// the colour is validated, and blank is a real answer
if (!/\/\^#\[0-9a-fA-F\]\{6\}\$\/\.test\(colour\)/.test(page)) fail('a brand colour must be checked against a 6-digit hex before it is saved')
if (!/Brand colour must be a 6-digit hex value/.test(page)) fail('…with a message that says what a good value looks like')
if (!/const colour = String\(fields\.primaryColor \|\| ''\)\.trim\(\)/.test(page)) fail('…and the value must be trimmed, so spaces do not become a colour')
if (!/if \(colour && !/.test(page)) fail('blank must stay allowed — it means "use the default"')

// the default must agree with what the portal actually falls back to
const portalLayout = read('packages/tenant-ui/src/portal/PortalLayout.tsx')
const fallback = portalLayout.match(/primaryColor as string\) \|\| '(#[0-9a-fA-F]{6})'/)?.[1]
const settingsDefault = page.match(/const DEFAULT_BRAND = '(#[0-9a-fA-F]{6})'/)?.[1]
if (!settingsDefault) fail('the settings page must name the default brand colour')
if (fallback && settingsDefault && fallback.toLowerCase() !== settingsDefault.toLowerCase()) {
  fail(`the settings default (${settingsDefault}) must match what the portal falls back to (${fallback}) — otherwise the picker shows a colour the customer never sees`)
}

if (failed) { console.error(`\nbranding settings: ${failed} check(s) FAILED`); process.exit(1) }
console.log('branding settings: the owner can set the logo and colour their customers already see')
