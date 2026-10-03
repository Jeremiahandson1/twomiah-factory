// CI guard: the change-order action menu and the API agree on which status each action works from,
// and the client portal agrees with the CRM about what "waiting for the client" means.
//
// TWO FINDINGS, one subject. (T41 contractor)
//
//   HIGH   "Change orders submitted from the CRM can't be signed by the client: CRM Submit sets
//           status 'submitted', the portal lists and approves only 'pending' (400 'can no longer be
//           approved'), and the CO doesn't appear in the client's portal list. Only API-created
//           'pending' COs can be signed."
//
//   MEDIUM "Signed or approved COs still show Edit, Submit, Approve, Reject and Delete for owner and
//           manager (the server refuses each with 400)."
//
// Both are one word disagreeing across two files. The CRM's routes/changeOrders.ts is the authority:
// it holds EDITABLE / SUBMITTABLE / APPROVABLE / REJECTABLE and treats 'pending' as a synonym for
// 'submitted'. The row menu now reads copies of those lists, and the portal — server and page —
// reads a set of its own. Copies rot silently, so this guard compares them.
//
// It does NOT invent a policy. Change the lists in routes/changeOrders.ts and the guard tells you
// which other files have to move with them.
//
//   bun scripts/check-change-order-status-lists.ts
import { readFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return null } }

let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

const API = 'templates/crm/backend/src/routes/changeOrders.ts'
const PAGE = 'templates/crm/frontend/src/pages/ChangeOrdersPage.tsx'
const PORTAL_API = 'packages/tenant-backend/src/portal/portal.ts'
const PORTAL_PAGE = 'packages/tenant-ui/src/portal/PortalChangeOrders.tsx'

/** `const NAME = ['a', 'b']` → ['a','b'], in declaration order with duplicates kept. */
const listOf = (src: string, name: string): string[] | null => {
  const m = src.match(new RegExp(`const ${name}\\s*(?::[^=]*)?=\\s*\\[([^\\]]*)\\]`))
  if (!m) return null
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}
const same = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',')

const api = read(API)
const page = read(PAGE)
if (api === null) fail(`${API} not found — fix this guard's walk`)
if (page === null) fail(`${PAGE} not found — fix this guard's walk`)

if (api && page) {
  for (const name of ['EDITABLE', 'SUBMITTABLE', 'APPROVABLE', 'REJECTABLE']) {
    const server = listOf(api, name)
    const screen = listOf(page, name)
    if (!server) { fail(`${API} no longer declares ${name} — the row menu copies it, so the copy is now orphaned`); continue }
    if (!screen) { fail(`${PAGE} no longer declares ${name}; the row menu must gate on the same statuses the API accepts, or it offers actions that 400`); continue }
    if (!same(server, screen))
      fail(`${name} disagrees: API has [${server.join(', ')}], the row menu has [${screen.join(', ')}] — `
        + `the menu will either offer an action the server refuses or hide one it allows`)
  }

  // The menu must actually CONSULT them. A list sitting unused next to `show: () => can(...)` is how
  // this finding looked before the fix: the permission asked, the status ignored.
  const ACTION_LIST: Record<string, string> = {
    Edit: 'EDITABLE', Submit: 'SUBMITTABLE', Approve: 'APPROVABLE', Reject: 'REJECTABLE', Delete: 'EDITABLE',
  }
  for (const [label, list] of Object.entries(ACTION_LIST)) {
    const line = page.split('\n').find((l) => l.includes(`label: '${label}'`) && l.includes('show:'))
    if (!line) { fail(`${PAGE}: no row action labelled '${label}' with a show: — fix this guard's walk`); continue }
    if (!line.includes(`${list}.includes(`))
      fail(`${PAGE}: the '${label}' row action does not check ${list} — an approved change order would `
        + `still offer it, and the server answers 400.\n       ${line.trim().slice(0, 150)}`)
  }
}

// ── the portal's half: 'submitted' and 'pending' both mean "waiting for the client" ───────────────
{
  const papi = read(PORTAL_API)
  const ppage = read(PORTAL_PAGE)
  if (papi === null) fail(`${PORTAL_API} not found — fix this guard's walk`)
  if (ppage === null) fail(`${PORTAL_PAGE} not found — fix this guard's walk`)
  if (api && papi && ppage) {
    const approvable = listOf(api, 'APPROVABLE') || []
    for (const [file, src] of [[PORTAL_API, papi], [PORTAL_PAGE, ppage]] as const) {
      const awaiting = listOf(src, 'AWAITING_CLIENT')
      if (!awaiting) {
        fail(`${file} does not declare AWAITING_CLIENT — a change order the CRM has SUBMITTED must be `
          + `signable in the portal; hard-coding 'pending' is the HIGH this guard exists for`)
        continue
      }
      if (!same(awaiting, approvable))
        fail(`${file}: AWAITING_CLIENT is [${awaiting.join(', ')}] but the CRM's APPROVABLE is `
          + `[${approvable.join(', ')}] — a status the office can send is one the client cannot answer`)
    }
    /**
     * And the page must USE it in all three places, not merely declare it. Each is named, because a
     * count alone passed a mutation that put `co.status === 'pending'` back on the detail: the list's
     * two uses kept the total up, and the button that actually signs the thing was gone again.
     */
    const PAGE_SITES: [string, string][] = [
      ['rows.filter((co) => awaitingClient(co.status))', 'the "Awaiting Your Approval" section — a submitted CO lands in the Previous pile'],
      ['rows.filter((co) => !awaitingClient(co.status))', 'the "Previous" section, which must be the exact complement'],
      ['const canRespond = awaitingClient(co.status)', 'Sign & Approve / Decline on the detail — the buttons the finding is about'],
    ]
    for (const [site, why] of PAGE_SITES) {
      if (!ppage.includes(site))
        fail(`${PORTAL_PAGE} does not contain \`${site}\` — ${why}`)
    }
    if (!ppage.includes('STATUS_STYLES')) fail(`${PORTAL_PAGE}: expected STATUS_STYLES — fix this guard's walk`)
    const styles = ppage.match(/const STATUS_STYLES[^\n]*\n?/)?.[0] || ''
    for (const s of listOf(api, 'APPROVABLE') || []) {
      if (!styles.includes(`${s}:`))
        fail(`${PORTAL_PAGE}: STATUS_STYLES has no '${s}' entry — that badge renders unstyled on the `
          + `one status the client is being asked to act on`)
    }
    /**
     * The portal's detail route must apply the same visibility as its LIST: a draft change order is
     * the office still writing it, and was one URL away from the client before T41.
     *
     * Counted rather than matched line by line — the two queries are each wrapped over two lines, so
     * a single-line `find` missed the detail one and reported a stale walk instead of a result. Both
     * reads filter on the same named set; that is the property, and two is how many reads there are.
     */
    if (!/const CLIENT_VISIBLE\b/.test(papi))
      fail(`${PORTAL_API} does not declare CLIENT_VISIBLE — the list and the detail must share one `
        + `visibility rule, or a draft is readable by id`)
    const uses = (papi.match(/inArray\(t\.changeOrder\.status, CLIENT_VISIBLE\)/g) || []).length
    if (uses < 2)
      fail(`${PORTAL_API} filters on CLIENT_VISIBLE in ${uses} place(s); both the change-order list `
        + `AND the single change-order read must do it, or a draft is one URL away from the client`)
  }
}

if (failed) { console.error(`\n${failed} problem(s).`); process.exit(1) }
console.log('ok: the change-order menu, the API and the client portal agree on what each status allows')
