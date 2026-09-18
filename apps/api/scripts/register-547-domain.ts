// One-off PRODUCTION registration of 547eauclairehomecare.com using the
// factory's own Namecheap registrar module. This is NOT the tenant/Stripe
// buy flow — it's a direct register() for one of our own sites.
//
// SAFETY:
//  - Refuses to run unless NAMECHEAP_SANDBOX=false (this must hit the REAL API).
//  - Refuses to run unless the registrant address fields are supplied (no guessing).
//  - Refuses to actually register unless invoked with --confirm.
//  - The IP this runs from MUST be whitelisted on the Namecheap account, or
//    Namecheap rejects with "Invalid request IP". The factory's Render box is
//    already whitelisted; a local machine is not unless you add its public IP.
//
// Run (dry, availability + price only):
//   cd apps/api && NAMECHEAP_SANDBOX=false NAMECHEAP_API_KEY=<prod> \
//     REG_ADDR1="..." REG_CITY="..." REG_STATE="WI" REG_ZIP="..." \
//     bun run scripts/register-547-domain.ts
// Run (for real — spends ~$9.29):
//   ...same... bun run scripts/register-547-domain.ts --confirm

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
// Load .env but let an already-set process env var WIN (so prod creds passed on
// the command line override the sandbox values baked into .env).
for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const line = rawLine.replace(/\r$/, '')
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim()
}

const DOMAIN = '547eauclairehomecare.com'

if (process.env.NAMECHEAP_SANDBOX !== 'false') {
  console.error('REFUSING TO RUN: NAMECHEAP_SANDBOX must be exactly "false" to register a REAL domain.')
  console.error('   Current value:', JSON.stringify(process.env.NAMECHEAP_SANDBOX))
  process.exit(1)
}

// Registrant contact. Name/phone/email are the business's real values (from the
// site). Postal address must be supplied via env — we do NOT invent an address.
const addr1 = process.env.REG_ADDR1
const city  = process.env.REG_CITY
const state = process.env.REG_STATE || 'WI'
const zip   = process.env.REG_ZIP
if (!addr1 || !city || !zip) {
  console.error('REFUSING TO RUN: set REG_ADDR1, REG_CITY, REG_ZIP (and optionally REG_STATE, default WI).')
  process.exit(1)
}

const registrantContact = {
  firstName: process.env.REG_FIRST || 'Jeremiah',
  lastName:  process.env.REG_LAST  || 'Phillips',
  email:     process.env.REG_EMAIL || '547echomecare@gmail.com',
  phone:     process.env.REG_PHONE || '+1.7155635005',
  address1:  addr1,
  city,
  stateProvince: state,
  postalCode: zip,
  country: 'US',
  organization: process.env.REG_ORG || '547 Eau Claire Home Care',
}

const confirm = process.argv.includes('--confirm')

const { getRegistrar } = await import('../src/services/registrar')
const reg = await getRegistrar()

console.log(`PRODUCTION register — ${DOMAIN}`)
console.log('Registrant:', JSON.stringify(registrantContact, null, 2))

console.log('\n[1/2] checkAvailability (real Namecheap)…')
const avail = await reg.checkAvailability(DOMAIN)
console.log('   ', JSON.stringify(avail))
if (avail.errorMessage) { console.error('   availability call errored — likely IP-allowlist or auth. Bailing.'); process.exit(1) }
if (!avail.available) { console.error('   domain is NOT available. Bailing.'); process.exit(1) }
if (avail.premium) { console.error('   domain is PREMIUM — register manually, not via this script.'); process.exit(1) }

if (!confirm) {
  console.log('\nDRY RUN complete. Domain is available. Re-run with --confirm to register (spends ~$9.29 + ICANN fee).')
  process.exit(0)
}

console.log('\n[2/2] register (REAL — charging the Namecheap balance)…')
const result = await reg.register(DOMAIN, {
  years: Math.max(1, Math.min(10, Number(process.env.REG_YEARS) || 1)),
  whoisPrivacy: true,
  autoRenew: true,
  registrantContact,
})
console.log('   ', JSON.stringify(result, null, 2).replace(/\n/g, '\n    '))
process.exit(result.success ? 0 : 1)
