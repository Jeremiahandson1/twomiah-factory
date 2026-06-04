// One-off sanity check that the Namecheap registrar wiring works against
// whichever environment (sandbox or prod) the env vars point at. Hits
// checkAvailability() for a few domains and prints what comes back.
//
// Run: cd apps/api && bun run scripts/test-namecheap-availability.ts
//
// Requires NAMECHEAP_API_USER, _API_KEY, _USERNAME, _CLIENT_IP in .env.
// Honors NAMECHEAP_SANDBOX=true for sandbox host routing.

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load .env so process.env is populated for the registrar service.
const envPath = path.join(__dirname, '..', '.env')
const envContent = fs.readFileSync(envPath, 'utf8')
for (const rawLine of envContent.split('\n')) {
  const line = rawLine.replace(/\r$/, '')
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m && !process.env[m[1].trim()]) {
    process.env[m[1].trim()] = m[2].trim()
  }
}

const { getRegistrar, isRegistrarConfigured } = await import('../src/services/registrar')

if (!isRegistrarConfigured()) {
  console.error('Registrar not configured. Missing one of NAMECHEAP_API_USER, _API_KEY, _USERNAME, _CLIENT_IP.')
  process.exit(1)
}

const sandbox = process.env.NAMECHEAP_SANDBOX === 'true'
console.log(`Environment: ${sandbox ? 'SANDBOX' : 'PRODUCTION'}`)
console.log(`ApiUser: ${process.env.NAMECHEAP_API_USER}`)
console.log(`UserName: ${process.env.NAMECHEAP_USERNAME}`)
console.log(`ClientIp: ${process.env.NAMECHEAP_CLIENT_IP}`)
console.log('')

const TEST_DOMAINS = [
  'twomiah.com',                          // expect: registered (you own it) — should come back unavailable
  'this-domain-definitely-does-not-exist-twomiah-12345.com',  // expect: available
  'google.com',                            // expect: unavailable
  'test-site-twomiah-' + Date.now() + '.com', // randomized — should be available
]

const reg = await getRegistrar()
for (const domain of TEST_DOMAINS) {
  try {
    const result = await reg.checkAvailability(domain)
    const flag = result.available ? '✅ AVAILABLE' : '❌ taken'
    const extra = [
      result.priceUsd ? `$${result.priceUsd}/yr` : null,
      result.premium ? 'premium' : null,
      result.errorMessage ? `err: ${result.errorMessage}` : null,
    ].filter(Boolean).join('  ')
    console.log(`${flag.padEnd(15)} ${domain.padEnd(60)} ${extra}`)
  } catch (e: any) {
    console.log(`💥 ERROR        ${domain.padEnd(60)} ${e.message}`)
  }
}
