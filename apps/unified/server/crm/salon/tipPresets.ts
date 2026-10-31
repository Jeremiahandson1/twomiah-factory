// The salon's tip settings and the tip-eligible amount of a sale (salon parity row 11). The percentages the owner sets are used in three places:
// the desk's shortcut buttons, the card reader's own tip screen (a Stripe Terminal configuration on each of the salon's readers' locations),
// and — with the receipt switch — the late-tip page. All of it on the salon's own Stripe account.
import type Stripe from 'stripe'
import { and, eq } from 'drizzle-orm'
import { company, invoice, invoiceLineItem, salonReader } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import { settingsOf } from './patchTest.ts'
import { TIP_CONFIGS_KEY, TIP_SETTINGS_KEY, eligibleCents, readTipSettings, suggestTips, type TipSettings } from './tipSettings.ts'

export function createTipPresets(d: CrmDeps, stripeOf: () => Stripe | null) {
  const { db, logger } = d

  const settings = async (companyId: string): Promise<TipSettings> => readTipSettings(await settingsOf(db, companyId))

  /** The Stripe Terminal configuration with these percentages, made on the salon's account. */
  const makeConfig = (stripe: Stripe, acct: string, presets: number[]) =>
    stripe.terminal.configurations.create({ tipping: { usd: { percentages: presets } } } as any, { stripeAccount: acct }) as Promise<any>

  /**
   * Save the settings and send the percentages to every reader location of the salon: a new Terminal configuration, set on the location, the old
   * one deleted. A location Stripe will not update is named in `readers.failed` — the settings are kept either way, and the reader keeps its
   * old buttons until the next save succeeds.
   */
  async function save(companyId: string, values: TipSettings): Promise<{ settings: TipSettings; readers: { updated: number; failed: string[] } }> {
    const current: any = (await settingsOf(db, companyId)) || {}
    const rows: Array<{ locationId: string; stripeAccount: string | null }> = await db.select({ locationId: salonReader.locationId, stripeAccount: salonReader.stripeAccount }).from(salonReader).where(eq(salonReader.companyId, companyId))
    const places = new Map<string, string>()
    for (const r of rows) if (r.stripeAccount) places.set(r.locationId, r.stripeAccount)
    const configs: Record<string, string> = { ...((current as any)[TIP_CONFIGS_KEY] ?? {}) }
    const result = { updated: 0, failed: [] as string[] }
    const stripe = stripeOf()
    if (places.size && !stripe) result.failed.push('Card readers are not available on this server yet.')
    else if (stripe) {
      for (const [locationId, acct] of places) {
        try {
          const cfg = await makeConfig(stripe, acct, values.presets)
          await stripe.terminal.locations.update(locationId, { configuration_overrides: cfg.id } as any, { stripeAccount: acct })
          const old = configs[locationId]
          configs[locationId] = cfg.id
          if (old && old !== cfg.id) { try { await (stripe.terminal.configurations as any).del(old, {}, { stripeAccount: acct }) } catch { /* in use or already gone: harmless */ } }
          result.updated += 1
        } catch (e: any) {
          logger.warn('[tip-presets] reader screen not updated', { error: e?.message })
          result.failed.push(String(e?.raw?.message || e?.message || 'Stripe did not take the change').slice(0, 200))
        }
      }
    }
    await db.update(company).set({ settings: { ...current, [TIP_SETTINGS_KEY]: values, [TIP_CONFIGS_KEY]: configs }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return { settings: values, readers: result }
  }

  /** The configuration for a Location made now (ensureLocation): the salon's own percentages. */
  async function configFor(companyId: string, stripe: Stripe, acct: string) {
    const s = await settings(companyId)
    return { cfg: await makeConfig(stripe, acct, s.presets), presets: s.presets }
  }

  /** Remember the configuration made for a location, so a later change replaces it. */
  async function remember(companyId: string, locationId: string, configId: string) {
    const current: any = (await settingsOf(db, companyId)) || {}
    await db.update(company).set({ settings: { ...current, [TIP_CONFIGS_KEY]: { ...((current as any)[TIP_CONFIGS_KEY] ?? {}), [locationId]: configId } }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
  }

  /** The part of `amountCents` of this sale a percentage tip is worked on (services only), or null if the sale is not this salon's. */
  async function eligibleFor(companyId: string, invoiceId: string, amountCents: number | null): Promise<{ saleCents: number; amountCents: number; eligibleCents: number } | null> {
    const [inv] = await db.select({ id: invoice.id, total: invoice.total, amountPaid: invoice.amountPaid, amountRefunded: invoice.amountRefunded }).from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId))).limit(1)
    if (!inv) return null
    const lines = await db.select({ type: invoiceLineItem.type, total: invoiceLineItem.total }).from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, invoiceId))
    const saleCents = Math.round(Number(inv.total || 0) * 100)
    const amount = amountCents == null ? saleCents : amountCents
    return { saleCents, amountCents: amount, eligibleCents: eligibleCents(lines, amount) }
  }

  /** What the desk shows: the salon's percentages worked on the services of the amount being charged, and the retail left out. */
  async function info(companyId: string, invoiceId: string, amountCents: number | null) {
    const e = await eligibleFor(companyId, invoiceId, amountCents)
    if (!e) return null
    const s = await settings(companyId)
    return { ...e, retailLeftOut: e.eligibleCents < e.amountCents, presets: s.presets, suggestions: suggestTips(s.presets, e.eligibleCents) }
  }

  return { settings, save, configFor, remember, eligibleFor, info }
}
export type TipPresets = ReturnType<typeof createTipPresets>
