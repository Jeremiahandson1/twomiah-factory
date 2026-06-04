// Sandbox-only register flow exercise. Picks a randomized fake domain so
// re-runs don't collide, calls register() with a full registrant contact,
// then immediately calls getDomain() to verify the registration showed
// up in the sandbox account, and unlock() + getEppCode() to make sure
// the transfer-out path also XML-parses correctly.
//
// SAFETY: refuses to run unless NAMECHEAP_SANDBOX=true. We do NOT want
// this script to accidentally buy a real domain.
//
// Run: cd apps/api && bun run scripts/test-namecheap-register.ts

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const line = rawLine.replace(/\r$/, '')
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim()
}

if (process.env.NAMECHEAP_SANDBOX !== 'true') {
  console.error('REFUSING TO RUN: NAMECHEAP_SANDBOX is not "true". This script is sandbox-only.')
  process.exit(1)
}

const { getRegistrar } = await import('../src/services/registrar')

// Randomized domain so the test is idempotent.
const stamp = Date.now().toString(36)
const domain = `twomiah-test-${stamp}.com`

console.log(`Sandbox register flow — domain: ${domain}\n`)

const reg = await getRegistrar()

// ── 1) Availability sanity check ─────────────────────────────────────────
console.log('[1/4] checkAvailability…')
const avail = await reg.checkAvailability(domain)
console.log(`     available=${avail.available} ${avail.priceUsd ? `$${avail.priceUsd}/yr` : ''} ${avail.errorMessage || ''}`)
if (!avail.available) {
  console.error('     domain came back unavailable — bailing.')
  process.exit(1)
}

// ── 2) Register ──────────────────────────────────────────────────────────
console.log('\n[2/4] register…')
const reqResult = await reg.register(domain, {
  years: 1,
  whoisPrivacy: true,
  autoRenew: false,
  registrantContact: {
    firstName: 'Twomiah',
    lastName: 'Test',
    email: 'twomiah14@gmail.com',
    phone: '+1.6085550142',
    address1: '123 Main St',
    city: 'Madison',
    stateProvince: 'WI',
    postalCode: '53703',
    country: 'US',
    organization: 'Twomiah Test Sandbox',
  },
})
console.log('     ', JSON.stringify(reqResult, null, 2).replace(/\n/g, '\n      '))
if (!reqResult.success) {
  console.error('     register FAILED — bailing before info/unlock/EPP.')
  process.exit(1)
}

// ── 3) Info round-trip ───────────────────────────────────────────────────
console.log('\n[3/4] getDomain (should reflect new registration)…')
const info = await reg.getDomain(domain)
console.log('     ', info ? JSON.stringify(info, null, 2).replace(/\n/g, '\n      ') : 'null')

// ── 4) Offboard pieces — unlock + EPP code ───────────────────────────────
console.log('\n[4/4] unlock + getEppCode (transfer-out prep)…')
const unlock = await reg.unlock(domain)
console.log(`     unlock: ${JSON.stringify(unlock)}`)
const epp = await reg.getEppCode(domain)
console.log(`     epp:    ${JSON.stringify(epp)}`)

console.log('\nDone. If all four steps showed success/data, the full register + transfer-out lifecycle is wired correctly.')
