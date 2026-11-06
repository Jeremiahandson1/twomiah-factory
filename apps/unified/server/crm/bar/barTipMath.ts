// Tip pooling and tip-out, as arithmetic only (restaurant-bar-depth #9; Toast's tip pooling and tip out, 7shifts' tip
// pooling). No database here: barTips.ts gathers the night's tips, sales and hours and hands them in.
//
// The rules a venue sets, in its own words:
//   · Each ROLE (Bartender, Server, Barback…) either KEEPS its own tips or PUTS THEM IN THE POOL.
//   · A TIP-OUT is a share of one role's tips (or of its sales) handed to another role: the servers tip out 10% of their
//     tips to the barback. It is taken from what the person made, never more than they made.
//   · The POOL is split between roles by a percentage each (bartenders 60, barbacks 20, servers 20), and inside a role by
//     hours worked. A role with nobody working that night has its share go to the roles that did.
// Every cent is accounted for: the payouts always add up to exactly the tips taken (largest-remainder rounding).

export interface TipRole {
  name: string
  /** Schedule positions that count as this role ("Bar", "Bar back"), compared without case. */
  positions: string[]
  /** 'keeps': keeps its own tips (less tip-outs). 'pools': its tips go into the pool. */
  mode: 'keeps' | 'pools'
  /** Its share of the pool, in percent. Only roles with a share receive from the pool. */
  poolPct: number
}
export interface TipOut { from: string; to: string; pct: number; basis: 'tips' | 'sales' }
export interface TipRules {
  roles: TipRole[]; tipOuts: TipOut[]; defaultRole: string
  /**
   * The owner's setting: for each schedule position ("Bar", "Floor"), the role it counts as. When this is set it is the
   * whole truth: a position that maps to no role (or is not listed) takes no tip-out and no pool share — the person
   * keeps what they made. When it is absent the roles' own `positions` lists decide, as they did before.
   */
  positionRoles?: Record<string, string>
}

/** The role a person's scheduled positions count as; '' = none (they keep their own tips, no tip-out either way). */
export function roleForPositions(rules: TipRules, positions: string[], fallback: string): string {
  if (!positions.length) return fallback
  if (rules.positionRoles) {
    for (const pos of positions) {
      const key = Object.keys(rules.positionRoles).find((k) => k.toLowerCase() === pos.toLowerCase())
      const role = key ? rules.positionRoles[key] : ''
      const hit = role ? rules.roles.find((r) => r.name.toLowerCase() === role.toLowerCase()) : undefined
      if (hit) return hit.name
    }
    return ''
  }
  for (const pos of positions) {
    const hit = rules.roles.find((r) => r.positions.some((p) => p.toLowerCase() === pos.toLowerCase()) || r.name.toLowerCase() === pos.toLowerCase())
    if (hit) return hit.name
  }
  return fallback
}

export interface TipPerson {
  userId: string; name: string; role: string; hours: number
  /** Everything they made in tips: what is on the checks they closed, plus the two parts below. */
  tipsCents: number; salesCents: number
  /** Of tipsCents: cash tips they declared at clock-out (not rung on our register), and tips imported from another register (Toast, Square). */
  declaredCents?: number; importedCents?: number
}
export interface TipPayout extends TipPerson {
  keptCents: number
  tipOutPaidCents: number
  tipOutReceivedCents: number
  poolShareCents: number
  totalCents: number
}
export interface TipResult { payouts: TipPayout[]; poolCents: number; notes: string[] }

/** Split `total` cents by weights, to the cent: each gets its floor, the leftover cents go to the largest remainders. */
export function split(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!weights.length) return []
  const w = sum > 0 ? weights : weights.map(() => 1)
  const wsum = w.reduce((a, b) => a + b, 0)
  const raw = w.map((x) => (total * x) / wsum)
  const out = raw.map((r) => Math.floor(r))
  let left = total - out.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++
  return out
}

/** The first problem with a set of rules, as a sentence; null when they are sound. */
export function rulesRefusal(r: TipRules): string | null {
  if (!Array.isArray(r.roles) || r.roles.length > 20) return 'Up to 20 roles.'
  const names = new Set<string>()
  for (const role of r.roles) {
    const n = String(role.name || '').trim()
    if (!n || n.length > 40) return 'Every role needs a name (up to 40 letters).'
    if (names.has(n.toLowerCase())) return `"${n}" is listed twice.`
    names.add(n.toLowerCase())
    if (role.mode !== 'keeps' && role.mode !== 'pools') return `${n}: keeps its tips or pools them.`
    if (!Number.isFinite(role.poolPct) || role.poolPct < 0 || role.poolPct > 100) return `${n}: a share of the pool is 0 to 100 percent.`
  }
  const shares = r.roles.reduce((s, x) => s + x.poolPct, 0)
  if (shares > 0 && Math.round(shares * 100) !== 10000) return `The roles' shares of the pool add up to ${Math.round(shares * 100) / 100} percent. They need to add up to 100.`
  if (r.roles.some((x) => x.mode === 'pools') && shares === 0) return 'Some roles pool their tips but no role has a share. Give the roles their percent of the pool.'
  if (r.tipOuts.length > 20) return 'Up to 20 tip-outs.'
  for (const t of r.tipOuts) {
    if (!names.has(String(t.from).toLowerCase()) || !names.has(String(t.to).toLowerCase())) return 'A tip-out names a role that is not in the list.'
    if (String(t.from).toLowerCase() === String(t.to).toLowerCase()) return 'A role cannot tip out to itself.'
    if (!Number.isFinite(t.pct) || t.pct <= 0 || t.pct > 100) return 'A tip-out is more than 0 and at most 100 percent.'
    if (t.basis !== 'tips' && t.basis !== 'sales') return 'A tip-out is a share of tips or of sales.'
  }
  if (r.defaultRole && !names.has(String(r.defaultRole).toLowerCase())) return 'The role for people with no scheduled position is not in the list.'
  if (r.positionRoles) {
    const entries = Object.entries(r.positionRoles)
    if (entries.length > 50) return 'Up to 50 positions.'
    for (const [pos, role] of entries) {
      if (!pos.trim() || pos.length > 40) return 'Every position needs a name (up to 40 letters).'
      if (role && !names.has(String(role).toLowerCase())) return `${pos}: "${role}" is not one of the roles.`
    }
  }
  return null
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Settle one night. */
export function settleTips(rules: TipRules, people: TipPerson[]): TipResult {
  const notes: string[] = []
  const pay: TipPayout[] = people.map((p) => ({ ...p, keptCents: p.tipsCents, tipOutPaidCents: 0, tipOutReceivedCents: 0, poolShareCents: 0, totalCents: 0 }))
  const roleOf = (name: string) => rules.roles.find((r) => same(r.name, name))
  const hoursOr = (ps: TipPayout[]) => ps.map((p) => Math.max(0, p.hours))

  // 1. Tip-outs, in the order the venue listed them. Taken from what the person made, never more.
  for (const t of rules.tipOuts) {
    const payers = pay.filter((p) => same(p.role, t.from))
    const takers = pay.filter((p) => same(p.role, t.to))
    if (!payers.length) continue
    if (!takers.length) { notes.push(`Nobody worked as ${t.to}, so ${t.from} did not tip out to them.`); continue }
    let pot = 0
    for (const p of payers) {
      const want = Math.round(((t.basis === 'tips' ? p.tipsCents : p.salesCents) * t.pct) / 100)
      const owe = Math.min(want, p.keptCents)
      if (owe < want) notes.push(`${p.name} made less in tips than the ${t.pct}% tip-out to ${t.to}, so tipped out ${owe} cents.`)
      p.keptCents -= owe; p.tipOutPaidCents += owe; pot += owe
    }
    const shares = split(pot, hoursOr(takers))
    takers.forEach((p, i) => { p.tipOutReceivedCents += shares[i] })
  }

  // 2. The pool: what the pooling roles have left, divided between the roles that have a share and are on tonight.
  const contributors = pay.filter((p) => roleOf(p.role)?.mode === 'pools')
  let poolCents = 0
  for (const p of contributors) { poolCents += p.keptCents; p.keptCents = 0 }
  if (poolCents > 0) {
    const present = rules.roles.filter((r) => r.poolPct > 0 && pay.some((p) => same(p.role, r.name)))
    if (!present.length) {
      notes.push('Nobody who shares the pool worked tonight, so each person kept their own tips.')
      for (const p of contributors) p.keptCents = p.tipsCents - p.tipOutPaidCents
      poolCents = 0
    } else {
      const roleCents = split(poolCents, present.map((r) => r.poolPct))
      present.forEach((r, i) => {
        const members = pay.filter((p) => same(p.role, r.name))
        const shares = split(roleCents[i], hoursOr(members))
        members.forEach((p, j) => { p.poolShareCents += shares[j] })
      })
      const absent = rules.roles.filter((r) => r.poolPct > 0 && !present.includes(r))
      if (absent.length) notes.push(`${absent.map((r) => r.name).join(', ')} did not work, so their share of the pool went to the others.`)
    }
  }
  for (const p of pay) p.totalCents = p.keptCents + p.tipOutReceivedCents + p.poolShareCents
  return { payouts: pay, poolCents, notes }
}
