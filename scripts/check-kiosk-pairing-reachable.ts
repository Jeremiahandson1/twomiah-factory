// CI guard: the kiosk pairing flow is reachable, and a kiosk that has traded is not deletable.
//
// The pairing flow was built end to end — POST /api/kiosk/devices mints a one-time code, the tablet
// spends it at POST /api/kiosk/pair — and the kiosk screen instructs the customer in so many words:
//
//     "Add this device under Settings → Kiosks, then enter the pairing code shown there."
//
// Settings had no Kiosks tab. The product pointed at a screen nobody had built, and because the code
// is returned only by the mint call and never again, there was no way in the entire UI to produce
// one. Every kiosk sat on the pairing screen for good. (T27 H1)
//
// The second rule is about what "remove" may mean. kiosk_sessions.kiosk_device_id is how a sale is
// traced back to the terminal that took it, so a kiosk that has traded is part of the sales record —
// the same reason a cannabis sale is voidable rather than deletable. Delete is for a kiosk added by
// mistake, which has no history to orphan; anything else is revoked.
//
//   bun scripts/check-kiosk-pairing-reachable.ts
import { readFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const read = (rel: string) => { try { return readFileSync(ROOT + rel, 'utf8') } catch { fail(`${rel} is missing`); return '' } }

const T = 'templates/crm-dispensary'
const settings = read(`${T}/frontend/src/pages/SettingsPage.tsx`)
const kioskPage = read(`${T}/frontend/src/pages/KioskOrderPage.tsx`)
const routes = read(`${T}/backend/src/routes/kiosk.ts`)

// ── the screen the product sends people to has to exist ───────────────────────────────────────────
{
  // If the kiosk still tells a manager to go to Settings → Kiosks, that tab must be there. Either may
  // change — what may not happen is the two drifting apart again.
  const directsToSettings = /Settings\s*(?:&rarr;|→|-&gt;)\s*Kiosks/.test(kioskPage)
  const tabExists = /\{ id: 'kiosks', label: 'Kiosks'/.test(settings)
  if (directsToSettings && !tabExists)
    fail('KioskOrderPage tells the manager to go to Settings → Kiosks, but SettingsPage has no Kiosks tab — the product is pointing at a screen that does not exist')
  if (tabExists && !directsToSettings)
    fail('the Kiosks tab exists but the kiosk screen no longer says where to go — an unpaired tablet gives the manager nothing to act on')
}

// ── and it has to be able to drive the whole flow ─────────────────────────────────────────────────
{
  if (!/api\.post\('\/api\/kiosk\/devices'/.test(settings))
    fail('Settings must be able to mint a kiosk — POST /api/kiosk/devices is the only thing that produces a pairing code')
  if (!/made\.pairingCode/.test(settings))
    fail('…and must put the code on screen: the server returns it exactly once and never hands it back')
  if (!/api\.get\('\/api\/kiosk\/devices'\)/.test(settings))
    fail('…and must list the kiosks, or a manager cannot tell which tablet is which')
  if (!/\/api\/kiosk\/devices\/\$\{k\.id\}\/revoke/.test(settings))
    fail('…and must offer revoke, which is how a lost or stolen tablet is cut off')
  if (!/api\.delete\(`\/api\/kiosk\/devices\/\$\{k\.id\}`\)/.test(settings))
    fail('…and delete, for one added by mistake')
  if (!/hasFeature\('kiosk'\) \? \[\{ id: 'kiosks'/.test(settings))
    fail('…and the tab is gated on the kiosk feature, matching the Kiosk nav item — a tenant without kiosks should not be offered kiosk settings')
}

// ── delete may not orphan the sales record ────────────────────────────────────────────────────────
{
  if (!/app\.delete\('\/devices\/:id', authenticate, requireRole\('manager'\)/.test(routes))
    fail("DELETE /devices/:id must exist and be a manager's button")
  if (!/SELECT COUNT\(\*\)::int as count FROM kiosk_sessions\s*\n\s*WHERE kiosk_device_id = \$\{id\} AND company_id = \$\{user\.companyId\}/.test(routes))
    fail('…and must count the kiosk\'s sessions before removing it — that column is how a sale is traced to the terminal that took it')
  if (!/if \(Number\(count\) > 0\) \{/.test(routes))
    fail('…refusing when there is any history')
  if (!/\}, 409\)/.test(routes))
    fail('…with 409, not a silent success')
  if (!/Revoke it instead/.test(routes))
    fail('…and telling the manager what to do instead, or the button just looks broken')
  // scoped to the delete handler: the whole route file is company-scoped, but THIS query is the one
  // that decides whether a row is destroyed
  const from = routes.indexOf("app.delete('/devices/:id'")
  const handler = from < 0 ? '' : routes.slice(from, from + 2000)
  if (handler && !/DELETE FROM kiosk_devices WHERE id = \$\{id\} AND company_id = \$\{user\.companyId\}/.test(handler))
    fail('…and the delete itself must be scoped to the tenant, or one company can destroy another\'s device')
}

// ── revoke stays the answer for a device in service ───────────────────────────────────────────────
{
  if (!/app\.post\('\/devices\/:id\/revoke'/.test(routes))
    fail('revoke must remain — it is the right operation for a tablet that has been in service')
  if (!/SET status = 'revoked', token_hash = NULL/.test(routes))
    fail('…and must actually kill the token, not just relabel the row')
}

console.log(failed ? `\n${failed} failure(s)` : 'ok: the kiosk pairing screen exists and a traded kiosk keeps its history')
process.exit(failed ? 1 : 0)
