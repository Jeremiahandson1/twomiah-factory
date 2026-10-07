// CI guard: the Audit Log page reads the shape the API actually sends.
//
//   Owner: "the new Audit Log page shows '—' and 'System' in every row. The data is in the API, so
//   the page is probably reading the wrong field names."
//
// It was. Rows come off a raw db.execute and arrive snake_case — created_at, user_name, user_email,
// entity_name, ip_address — and the page asked for createdAt, userName, entityName, ipAddress. And
// "What changed" read log.description || log.details, neither of which the API sends: a description
// sits in metadata, a field edit sits in changes.
//
// This was the SECOND shape mismatch on that screen — the filter options differed per template too —
// and the reason both shipped is that the readers lived inside a .tsx nothing could execute without
// React. So they now live in a pure module and this guard RUNS them, against rows copied verbatim
// from GET /api/audit on the live contractor and salon tenants. A fixture I invent cannot catch the
// mistake of inventing a fixture, which is exactly the mistake that was made twice.
//
//   bun scripts/check-audit-page-reads-both-shapes.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const { field, who, whatChanged, asInstant } = await import(`${ROOT}packages/tenant-ui/src/audit/auditFields.ts`)

// ── rows copied from the live API, field for field ────────────────────────────────────────────────
const loginRow = {
  id: 'fpen7vq64qs1e7f2uq2mul1w', action: 'login', entity: 'user',
  entity_id: 'e6rld4yvmuhurjbr4crfcxqq', entity_name: 'twomiah14@gmail.com',
  changes: null, metadata: { description: 'Signed in', role: 'owner' },
  ip_address: '173.40.6.248', user_agent: 'Bun/1.4.2',
  created_at: '2026-10-06 15:24:45.192932',
  user_id: 'e6rld4yvmuhurjbr4crfcxqq', user_name: null, user_email: null,
}
const floorRow = {
  id: 'uv17mjqeort0naru7t357ebu', action: 'update', entity: 'contact',
  entity_id: 'fo6kuqrpo5fco3choc5ngq4b', entity_name: null, changes: null,
  metadata: { method: 'PUT', path: '/api/contacts/fo6', status: 200, via: 'request' },
  ip_address: null, user_agent: null, created_at: '2026-10-06 15:02:08.503808',
  user_id: 'e6rld4yvmuhurjbr4crfcxqq', user_name: 'twomiah14@gmail.com', user_email: 'twomiah14@gmail.com',
}
const paymentRow = {
  id: 'gpyrgj2qlgiboqvwuhnleacz', action: 'payment', entity: 'invoice',
  entity_id: 'dbb4pjcwv6s9mqa1l6on48o4', entity_name: 'INV-00375', changes: null,
  metadata: { total: '48.83', balance: '28.83', status: 'partial', amount: '20.00', method: 'cash' },
  ip_address: '173.40.6.248', created_at: '2026-10-04 08:31:09',
  user_name: 'twomiah14@gmail.com', user_email: 'twomiah14@gmail.com',
}
/** In case a template's route ever camelises on the way out — nine of them feed this screen. */
const camelRow = {
  id: 'x1', action: 'update', entity: 'invoice', entityId: 'inv1', entityName: 'INV-00001',
  changes: { status: { old: 'draft', new: 'open' } }, metadata: null,
  ipAddress: '10.0.0.1', createdAt: '2026-10-06T12:00:00Z', userName: 'Pat Ellery',
}

const is = (what: string, got: unknown, want: unknown) => {
  if (got !== want) fail(`${what}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
}

// When — the column that was "—" on every row.
is('created_at is read', field(loginRow, 'createdAt'), '2026-10-06 15:24:45.192932')
is('createdAt is read too', field(camelRow, 'createdAt'), '2026-10-06T12:00:00Z')
if (!field(floorRow, 'createdAt')) fail('a floor row has no readable timestamp — this is the "—" the owner saw')

// Who — the column that was "System" on every row.
is('the acting user is named', who(floorRow), 'twomiah14@gmail.com')
is('…on a payment too', who(paymentRow), 'twomiah14@gmail.com')
is('…and camelCase is read', who(camelRow), 'Pat Ellery')
is('a sign-in falls back to the account it signed in as', who(loginRow), 'twomiah14@gmail.com')
is('a row with genuinely nobody still reads System', who({ action: 'x' }), 'System')

// Record.
is('entity_name is read', field(paymentRow, 'entityName'), 'INV-00375')
is('entityName is read', field(camelRow, 'entityName'), 'INV-00001')

// What changed.
is('a described event says what it was', whatChanged(loginRow), 'Signed in')
if (!/Status: draft → open/.test(whatChanged(camelRow))) fail(`a field edit must show the change, got ${JSON.stringify(whatChanged(camelRow))}`)
if (!/20\.00/.test(whatChanged(paymentRow))) fail(`a payment must show its amount, got ${JSON.stringify(whatChanged(paymentRow))}`)
is('a row with nothing to say still reads —', whatChanged({ action: 'x', metadata: null, changes: null }), '—')

// IP.
is('ip_address is read', field(loginRow, 'ipAddress'), '173.40.6.248')

// ── A ZONE-LESS TIMESTAMP IS UTC (T58c) ───────────────────────────────────────────────────────────
//
// Owner: "Audit Log times are 5 hours late. /api/audit sends created_at with no timezone, so the
// browser reads it in the wrong zone." These rows come off a raw db.execute, so a timestamp arrives
// as Postgres prints it — space separator, no zone — and `new Date()` on that shape is
// implementation-defined and read as LOCAL. The column is UTC.
//
// Asserted on the VALUE, in ms since the epoch, because that is the thing that was wrong; formatting
// it would only re-test Intl.
{
  const utcNoon = Date.UTC(2026, 9, 6, 12, 0, 0)
  const cases: Array<[string, unknown, number | null]> = [
    ['postgres shape, no zone', '2026-10-06 12:00:00', utcNoon],
    // Microseconds are truncated to milliseconds, not discarded — .192932 keeps .192.
    ['…with microseconds', '2026-10-06 12:00:00.192932', utcNoon + 192],
    ['…with milliseconds', '2026-10-06 12:00:00.192', utcNoon + 192],
    ['ISO with Z is untouched', '2026-10-06T12:00:00Z', utcNoon],
    ['ISO with an offset is untouched', '2026-10-06T08:00:00-04:00', utcNoon],
    ['a bare date is midnight UTC', '2026-10-06', Date.UTC(2026, 9, 6)],
    ['a Date passes through', new Date(utcNoon), utcNoon],
    ['blank is null', '', null],
    ['null is null', null, null],
    ['junk is null', 'not a date', null],
  ]
  for (const [label, input, want] of cases) {
    const got = asInstant(input)
    const gotMs = got ? got.getTime() : null
    if (gotMs !== want) {
      fail(`asInstant — ${label}: got ${got ? got.toISOString() : String(gotMs)}, expected ${want === null ? 'null' : new Date(want).toISOString()}`)
    }
  }
  // The real row from the live API, which is where the five hours were measured.
  const live = asInstant(loginRow.created_at)
  if (!live || live.toISOString() !== '2026-10-06T15:24:45.192Z') {
    fail(`asInstant on the live login row: got ${live ? live.toISOString() : 'null'}, expected 2026-10-06T15:24:45.192Z`)
  }
  // And the page must go through it rather than constructing a Date itself.
  const pageSrc = readFileSync(`${ROOT}packages/tenant-ui/src/audit/AuditLogPage.tsx`, 'utf8')
  if (/new Date\(\s*value\s*\)/.test(pageSrc)) fail('AuditLogPage still builds a Date from the raw value — that is the five-hour shift')
  if (!/asInstant\(/.test(pageSrc)) fail('AuditLogPage must read timestamps through asInstant')
}

// ── AN HTTP STATUS IS NOT A CHANGE (T58c) ─────────────────────────────────────────────────────────
//
// Owner: "portal enable/disable audit rows show 'Status: 200', and settings rows show '—'." The
// request-level audit floor writes an HTTP status into metadata, and whatChanged's fallback list
// included `status` for a BUSINESS status — so a disabled customer portal was described as "200".
{
  const floorPortal = {
    action: 'status_change', entity: 'portal', entity_id: null, changes: null,
    metadata: { description: 'Switched off — portal', method: 'POST', path: '/api/portal/disable', status: 200, via: 'request' },
    created_at: '2026-10-06 17:00:00', user_name: 'owner@test.local',
  }
  const got = whatChanged(floorPortal)
  if (/\b200\b/.test(got)) fail(`a floor row must not describe itself with an HTTP status, got ${JSON.stringify(got)}`)
  if (!/switched off/i.test(got)) fail(`a floor row must say what happened, got ${JSON.stringify(got)}`)

  // Without a description — an older row already in the table — it must still not say "Status: 200".
  const legacy = { ...floorPortal, metadata: { method: 'POST', path: '/api/portal/disable', status: 200, via: 'request' } }
  const legacyText = whatChanged(legacy)
  if (/200/.test(legacyText)) fail(`an older floor row must not read as "Status: 200", got ${JSON.stringify(legacyText)}`)

  // A BUSINESS status must still come through — that is what the key was for.
  const payment = { action: 'payment', entity: 'invoice', changes: null, metadata: { status: 'partial' } }
  if (!/partial/i.test(whatChanged(payment))) fail(`a business status must still be shown, got ${JSON.stringify(whatChanged(payment))}`)
}

// ── A SETTINGS CHANGE NAMES THE SETTINGS IT CHANGED (T58j) ───────────────────────────────────────
//
// Owner, T58c: "settings rows show '—'." Owner again, T58i: "settings-update audit rows show '—'."
//
// It was reported twice because the block above FIXED the "Status: 200" half and the comment on it
// mentions settings, but no assertion was ever written for a settings row — so the em-dash half
// shipped again with the guard green. These rows are copied verbatim from GET /api/audit on ctrtest,
// where all 16 company rows read "—": the metadata lists exactly what the request touched and
// whatChanged simply never looked at `fields` or `settings`.
{
  const settingsRow = {
    id: 'bq3pfqjh5m0i7eqj4u1z', action: 'update', entity: 'company',
    entity_id: 'nu9a6xn8e1fgp21ssvdz7noy', entity_name: 'Contractor Test', changes: null,
    metadata: { fields: [], settings: ['t43yMarker'] },
    ip_address: '173.40.6.248', created_at: '2026-10-07 11:35:03.553655',
    user_name: 'twomiah14@gmail.com', user_email: 'twomiah14@gmail.com',
  }
  const one = whatChanged(settingsRow)
  if (one === '—') fail('a settings row still reads "—" — the metadata names the setting that changed')
  if (!/t43y ?marker/i.test(one)) fail(`a settings row must name the setting, got ${JSON.stringify(one)}`)

  // Two keys, also real: { fields: [], settings: ['__batchProbe', 'googleReviewUrl'] }.
  const two = whatChanged({ ...settingsRow, metadata: { fields: [], settings: ['__batchProbe', 'googleReviewUrl'] } })
  if (!/google ?review ?url/i.test(two)) fail(`a multi-setting row must name them, got ${JSON.stringify(two)}`)

  // A column on the company, rather than a key inside its settings JSON, reads the same way.
  const col = whatChanged({ ...settingsRow, metadata: { fields: ['defaultTaxRate'], settings: [] } })
  if (!/default ?tax ?rate/i.test(col)) fail(`a changed company column must be named, got ${JSON.stringify(col)}`)

  // And an empty list is still nothing to say — it must not print an empty string in place of the dash.
  is('nothing touched still reads —', whatChanged({ ...settingsRow, metadata: { fields: [], settings: [] } }), '—')
}

// ── and the page must USE them, not reach for raw camelCase again ─────────────────────────────────
const page = readFileSync(`${ROOT}packages/tenant-ui/src/audit/AuditLogPage.tsx`, 'utf8')
if (!/from '\.\/auditFields'/.test(page)) fail('AuditLogPage must read rows through ./auditFields, not with its own property access')
for (const raw of ['log.createdAt', 'log.userName', 'log.entityName', 'log.ipAddress', 'log.userEmail']) {
  if (page.includes(raw)) fail(`AuditLogPage still reads ${raw} directly — the API sends snake_case, which is how every row came back "—"`)
}

if (failed) { console.error(`\naudit page reads both shapes: ${failed} check(s) FAILED`); process.exit(1) }
console.log('audit page reads both shapes: real snake_case rows from the live API render a time, a person, a record and what changed')
