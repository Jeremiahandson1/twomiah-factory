// Who a sale's tip belongs to (salon parity row 10): the shares the salon set on the sale, else the value of each person's services on the visit.
// Read by the Tips by stylist report and by the sale's own "Split the tip" screen; the arithmetic is in ./tipSplit.ts.
import { and, eq } from 'drizzle-orm'
import { invoice, appointment, teamMember, user } from '../../db/schema/index.ts'
import { itemsOfVisits, peopleNames, setTipShares, tipSharesSet, tipsNetCents } from '../../data/salon.ts'
import { defaultWeights, keyOf, NOBODY, splitCents, type PersonKey, type Weighted } from './tipSplit.ts'

export type SaleRef = { invoiceId: string; appointmentId: string | null; stylistId: string | null; stylistMemberId: string | null }

const personOf = (key: PersonKey) => key.startsWith('u:') ? { stylistId: key.slice(2), stylistMemberId: null } : key.startsWith('m:') ? { stylistId: null, stylistMemberId: key.slice(2) } : { stylistId: null, stylistMemberId: null }

export function createTipShares(db: any) {
  /** The weights for each sale: its own shares when set (`manual`), else by service value; a sale with no services belongs to the visit's stylist. */
  async function weightsFor(companyId: string, sales: SaleRef[]): Promise<Map<string, { weights: Weighted[]; manual: boolean }>> {
    const set = await tipSharesSet(db, companyId, sales.map((s) => s.invoiceId))
    const items = await itemsOfVisits(db, [...new Set(sales.map((s) => s.appointmentId).filter(Boolean) as string[])])
    const out = new Map<string, { weights: Weighted[]; manual: boolean }>()
    for (const s of sales) {
      const own = set.filter((x) => x.invoiceId === s.invoiceId)
      if (own.length) { out.set(s.invoiceId, { weights: own.map((x) => ({ key: keyOf(x), weight: x.shareBp })), manual: true }); continue }
      const mine = items.filter((i) => i.appointmentId === s.appointmentId).map((i) => ({ key: keyOf(i), priceCents: Math.round(Number(i.price || 0) * 100) }))
      out.set(s.invoiceId, { weights: defaultWeights(mine.map((m) => (m.key === NOBODY ? { ...m, key: keyOf(s) } : m)), keyOf(s)), manual: false })
    }
    return out
  }

  /** The sale as the split screen shows it: its tip so far (net of tip given back), each person's share, whether the shares are the salon's own. */
  async function view(companyId: string, invoiceId: string) {
    const [sale] = await db.select({ invoiceId: invoice.id, appointmentId: invoice.appointmentId, stylistId: appointment.stylistId, stylistMemberId: appointment.stylistMemberId })
      .from(invoice).leftJoin(appointment, eq(appointment.id, invoice.appointmentId)).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId))).limit(1)
    if (!sale) return null
    const tipCents = await tipsNetCents(db, invoiceId)
    const w = (await weightsFor(companyId, [sale])).get(invoiceId)!
    const cents = new Map(splitCents(tipCents, w.weights).map((x) => [x.key, x.cents]))
    const total = w.weights.reduce((t, x) => t + x.weight, 0)
    const names = await peopleNames(db, w.weights.filter((x) => x.key.startsWith('u:')).map((x) => x.key.slice(2)), w.weights.filter((x) => x.key.startsWith('m:')).map((x) => x.key.slice(2)))
    return {
      invoiceId, tipCents, manual: w.manual,
      people: w.weights.map((x) => ({ key: x.key, name: names.get(x.key) ?? 'No stylist recorded', percent: Math.round((x.weight / total) * 10000) / 100, cents: cents.get(x.key) ?? 0 })),
    }
  }

  /** People a share may go to: logins of this salon and its roster members. */
  async function knownKeys(companyId: string): Promise<Map<PersonKey, string>> {
    const out = new Map<PersonKey, string>()
    for (const u of await db.select({ id: user.id, f: user.firstName, l: user.lastName }).from(user).where(eq(user.companyId, companyId))) out.set(`u:${u.id}`, [u.f, u.l].filter(Boolean).join(' ').trim() || 'Team member')
    for (const m of await db.select({ id: teamMember.id, n: teamMember.name }).from(teamMember).where(eq(teamMember.companyId, companyId))) out.set(`m:${m.id}`, String(m.n))
    return out
  }

  async function save(companyId: string, invoiceId: string, weights: Weighted[] | null, byUserId: string | null) {
    await setTipShares(db, companyId, invoiceId, weights ? weights.map((w) => ({ ...personOf(w.key), shareBp: w.weight })) : [], byUserId)
  }

  return { weightsFor, view, knownKeys, save }
}
export type TipShares = ReturnType<typeof createTipShares>
