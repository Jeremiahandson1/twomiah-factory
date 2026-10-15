// RESTART — a company whose subscription ended pays from its own lock page and is back in. (10/14)
//   Owner: "shouldnt they just be able to make a payment and restart it? why email?"
// Runs services/subscriptionRestart.ts against fakes — who may start a restart checkout, and what a paid restart undoes
// (the 30-day offboard timer whose end tears down DNS and email; the registrar lock the offboard removed). Then reads
// the Factory routes to prove they are wired to it. Nothing leaves the machine.
const { readFileSync } = await import('node:fs')
const R = await import(new URL('../../apps/api/src/services/subscriptionRestart.ts', import.meta.url).href)

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const NOW = new Date('2026-10-14T22:00:00Z')
const days = (n: number) => new Date(NOW.getTime() + n * 86400_000).toISOString()

// ── who may start a restart checkout
{
  const ended = { id: 't1', billing_status: 'canceled', status: 'suspended', stripe_subscription_id: null, offboard_started_at: days(-1), offboard_grace_ends_at: days(29) }
  check('a cancelled company inside its 30 days may restart', R.restartRefusal(ended, NOW) === null)
  check('a trial that ran out (never subscribed, never offboarded) may choose a plan', R.restartRefusal({ id: 't', billing_status: 'trialing', status: 'trial_expired', stripe_subscription_id: null }, NOW) === null)
  for (const bs of ['active', 'past_due', 'trialing']) {
    const r = R.restartRefusal({ id: 't', billing_status: bs, status: 'active', stripe_subscription_id: 'sub_live' }, NOW)
    check(`a running subscription (${bs}) is refused — 409 still_active, never a second subscription`, r?.status === 409 && r?.code === 'still_active', r)
  }
  const cancelledAtPeriodEnd = R.restartRefusal({ id: 't', billing_status: 'active', status: 'active', stripe_subscription_id: 'sub_live', offboard_started_at: days(-2), offboard_grace_ends_at: days(28) }, NOW)
  check('cancelled but still paid up to the period end is refused too — that one is reactivated, not bought again', cancelledAtPeriodEnd?.code === 'still_active', cancelledAtPeriodEnd)
  const late = R.restartRefusal({ ...ended, offboard_grace_ends_at: days(-1) }, NOW)
  check('after the 30 days: 410 grace_ended, and it says to email support', late?.status === 410 && late?.code === 'grace_ended' && /support@twomiah\.com/.test(late?.error || ''), late)
  check('an offboarded company (the teardown ran) is refused even with no date', R.restartRefusal({ ...ended, status: 'offboarded', offboard_grace_ends_at: null }, NOW)?.code === 'grace_ended')
  check('the last moment of the grace period still restarts', R.restartRefusal({ ...ended, offboard_grace_ends_at: new Date(NOW.getTime() + 1000).toISOString() }, NOW) === null)
}

// ── what a paid restart undoes
const fakes = (opts: { clearError?: string; lockFails?: string } = {}) => {
  const log: string[] = []
  return {
    log,
    deps: {
      clearOffboard: async (id: string) => { log.push('clear ' + id); return { error: opts.clearError ? { message: opts.clearError } : null } },
      relockDomain: async (d: string) => { log.push('lock ' + d); return opts.lockFails ? { success: false, error: opts.lockFails } : { success: true } },
      audit: async (id: string, changes: any) => { log.push('audit ' + id + ' ' + Object.keys(changes).join(',')) },
      notifyReactivated: async (t: any) => { log.push('email ' + t.id) },
    },
  }
}
{
  const f = fakes()
  const r = await R.finishRestart({ id: 't1', offboard_started_at: days(-1), offboard_grace_ends_at: days(29), domain: 'acme.com', domain_registrar: 'namecheap', name: 'Acme' }, f.deps)
  check('a paid restart cancels the offboard timer, re-locks OUR domain, records it and emails the owner', r.restarted === true
    && f.log.join('|') === 'clear t1|lock acme.com|audit t1 offboard_started_at,offboard_grace_ends_at|email t1', f.log)
  check('…and says what it did, for the log', r.steps.includes('offboard timer cancelled') && r.steps.includes('domain re-locked'), r.steps)
}
{
  const f = fakes()
  await R.finishRestart({ id: 't2', offboard_started_at: days(-1), domain: 'theirs.com', domain_registrar: 'byod' }, f.deps)
  check('a domain the customer brought is never touched — the offboard never unlocked it', !f.log.some((l) => l.startsWith('lock')), f.log)
}
{
  const f = fakes()
  const r = await R.finishRestart({ id: 't3', offboard_started_at: null, domain: 'acme.com', domain_registrar: 'namecheap' }, f.deps)
  check('a sign-up (no offboard) is left completely alone — no timer, no lock, no "welcome back" email', r.restarted === false && f.log.length === 0, f.log)
}
{
  const f = fakes({ lockFails: 'Namecheap timeout' })
  const r = await R.finishRestart({ id: 't4', offboard_started_at: days(-1), domain: 'acme.com', domain_registrar: 'namecheap' }, f.deps)
  check('a re-lock that fails does not stop the restart — the timer is still cancelled, and the failure is reported', r.restarted && f.log.includes('clear t4') && r.steps.some((s: string) => /re-lock: FAILED Namecheap timeout/.test(s)), r.steps)
}
{
  const f = fakes({ clearError: 'db down' })
  const r = await R.finishRestart({ id: 't5', offboard_started_at: days(-1) }, f.deps)
  check('a timer that could not be cleared is reported as FAILED, not "cancelled"', r.steps.some((s: string) => /offboard timer: FAILED db down/.test(s)), r.steps)
}

// ── the Factory routes are wired to it
const API = (p: string) => readFileSync(new URL('../../apps/api/src/' + p, import.meta.url), 'utf8')
{
  const life = API('routes/factory/lifecycle.ts')
  const route = life.slice(life.indexOf("factory.post('/customers/:id/restart-checkout'"))
  const body = route.slice(0, route.indexOf('\nfactory.'))
  check('the restart route exists, checks the sync key, and asks restartRefusal BEFORE opening a checkout', body.length > 0
    && body.indexOf('checkFactoryKey(c, tenant)') > 0 && body.indexOf('restartRefusal(tenant)') > body.indexOf('checkFactoryKey(c, tenant)')
    && body.indexOf('createSubscriptionCheckout') > body.indexOf('restartRefusal(tenant)'))
  // Asking is not enough — the answer must stop the checkout. (A mutation that deleted this line survived the check above.)
  const asked = body.indexOf('const refusal = restartRefusal(tenant)')
  const acted = body.indexOf('if (refusal) return c.json({ error: refusal.error, code: refusal.code }, refusal.status)')
  check('…and a refusal RETURNS its 409/410 before any checkout is opened — never a second subscription', asked > 0 && acted > asked && acted < body.indexOf('createSubscriptionCheckout'), { asked, acted })
  check('…for the company\'s own plan, back to the lock page that waits for the payment', /planId: tenant\.plan/.test(body) && /successUrl: crm \+ lockPage \+ '\?restarted=1'/.test(body) && /cancelUrl: crm \+ lockPage/.test(body))
  // The CRM names its lock page (crm-store's is /paywall). Run the route's OWN rule on hostile input: only a plain
  // same-site path may come back, or Stripe could be told to send a paying customer to another host.
  const ruleSrc = body.match(/const lockPage = (.+?)\r?\n/)?.[1] || ''
  const lockPageOf = (asked: string) => new Function('asked', 'return ' + ruleSrc)(asked)
  check('the return path defaults to /crm/paywall and accepts the store\'s /paywall', ruleSrc.length > 0 && lockPageOf('') === '/crm/paywall' && lockPageOf('/paywall') === '/paywall', ruleSrc)
  check('…and never another host: //evil.com, https://evil.com, /x?next=… and a backslash all fall back', ['//evil.com', 'https://evil.com', '/paywall?next=//evil.com', '/\\evil.com', 'paywall'].every((a) => lockPageOf(a) === '/crm/paywall'))
  // logTenantAudit returns early on an empty changes object — the first live restart's "checkout opened" row never landed.
  check('opening a restart checkout is recorded — with a change, which the audit helper requires', /logTenantAudit\(tenant\.id, 'restart_checkout', \{ restart_checkout_plan: \{/.test(body)
    && /if \(Object\.keys\(changes\)\.length === 0\) return/.test(API('routes/factory/shared.ts')))
  const gate = API('routes/factory.ts')
  check('the route is let past staff auth only as a POST on an exact id path (the CRM has no staff token)', /c\.req\.method === 'POST' && \/\\\/customers\\\/\[0-9a-f-\]\{36\}\\\/restart-checkout\$\/i\.test\(c\.req\.path\)/.test(gate))
  const bill = API('routes/factory/billing.ts')
  const hook = bill.slice(bill.indexOf("factory.post('/stripe/webhook'"))
  const apply = hook.indexOf("await applyTenantUpdates({ field: 'id', value: result.factoryCustomerId }, result.updates)")
  const fin = hook.indexOf('await finishRestart(preTenant')
  check('the Stripe webhook finishes a restart after applying the payment, from the row as it was BEFORE', apply > 0 && fin > apply && hook.indexOf("const { data: preTenant }") < apply)
  check('…only for a paid subscription checkout by a company that was offboarding', /event\.type === 'checkout\.session\.completed' && result\.updates\.billing_type === 'subscription' && preTenant\?\.offboard_started_at/.test(hook))
  const nc = API('services/registrar/namecheap.ts')
  check('Namecheap can put the lock back (LockAction LOCK), beside the unlock the offboard uses', /async lock\(domain: string\)[\s\S]{0,200}LockAction: 'LOCK'/.test(nc))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
