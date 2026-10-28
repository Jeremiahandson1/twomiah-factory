// THE DEALERSHIP'S HOME TILES — the conditions behind each count, written once for the dashboard's figure (dashboard.ts)
// and the list the tile opens (GET /api/sales-leads?tile=open, GET /api/repair-orders?tile=open).
import { notInArray } from 'drizzle-orm'
import { salesLead, repairOrder } from '../../db/schema/index.ts'

/** A sales lead is open until it is won or lost. */
export const CLOSED_LEAD_STAGES = ['closed_won', 'closed_lost']
/** A repair order is open until the work is done: not 'ready' (done, awaiting pickup) and not 'closed'. */
export const FINISHED_RO_STATUSES = ['ready', 'closed']

export const RV_LEAD_TILES = ['open'] as const
export const RV_RO_TILES = ['open'] as const

export const openLeadCondition = () => notInArray(salesLead.stage, CLOSED_LEAD_STAGES)
export const openRepairOrderCondition = () => notInArray(repairOrder.status, FINISHED_RO_STATUSES)
