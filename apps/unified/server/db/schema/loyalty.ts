// Loyalty add-on (bars and salons): members, rewards and the points ledger. The table names are the shared loyalty
// code's (packages/tenant-backend/src/loyalty), kept so its rows move across; the union of the bar's and the salon's
// columns. From templates/crm-{bar,salon}/backend/db/schema.ts.
import { pgTable, text, boolean, integer, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { barMenuItem } from './bar.ts'
import { company } from './core.ts'
import { contact } from './crm.ts'
import { serviceMenu } from './salon.ts'

export const loyaltyMember = pgTable('loyalty_members', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  // The spendable wallet. Redeeming moves this and nothing else.
  pointsBalance: integer('points_balance').default(0).notNull(),
  // Everything ever earned — the outward "points earned to date" figure. Never spent down, so it
  // stays honest as a lifetime stat rather than doubling as a balance.
  lifetimePoints: integer('lifetime_points').default(0).notNull(),
  // Punch card. Counted, not derived, because which services qualify can be reconfigured and a
  // customer must not lose punches they already earned under the old rule.
  qualifyingVisits: integer('qualifying_visits').default(0).notNull(),
  punchRewardsEarned: integer('punch_rewards_earned').default(0).notNull(),
  joinedAt: timestamp('joined_at').defaultNow(),
  lastActivityAt: timestamp('last_activity_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('loyalty_member_company_id_idx').on(t.companyId),
  // One membership per client. Without it a second completed visit racing the first mints a
  // duplicate member and the client's points split across two rows.
  uniqueIndex('loyalty_member_company_contact_uniq').on(t.companyId, t.contactId),
])

export const loyaltyReward = pgTable('loyalty_rewards', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  pointsCost: integer('points_cost').default(0).notNull(),
  type: text('type').default('fixed').notNull(), // fixed | percent | free_item
  // CENTS for 'fixed', whole percent for 'percent', unused for 'free_item'.
  valueCents: integer('value_cents').default(0).notNull(),
  // The menu item this reward pays for (one of it), when type is free_item.
  menuItemId: text('menu_item_id').references(() => barMenuItem.id, { onDelete: 'set null' }),
  active: boolean('active').default(true).notNull(),
  usageCount: integer('usage_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  // The service this reward pays for, when type is free_item.
  serviceId: text('service_id').references(() => serviceMenu.id, { onDelete: 'set null' }),
}, (t) => [
  index('loyalty_reward_company_id_idx').on(t.companyId),
])

export const loyaltyTransaction = pgTable('loyalty_transactions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  memberId: text('member_id').notNull().references(() => loyaltyMember.id, { onDelete: 'cascade' }),
  // earn | redeem | bonus | adjustment_add | adjustment_subtract | reversal
  type: text('type').notNull(),
  points: integer('points').notNull(),
  balanceAfter: integer('balance_after'),
  description: text('description'),
  checkId: text('check_id'),            // the check it was earned or spent on
  // Set on an EARN row only (= checkId): a paid check earns once, whatever retries happen, while a reward may be
  // redeemed, taken off and redeemed again on the same check. NULLs never collide, so only earns are unique.
  earnCheckId: text('earn_check_id'),
  rewardId: text('reward_id'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  appointmentId: text('appointment_id'),
  invoiceId: text('invoice_id'),
}, (t) => [
  index('loyalty_tx_member_idx').on(t.memberId, t.createdAt),
  uniqueIndex('loyalty_tx_earn_per_check').on(t.memberId, t.earnCheckId),
  // The salon's: completing the same visit twice (a status flip, a retry) cannot award its points again
  // (templates/crm-salon schema.ts; the salon's award relies on this refusal).
  uniqueIndex('loyalty_tx_earn_per_appointment').on(t.memberId, t.type, t.appointmentId),
])
