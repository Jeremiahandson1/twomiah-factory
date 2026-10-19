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
  return { live, floor, managers, giftCards, kitchen, loyalty, register, reports, schedule, stock }
}
export type BarServices = ReturnType<typeof createBarServices>
