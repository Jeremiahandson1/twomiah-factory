// The bar's services (templates/crm-bar/backend/src/services/bar*.ts), each made once with the app's database, live
// updates, permissions, feature gate, audit and email — the template imported its own of each. The routes (./*Routes.ts)
// and the suite's service files (tests/unified/harness) use these.
import { eq } from 'drizzle-orm'
import { company } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { BarDb } from './db.ts'
import { createBarLive } from './barLive.ts'
import { createBarFloor } from './barFloor.ts'
import { createBarManagers } from './barManagers.ts'
import { createBarGiftCards } from './barGiftCards.ts'
import { createBarKitchen } from './barKitchen.ts'
import { createBarLoyalty } from './barLoyalty.ts'
import { createBarRegister } from './barRegister.ts'
import { createBarReports } from './barReports.ts'
import { createBarSchedule } from './barSchedule.ts'
import { createBarStock } from './barStock.ts'
import { createBarInvoices } from './barInvoices.ts'
import { claudeInvoiceReader } from './barInvoiceReader.ts'
import { createFoodSettings, foodDefaults } from './foodSettings.ts'
import { createBarTerminal, terminalStripe } from './barTerminal.ts'
import { createBarTips } from './barTips.ts'
import { createBarTipSources } from './barTipSources.ts'
import { createBarStaffRequests } from './barStaffRequests.ts'
import { createBarReceipts } from './barReceipts.ts'
import { createBarOrders } from './barOrders.ts'
import { hasConsent, recordConsent } from '../../site/smsConsent.ts'

export function createBarServices(d: CrmDeps) {
  const db = d.db as BarDb
  const emit = (companyId: string, event: string, data: unknown) => d.realtime.emitToCompany(companyId, event, data)
  const live = createBarLive(db)
  const floor = createBarFloor(db)
  const managers = createBarManagers(db, d.permissions)
  const giftCards = createBarGiftCards(db)
  const kitchen = createBarKitchen(db, emit)
  const loyalty = createBarLoyalty(db, d.features.isFeatureEnabled)
  const register = createBarRegister(db, emit, kitchen, loyalty, giftCards)
  const reports = createBarReports(db, live, register, (m) => d.services.emailService.sendRaw(m))
  const schedule = createBarSchedule(db, d.audit, live)
  const staffRequests = createBarStaffRequests(db, schedule, (m) => d.services.emailService.sendRaw(m), async (companyId) => (await db.select({ email: company.email }).from(company).where(eq(company.id, companyId)).limit(1))[0]?.email ?? null)
  const stock = createBarStock(db)
  // Invoices read from a photo (restaurant-bar parity #7): the reader is Claude over the Messages API, the file store is the app's.
  const invoices = createBarInvoices({ db, reader: () => claudeInvoiceReader, storage: () => d.services.storage as any })
  const tips = createBarTips(db, live)
  // Tips from another register (Toast, Square) are read just before a night's tips are counted, when the venue has the feature on.
  const tipSources = createBarTipSources(db, live, { logger: d.logger })
  tips.setExternalRefresh(async (companyId, day) => (await d.features.isFeatureEnabled(companyId, 'bar_tip_import')) ? tipSources.importDay(companyId, day) : [])
  // Food service: the card reader on the business's own Stripe account, receipts, the kiosk and online orders.
  const food = createFoodSettings(db, foodDefaults({ tabs: d.settings?.foodService?.tabs }))
  const terminal = createBarTerminal({
    db, register, loyalty, food,
    connectedAccountFor: (companyId) => d.services.stripeService.connectedAccountFor(companyId),
    stripe: () => terminalStripe(d.services.testStripeClient),
    // A kiosk order paid on the reader becomes its paid check (and its grill ticket) in the same transaction.
    onOrderPaid: (tx, order, payment) => orders.paidInTx(tx, order, { tender: 'card_terminal', ...payment }),
    afterOrderPaid: (companyId, orderId, fired) => orders.afterPaid(companyId, orderId, fired),
  })
  const orders = createBarOrders({
    db, register, food, live, stripe: () => terminalStripe(d.services.testStripeClient), logger: d.logger,
    connectedAccountFor: (companyId) => d.services.stripeService.connectedAccountFor(companyId),
    isFeatureEnabled: (companyId, f) => d.features.isFeatureEnabled(companyId, f),
    sendEmail: (m) => sendEmail(m), sendText: (companyId, to, message) => sendText(companyId, to, message),
    // A website order's texts go only to a number that ticked "Text me about my order" and has not opted out since.
    mayText: async (companyId, phone) => (await hasConsent(db, companyId, phone)) && !(await receipts.optedOut(companyId, phone)),
    recordConsent: (companyId, phone, ip) => recordConsent(db, companyId, { phone, source: 'website_form', topic: 'order', page: '/order', ip }),
  })
  const sendText = async (companyId: string, to: string, message: string): Promise<{ sent: boolean; why?: string }> => {
    try {
      const r: any = await d.services.sms.sendSMS(companyId, { toPhone: to, message })
      if (r === null) return { sent: false, why: 'That number has opted out of texts from you.' }
      if (r?.refused) return { sent: false, why: r.errorMessage || 'Texting is not set up yet (Settings › Texting).' }
      if (r?.status === 'failed') return { sent: false, why: r.errorMessage || 'The text did not send.' }
      return { sent: true }
    } catch (e: any) { return { sent: false, why: e?.message || 'The text did not send.' } }
  }
  const sendEmail = (m: { to: string; subject: string; html: string; fromName?: string }) => d.services.emailService.sendRaw(m)
  const receipts = createBarReceipts({ db, register, timezone: (companyId) => reports.barTimezone(companyId), sendEmail, sendText })
  return { live, floor, managers, giftCards, kitchen, loyalty, register, reports, schedule, staffRequests, stock, invoices, tips, tipSources, food, terminal, receipts, orders }
}
export type BarServices = ReturnType<typeof createBarServices>
