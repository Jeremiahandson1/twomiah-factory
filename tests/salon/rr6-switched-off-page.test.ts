// crm-salon — RR6 observation: the switched-off page blamed the plan for a switch the owner holds.
//
// Turn Time Tracking off and /crm/time answered:
//
//     "Time Tracking isn't part of this CRM"
//     "This module is not included for your business type or plan."
//
// Which is untrue, and unhelpfully so: the owner had turned it off two minutes earlier and could
// turn it back on from Settings → Features. Blaming the plan for something the reader controls sends
// them to support for a job that is one click.
//
// hasFeature() is false for both cases — "not offered here" and "offered and switched off" — so the
// page cannot tell them apart on its own. The CATALOGUE can: it is the registry's answer to what
// this template offers, which is exactly the distinction. This reads the shipped shell rather than
// running a browser; the behaviour is three conditions and a fetch.
const ROOT = (() => {
  const r = process.env.FACTORY_ROOT
  if (!r) throw new Error('FACTORY_ROOT is not set — run this through tests/salon/harness/run.ts')
  return r.endsWith('/') ? r : r + '/'
})()

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const shell = (await Bun.file(`${ROOT}packages/tenant-ui/src/shell/AppShell.tsx`).text()).replace(/\r\n/g, '\n')

// ══════════ it asks what this product offers, rather than guessing ══════════════════════════════
{
  check('the page asks the catalogue what this template offers',
    /api\.get\('\/api\/company\/features\/catalog'\)/.test(shell), null)
  check('…only when the gated page is actually on screen, which is rare',
    /if \(!gatedItem \|\| gatedItem\.reason !== 'feature' \|\| offeredHere\) return/.test(shell), null)
  check('…and a failed fetch falls back to the old wording rather than inventing a switch',
    /\.catch\(\(\) => \{ if \(!cancelled\) setOfferedHere\(new Set\(\)\) \}\)/.test(shell), null)
}

// ══════════ the three answers ═══════════════════════════════════════════════════════════════════
{
  check('a module this product OFFERS is described as switched off, not absent',
    /\$\{gatedItem\.label\} is switched off/.test(shell), null)
  check('…and an admin is told where the switch is',
    /can be turned on whenever you want it — Settings → Features/.test(shell), null)
  check('…while anyone else is told who to ask, because the switch is requireAdmin',
    /An owner or admin can turn it on in Settings → Features/.test(shell), null)
  check('a module this product does NOT offer keeps the original wording',
    /This module is not included for your business type or plan/.test(shell), null)
  check('…and a permission block is still a permission block',
    /You don't have access to \$\{gatedItem\.label\}/.test(shell), null)
}

// ══════════ and the button goes somewhere useful ════════════════════════════════════════════════
{
  check('an admin looking at a switched-off module is offered Settings, not the dashboard',
    /switchable && canSwitch[\s\S]{0,120}to="\/crm\/settings"[\s\S]{0,250}Open Settings/.test(shell), null)
  check('…everyone else still gets Back to dashboard', /Back to dashboard/.test(shell), null)
  check('only an owner or admin is offered the switch — PUT /company/features is requireAdmin',
    /const canSwitch = \['owner', 'admin'\]\.includes/.test(shell), null)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
