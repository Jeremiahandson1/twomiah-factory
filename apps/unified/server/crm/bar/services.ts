// The bar's services (templates/crm-bar/backend/src/services/bar*.ts), each made once with the app's database, live
// updates, permissions, feature gate, audit and email — the template imported its own of each. The routes (./*Routes.ts)
// and the suite's service files (tests/unified/harness) use these.
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
import { createFoodSettings, foodDefaults } from './foodSettings.ts'
import { createBarTerminal, terminalStripe } from './barTerminal.ts'
import { createBarReceipts } from './barReceipts.ts'

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
  const stock = createBarStock(db)
  // Food service: the card reader on the business's own Stripe account, receipts, the kiosk and online orders.
  const food = createFoodSettings(db, foodDefaults({ tabs: d.settings?.foodService?.tabs }))
  const terminal = createBarTerminal({
    db, register, loyalty, food,
    connectedAccountFor: (companyId) => d.services.stripeService.connectedAccountFor(companyId),
    stripe: () => terminalStripe(d.services.testStripeClient),
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
  return { live, floor, managers, giftCards, kitchen, loyalty, register, reports, schedule, stock, food, terminal, receipts }
}
export type BarServices = ReturnType<typeof createBarServices>
