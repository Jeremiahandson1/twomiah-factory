// The Apps & integrations catalogue (store_apps, 2026-10-31, parity row 8; Shopify's app list, for what a single shop connects).
// One line per thing the shop can connect or switch on — what it is, whether it is set up, its settings in a few words, and the
// screen where it is managed. It READS the state the other screens keep (it never holds a second copy of any setting), so it
// cannot disagree with them. Words, never codes: "Test mode", "Not connected".
//
// Not here, and why: apps published by outside developers. Shopify's App Store is a marketplace of third parties; this shop's
// equivalent is its Store API and webhooks (a developer builds against those with the owner's key), but a catalogue of other
// companies' apps needs those companies, a review process and a listing — an outside party's work, not something to build here.
import { and, eq } from 'drizzle-orm'
import { qbIntegration } from '../../../db/schema/index.ts'
import { shippingConfig, supplierConfig, paymentConfig, storeApiKey, storeWebhook } from '../../../db/schema/store.ts'
import { companyRowTimeZone } from '@twomiah/tenant-backend'
import { company } from '../../../db/schema/index.ts'
import { settingsView } from '../audiences/audiences.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'

export interface CatalogueApp {
  id: string
  name: string
  group: string
  description: string
  /** connected = set up and working · not_connected = there to set up · off = the feature is not switched on (Settings › Features) */
  state: 'connected' | 'not_connected' | 'off'
  stateLabel: string
  /** The settings in a few plain lines, as { label, value }. */
  settings: Array<{ label: string; value: string }>
  manage: { label: string; to: string }
}

const PAY: Record<string, string> = { stripe: 'Stripe', square: 'Square', paypal: 'PayPal' }
const SHIP: Record<string, string> = { easypost: 'EasyPost' }
const SUPPLIER: Record<string, string> = { printful: 'Printful', cj: 'CJ Dropshipping' }
const mode = (m: string) => (m === 'live' ? 'Live' : 'Test mode')
const yn = (b: boolean) => (b ? 'On' : 'Off')

export async function appsCatalogue(d: CrmDeps, core: StoreCore, companyId: string): Promise<{ apps: CatalogueApp[]; groups: string[]; zone: string; outsideParty: string }> {
  const { db } = d
  const on = (f: string) => d.features.isFeatureEnabled(companyId, f).catch(() => false)
  const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
  const zone = companyRowTimeZone(co)
  const apps: CatalogueApp[] = []
  const off = (id: string, name: string, group: string, description: string, manage: CatalogueApp['manage']): CatalogueApp => ({ id, name, group, description, state: 'off', stateLabel: 'Not switched on', settings: [], manage })
  const stamp = (t: Date | string | null | undefined) => (t ? new Date(t).toLocaleString('en-US', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }) : 'Never')

  // Payments — the shop's own account (Stripe Connect, or Square/PayPal keys).
  {
    const provider = await core.getActiveProvider(companyId).catch(() => null)
    const [cfg] = await db.select().from(paymentConfig).where(and(eq(paymentConfig.companyId, companyId), eq(paymentConfig.connected, true))).limit(1)
    apps.push({
      id: 'payments', name: 'Payments', group: 'Payments and shipping', description: 'Take card payments at checkout, into your own account.',
      state: provider ? 'connected' : 'not_connected', stateLabel: provider ? `Connected to ${PAY[provider.name] ?? provider.name}` : 'Not connected',
      settings: provider ? [{ label: 'Provider', value: PAY[provider.name] ?? provider.name }, ...(cfg ? [{ label: 'Mode', value: mode(cfg.mode) }] : [])] : [],
      manage: { label: 'Open Payments', to: '/crm/payments' },
    })
  }
  // Shipping labels — EasyPost.
  {
    const [cfg] = await db.select().from(shippingConfig).where(and(eq(shippingConfig.companyId, companyId), eq(shippingConfig.connected, true))).limit(1)
    apps.push({
      id: 'shipping', name: 'Shipping labels (EasyPost)', group: 'Payments and shipping', description: 'Buy postage and print labels from an order; the shopper gets the tracking number.',
      state: cfg ? 'connected' : 'not_connected', stateLabel: cfg ? 'Connected' : 'Not connected',
      settings: cfg ? [{ label: 'Carrier account', value: SHIP[cfg.provider] ?? cfg.provider }, { label: 'Mode', value: mode(cfg.mode) }, { label: 'Ships from', value: cfg.fromAddress ? 'Set' : 'Not set yet' }, { label: 'Default parcel', value: cfg.defaultParcel ? 'Set' : 'Using the standard parcel' }] : [],
      manage: { label: 'Open Shipping', to: '/crm/shipping' },
    })
  }
  // Dropship supplier — Printful or CJ.
  {
    const [cfg] = await db.select().from(supplierConfig).where(and(eq(supplierConfig.companyId, companyId), eq(supplierConfig.connected, true))).limit(1)
    apps.push({
      id: 'supplier', name: 'Dropship supplier', group: 'Payments and shipping', description: 'Send paid orders to Printful or CJ to print and ship.',
      state: cfg ? 'connected' : 'not_connected', stateLabel: cfg ? `Connected to ${SUPPLIER[cfg.provider] ?? cfg.provider}` : 'Not connected',
      settings: cfg ? [{ label: 'Supplier', value: SUPPLIER[cfg.provider] ?? cfg.provider }, { label: 'Mode', value: mode(cfg.mode) }, { label: 'Send paid orders automatically', value: yn(cfg.autoForward) }] : [],
      manage: { label: 'Open Suppliers', to: '/crm/suppliers' },
    })
  }
  // QuickBooks.
  if (!(await on('quickbooks'))) apps.push(off('quickbooks', 'QuickBooks', 'Accounting', 'Paid orders become sales receipts in your books.', { label: 'Switch on in Settings › Features', to: '/crm/settings/features' }))
  else {
    const [qb] = await db.select().from(qbIntegration).where(eq(qbIntegration.companyId, companyId)).limit(1)
    const connected = !!(qb?.realmId && qb.refreshToken)
    apps.push({
      id: 'quickbooks', name: 'QuickBooks', group: 'Accounting', description: 'Paid orders become sales receipts in your books.',
      state: connected ? 'connected' : 'not_connected', stateLabel: connected ? 'Connected' : 'Not connected',
      settings: connected ? [{ label: 'Automatic sync', value: yn(!!qb.syncEnabled) }, { label: 'Last synced', value: stamp(qb.lastSyncedAt) }] : [],
      manage: { label: 'Open Settings › Integrations', to: '/crm/settings/integrations' },
    })
  }
  // Email Marketing.
  if (!(await on('email_marketing'))) apps.push(off('email_marketing', 'Email Marketing', 'Marketing', 'Newsletters, automatic emails and campaigns to your customers.', { label: 'Switch on in Settings › Features', to: '/crm/settings/features' }))
  else apps.push({
    id: 'email_marketing', name: 'Email Marketing', group: 'Marketing', description: 'Newsletters, automatic emails and campaigns to your customers.',
    state: 'connected', stateLabel: 'On', settings: [{ label: 'Customer groups for campaigns', value: (await on('store_segments')) ? 'Segments are on' : 'Segments are off' }, { label: 'Post-purchase emails', value: (await on('store_followups')) ? 'Available' : 'Not switched on' }],
    manage: { label: 'Open Marketing', to: '/crm/marketing' },
  })
  // Review Requests.
  if (!(await on('google_reviews'))) apps.push(off('google_reviews', 'Review Requests', 'Marketing', 'Ask customers for a Google review after their order arrives.', { label: 'Switch on in Settings › Features', to: '/crm/settings/features' }))
  else apps.push({
    id: 'google_reviews', name: 'Review Requests', group: 'Marketing', description: 'Ask customers for a Google review after their order arrives.',
    state: 'connected', stateLabel: 'On', settings: [], manage: { label: 'Open Reviews', to: '/crm/reviews' },
  })
  // Google & Meta: audiences, the pixel and Tag Manager, purchase events.
  if (!(await on('store_audiences'))) apps.push(off('ads', 'Google and Meta ads', 'Advertising', 'Customer audiences for Meta and Google Ads, and purchase tracking.', { label: 'Switch on in Settings › Features', to: '/crm/settings/features' }))
  else {
    const v = await settingsView(db, companyId)
    const any = v.purchaseEventsOn || v.meta.capiOn || v.meta.canPush || v.google.canPush
    apps.push({
      id: 'ads', name: 'Google and Meta ads', group: 'Advertising', description: 'Customer audiences for Meta and Google Ads, and purchase tracking.',
      state: any ? 'connected' : 'not_connected', stateLabel: any ? 'Set up' : 'Not set up',
      settings: [
        { label: 'Purchase tags on the order-received page', value: yn(v.purchaseEventsOn) },
        { label: 'Meta pixel', value: v.meta.pixelId ? 'Set' : 'Not set (Website settings)' },
        { label: 'Google Tag Manager', value: v.google.tagManagerId ? 'Set' : 'Not set (Website settings)' },
        { label: 'Meta Conversions API', value: yn(v.meta.capiOn) },
        { label: 'Send audiences to Meta', value: v.meta.canPush ? 'Ready' : 'Not connected' },
        { label: 'Send audiences to Google Ads', value: v.google.canPush ? 'Ready' : 'Not connected' },
      ],
      manage: { label: 'Open Audiences', to: '/crm/audiences' },
    })
  }
  // The shop's own developer tools: the Store API and webhooks (the page below lists them).
  {
    const keys = (await db.select().from(storeApiKey).where(eq(storeApiKey.companyId, companyId))).filter((k: any) => !k.revokedAt)
    if (!(await on('store_api'))) apps.push(off('store_api', 'Store API', 'For developers', 'Read products, orders, customers and stock, and change stock counts, from your own scripts or another system.', { label: 'Switch on in Settings › Features', to: '/crm/settings/features' }))
    else apps.push({
      id: 'store_api', name: 'Store API', group: 'For developers', description: 'Read products, orders, customers and stock, and change stock counts, from your own scripts or another system.',
      state: keys.length ? 'connected' : 'not_connected', stateLabel: keys.length ? `${keys.length} key${keys.length === 1 ? '' : 's'} in use` : 'No keys yet',
      settings: [{ label: 'Live keys', value: String(keys.length) }, { label: 'Most recent use', value: stamp(keys.map((k: any) => k.lastUsedAt).filter(Boolean).sort().pop()) }],
      manage: { label: 'Manage keys below', to: '#store-api' },
    })
    const hooks = (await db.select().from(storeWebhook).where(eq(storeWebhook.companyId, companyId))).filter((w: any) => w.active)
    if (!(await on('store_webhooks'))) apps.push(off('store_webhooks', 'Webhooks', 'For developers', 'Your shop posts orders, products and stock changes to the addresses you give it, signed, with retries.', { label: 'Switch on in Settings › Features', to: '/crm/settings/features' }))
    else apps.push({
      id: 'store_webhooks', name: 'Webhooks', group: 'For developers', description: 'Your shop posts orders, products and stock changes to the addresses you give it, signed, with retries.',
      state: hooks.length ? 'connected' : 'not_connected', stateLabel: hooks.length ? `${hooks.length} address${hooks.length === 1 ? '' : 'es'} listening` : 'No addresses yet',
      settings: [{ label: 'Addresses switched on', value: String(hooks.length) }, { label: 'Last delivery', value: stamp(hooks.map((w: any) => w.lastDeliveryAt).filter(Boolean).sort().pop()) }],
      manage: { label: 'Manage webhooks below', to: '#store-webhooks' },
    })
  }
  const groups = [...new Set(apps.map((a) => a.group))]
  return {
    apps, groups, zone,
    outsideParty: 'Apps made by other companies, as in Shopify’s App Store, are not here: that is a marketplace which needs those developers, a review of their apps and a listing. A developer can build against this shop’s Store API and webhooks with a key you give them.',
  }
}
