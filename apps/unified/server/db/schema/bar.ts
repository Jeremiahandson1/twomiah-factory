// Bar add-on: the register (checks, items, payments, closeouts), the menu and taps, stock and purchasing, the kitchen,
// the schedule, gift cards, specials and games. Column for column from templates/crm-bar/backend/db/schema.ts.
import { pgTable, text, boolean, integer, decimal, timestamp, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { company, user } from './core.ts'
import { contact } from './crm.ts'

// Every sale is a check: a tab ("Mike"), a table ("Booth 2") or a walk-up. Items sit on it as held until
// Send fires the food to the grill as one ticket. Payments stack until the balance is zero (split evenly =
// several payments; split by item = move items to a new check). A void always carries a reason and a name.
// Ported from website-premium-bar's register (Amber Inn, 9/26) when the CRM became the bar's one database.
// Money is integer cents throughout; a check's totals are frozen when it closes, so a later tax change never
// rewrites history.
export const barCheck = pgTable('bar_check', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: integer('number').notNull(),            // "#214" on the screen and the receipt (bar_settings.check_seq)
  kind: text('kind').notNull(),                   // tab | table | walkup | online
  label: text('label').notNull(),                 // "Mike", "Booth 2", "Walk-up"
  spot: text('spot'),                             // where it's delivered: "Bar seat 6", "Booth 2"
  note: text('note'),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),   // the guest, when known
  status: text('status').default('open').notNull(), // open | paid | void
  voidReason: text('void_reason'),
  splitFromId: text('split_from_id'),
  subtotalCents: integer('subtotal_cents'),
  taxCents: integer('tax_cents'),
  totalCents: integer('total_cents'),
  tipCents: integer('tip_cents'),
  taxRateBps: integer('tax_rate_bps'),            // the rate it closed at
  openedAt: timestamp('opened_at').defaultNow().notNull(),
  openedById: text('opened_by_id').references(() => user.id, { onDelete: 'set null' }),
  openedByName: text('opened_by_name'),
  closedAt: timestamp('closed_at'),
  closedById: text('closed_by_id').references(() => user.id, { onDelete: 'set null' }),
  closedByName: text('closed_by_name'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('bar_check_company_number_key').on(t.companyId, t.number),
  index('bar_check_company_status_idx').on(t.companyId, t.status, t.openedAt),
  index('bar_check_company_closed_idx').on(t.companyId, t.closedAt),
])

export const barCheckItem = pgTable('bar_check_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  checkId: text('check_id').notNull().references(() => barCheck.id, { onDelete: 'cascade' }),
  menuItemId: text('menu_item_id').references(() => barMenuItem.id, { onDelete: 'set null' }),
  tapId: text('tap_id').references(() => barTap.id, { onDelete: 'set null' }),
  // A pour: the keg and the ounces it took at the time (a line's beer changes; this pour's cost must not).
  stockItemId: text('stock_item_id'),
  stockQty: decimal('stock_qty', { precision: 10, scale: 3 }),
  name: text('name').notNull(),                   // a snapshot: renaming the item later never rewrites the check
  size: text('size'),                             // "Platter"; null for a single-size item
  qty: integer('qty').default(1).notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  note: text('note'),
  seat: integer('seat'),
  toKitchen: boolean('to_kitchen').default(true).notNull(),
  kind: text('kind').default('item').notNull(),   // item | reward (negative) | giftcard (stored value, not taxed)
  state: text('state').default('held').notNull(), // held | sent | void
  ticketId: text('ticket_id'),
  giftCardId: text('gift_card_id'),               // kind giftcard: the card this line issued (set when the check is paid)
  voidReason: text('void_reason'),
  voidedByName: text('voided_by_name'),
  addedById: text('added_by_id').references(() => user.id, { onDelete: 'set null' }),
  addedByName: text('added_by_name'),
  addedAt: timestamp('added_at').defaultNow().notNull(),
  sentAt: timestamp('sent_at'),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_check_item_check_idx').on(t.checkId, t.addedAt),
])

export const barCheckPayment = pgTable('bar_check_payment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  checkId: text('check_id').notNull().references(() => barCheck.id, { onDelete: 'cascade' }),
  tender: text('tender').notNull(),               // cash | card_external (run on the card reader) | card_online | giftcard
  amountCents: integer('amount_cents').notNull(), // toward the check; the tip is apart
  tipCents: integer('tip_cents').default(0).notNull(),
  cashTenderedCents: integer('cash_tendered_cents'),
  changeCents: integer('change_cents'),
  providerPaymentId: text('provider_payment_id'),
  giftCardId: text('gift_card_id'),               // tender giftcard: the card it came off
  takenById: text('taken_by_id').references(() => user.id, { onDelete: 'set null' }),
  takenByName: text('taken_by_name'),
  takenAt: timestamp('taken_at').defaultNow().notNull(),
  voidedAt: timestamp('voided_at'),
  voidReason: text('void_reason'),
  voidedByName: text('voided_by_name'),
  /** card_terminal / card_online: the connected Stripe account the charge is on (a refund goes back through it). */
  stripeAccount: text('stripe_account'),
  /** Money given back through Stripe (crm/bar/barTerminal.ts refundPayment): never more than amount + tip. */
  refundedCents: integer('refunded_cents').default(0).notNull(),
  refundedAt: timestamp('refunded_at'),
  refundReason: text('refund_reason'),
  refundedByName: text('refunded_by_name'),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_check_payment_check_idx').on(t.checkId),
  uniqueIndex('bar_check_payment_provider_key').on(t.companyId, t.providerPaymentId),
  index('bar_check_payment_company_taken_idx').on(t.companyId, t.takenAt),
])

// One row per night closed. The summary is frozen as it was at close, so a report never changes afterwards.
export const barCloseout = pgTable('bar_closeout', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  businessDay: text('business_day').notNull(),    // YYYY-MM-DD the night started (4 AM to 4 AM local)
  cashExpectedCents: integer('cash_expected_cents').notNull(),
  cashCountedCents: integer('cash_counted_cents'),
  floatCents: integer('float_cents').default(0).notNull(),
  overShortCents: integer('over_short_cents'),
  note: text('note'),
  summary: json('summary').notNull(),
  closedById: text('closed_by_id').references(() => user.id, { onDelete: 'set null' }),
  closedByName: text('closed_by_name'),
  closedAt: timestamp('closed_at').defaultNow().notNull(),
  emailedAt: timestamp('emailed_at'),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_closeout_company_day_idx').on(t.companyId, t.businessDay),
])

export const barEvent = pgTable('bar_event', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  startsAt: timestamp('starts_at').notNull(),
  endsAt: timestamp('ends_at'),
  imageUrl: text('image_url'),
  isRecurring: boolean('is_recurring').default(false).notNull(),
  recurrenceDays: text('recurrence_days'),
  isPublished: boolean('is_published').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('bar_event_company_slug_key').on(t.companyId, t.slug),
  index('bar_event_company_idx').on(t.companyId, t.isPublished, t.startsAt),
])

export const barGame = pgTable('bar_game', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  league: text('league').notNull(),
  home: text('home').notNull(),
  away: text('away').notNull(),
  startsAt: timestamp('starts_at').notNull(),
  isFeatured: boolean('is_featured').default(false).notNull(),
  note: text('note'),
  /** Optional game-day hours, services/barHours.ts Range[] shape. */
  barHours: json('bar_hours'),
  kitchenHours: json('kitchen_hours'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_game_company_idx').on(t.companyId, t.startsAt),
])

// The bar's own gift cards (services/barGiftCards.ts). Stored value, no expiry and no fees, ever. A sale is not
// revenue until it is spent, so the close-out keeps "gift cards sold" apart from sales. Every change to a balance
// is a ledger row, written in the same transaction as balance_cents with the card row locked.
export const barGiftCard = pgTable('bar_gift_card', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  code: text('code').notNull(),                   // "AMBE-7K2Q-9XMP", or a pre-printed card's own number
  initialCents: integer('initial_cents').notNull(),
  balanceCents: integer('balance_cents').notNull(),
  status: text('status').default('active').notNull(), // active | void
  soldVia: text('sold_via').notNull(),            // register | online
  soldByName: text('sold_by_name'),
  checkId: text('check_id').references(() => barCheck.id, { onDelete: 'set null' }),
  purchaserName: text('purchaser_name'),
  purchaserEmail: text('purchaser_email'),
  recipientName: text('recipient_name'),
  recipientEmail: text('recipient_email'),
  message: text('message'),
  providerPaymentId: text('provider_payment_id'),
  idempotencyKey: text('idempotency_key'),
  /** Sold online by the store: the order that paid for it (the store's gift-card product). */
  orderId: text('order_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  voidedAt: timestamp('voided_at'),
  voidReason: text('void_reason'),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('bar_gift_card_company_code_key').on(t.companyId, t.code),
  uniqueIndex('bar_gift_card_company_key_key').on(t.companyId, t.idempotencyKey),
])

export const barGiftCardLedger = pgTable('bar_gift_card_ledger', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  cardId: text('card_id').notNull().references(() => barGiftCard.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(), // + issued / put back, − spent
  kind: text('kind').notNull(),                   // issue | redeem | refund | adjust | void
  checkId: text('check_id'),
  paymentId: text('payment_id'),
  byName: text('by_name'),
  note: text('note'),
  /** The store's order this movement was for: spent at its checkout, put back when it was refunded or abandoned. */
  orderId: text('order_id'),
  /** One movement per key: a retried refund or release puts the money back once. */
  idempotencyKey: text('idempotency_key'),
  at: timestamp('at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_gift_card_ledger_card_idx').on(t.cardId, t.at),
  uniqueIndex('bar_gift_card_ledger_company_key_key').on(t.companyId, t.idempotencyKey),
])

// One ticket per fire. The items are a snapshot of what the cook was asked for, with the prep time pacing used.
export const barKitchenTicket = pgTable('bar_kitchen_ticket', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  label: text('label').notNull(),                 // "Bar seat 6 · Mike", "Booth 2", "Web · Pat · 7:40"
  source: text('source').notNull(),               // bar | table | web
  note: text('note'),
  checkId: text('check_id').references(() => barCheck.id, { onDelete: 'set null' }),
  firedAt: timestamp('fired_at').defaultNow().notNull(),
  firedByName: text('fired_by_name'),
  bumpedAt: timestamp('bumped_at'),
  bumpedByName: text('bumped_by_name'),
  recalledAt: timestamp('recalled_at'),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_kitchen_ticket_company_open_idx').on(t.companyId, t.bumpedAt, t.firedAt),
])

export const barKitchenTicketItem = pgTable('bar_kitchen_ticket_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  ticketId: text('ticket_id').notNull().references(() => barKitchenTicket.id, { onDelete: 'cascade' }),
  menuItemId: text('menu_item_id').references(() => barMenuItem.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  variation: text('variation'),
  qty: integer('qty').default(1).notNull(),
  note: text('note'),
  seat: integer('seat'),
  prepSeconds: integer('prep_seconds').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_kitchen_ticket_item_ticket_idx').on(t.ticketId),
])

export const barMenuItem = pgTable('bar_menu_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  sectionId: text('section_id').references(() => barMenuSection.id, { onDelete: 'set null' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  priceCents: integer('price_cents'),
  /** When one price will not do: "1/2 lb $14 · 1/4 lb $10", "market". */
  priceLabel: text('price_label'),
  dietary: json('dietary').default([]).notNull(),
  imageUrl: text('image_url'),
  heroImageUrl: text('hero_image_url'),
  /** Markdown, for a signature item's own page on the website. */
  story: text('story'),
  isSignature: boolean('is_signature').default(false).notNull(),
  is86ed: boolean('is_86ed').default(false).notNull(),
  /** 86'd "until we open": it comes back by itself at the next opening (menu_dayparts). */
  eightySixUntilOpen: boolean('eighty_six_until_open').default(false).notNull(),
  /** When it was last put out, so the next opening after that time puts it back. */
  eightySixedAt: timestamp('eighty_sixed_at'),
  isActive: boolean('is_active').default(true).notNull(),
  /** Every priced size: [{ id, name, priceCents }] (services/barMenuSizes.ts). */
  variations: json('variations').default([]).notNull(),
  /** Add-ons and changes a guest picks (crm/bar/barModifiers.ts): [{ id, name, priceCents }] — "Add bacon" +200, "No onions" 0. */
  modifiers: json('modifiers').default([]).notNull(),
  /** The grill: null = by its section (food goes, drinks don't); true/false = this item says so. */
  toKitchen: boolean('to_kitchen'),
  /** Seconds on the grill, as the owner set it; pacing learns the real time from bumps (services/barPacing.ts). */
  prepSeconds: integer('prep_seconds'),
  learnedPrepSeconds: integer('learned_prep_seconds'),
  learnedSamples: integer('learned_samples').default(0).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('bar_menu_item_company_slug_key').on(t.companyId, t.slug),
  index('bar_menu_item_section_idx').on(t.sectionId, t.sortOrder),
])

export const barMenuSection = pgTable('bar_menu_section', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  kind: text('kind').default('food').notNull(), // food | drink
  sortOrder: integer('sort_order').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  /** Served only in this window (menu_dayparts): "11:00" to "15:00" on these days (0 = Sunday); null = all day, every day. */
  availableFrom: text('available_from'),
  availableTo: text('available_to'),
  availableDays: json('available_days').default([]).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('bar_menu_section_company_slug_key').on(t.companyId, t.slug),
])

export const barPurchaseOrder = pgTable('bar_purchase_order', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: integer('number').notNull(),            // bar_settings.po_seq: only goes forwards
  vendorId: text('vendor_id').references(() => barVendor.id, { onDelete: 'set null' }),
  status: text('status').default('draft').notNull(), // draft | sent | received | cancelled
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdByName: text('created_by_name'),
  sentAt: timestamp('sent_at'),
  receivedAt: timestamp('received_at'),
  receivedByName: text('received_by_name'),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('bar_purchase_order_company_number_key').on(t.companyId, t.number),
])

export const barPurchaseOrderLine = pgTable('bar_purchase_order_line', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orderId: text('order_id').notNull().references(() => barPurchaseOrder.id, { onDelete: 'cascade' }),
  stockItemId: text('stock_item_id').notNull().references(() => barStockItem.id, { onDelete: 'cascade' }),
  packs: decimal('packs', { precision: 10, scale: 2 }).notNull(),
  packCostCents: integer('pack_cost_cents'),      // expected
  receivedPacks: decimal('received_packs', { precision: 10, scale: 2 }),
  receivedCostCents: integer('received_cost_cents'), // what the invoice said, per pack
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_purchase_order_line_order_idx').on(t.orderId),
])

// What goes into one of a menu item, per size (null = every size). qty is in the stock item's unit.
export const barRecipeLine = pgTable('bar_recipe_line', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  menuItemId: text('menu_item_id').notNull().references(() => barMenuItem.id, { onDelete: 'cascade' }),
  sizeId: text('size_id'),
  stockItemId: text('stock_item_id').notNull().references(() => barStockItem.id, { onDelete: 'cascade' }),
  qty: decimal('qty', { precision: 10, scale: 3 }).notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_recipe_line_item_idx').on(t.menuItemId),
])

// THE SCHEDULE (services/barSchedule.ts, the arithmetic in barSchedulePlan.ts). A manager builds a workweek
// (Monday-start, the timesheet's week); staff see the copy frozen when it was published — edits after that wait
// for the next Publish. Hours actually worked are the CRM's own time_entry (the time clock); this is the plan.
export const barScheduleShift = pgTable('bar_schedule_shift', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),                     // local date YYYY-MM-DD
  start: text('start').notNull(),                 // HH:MM
  end: text('end').notNull(),                     // HH:MM; at or before start = past midnight
  position: text('position'),                     // "Bar", "Grill", "Floor"
  note: text('note'),
  createdByName: text('created_by_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_schedule_shift_company_day_idx').on(t.companyId, t.day),
])

export const barScheduleWeek = pgTable('bar_schedule_week', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  weekStart: text('week_start').notNull(),        // the Monday
  publishedAt: timestamp('published_at'),
  publishedByName: text('published_by_name'),
  snapshot: json('snapshot'),                     // [{ userId, name, day, start, end, position, note }] as published
  changedAt: timestamp('changed_at'),             // the last edit to this week's shifts
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('bar_schedule_week_company_week_key').on(t.companyId, t.weekStart),
])

export const barSettings = pgTable('bar_settings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  /** services/barHours.ts HoursConfig: { timezone, bar, kitchen, holidays }. */
  hours: json('hours').default({}).notNull(),
  /** The speakeasy door game on the website: a bcrypt hash, never the password. Null = the door is off. */
  speakeasyPasswordHash: text('speakeasy_password_hash'),
  /** What the password is good for ("$1 off a root beer"), shown only to someone who got it right. */
  speakeasyNote: text('speakeasy_note'),
  /** The last check number handed out (services/barRegister.ts): numbers only go forwards, never MAX+1. */
  checkSeq: integer('check_seq').default(0).notNull(),
  /** The grill screen: a ticket turns "waiting" at warn, "late" at late; an item with no prep time takes the default. */
  ticketWarnSeconds: integer('ticket_warn_seconds').default(600).notNull(),
  ticketLateSeconds: integer('ticket_late_seconds').default(900).notNull(),
  defaultPrepSeconds: integer('default_prep_seconds').default(480).notNull(),
  /** The first part of every gift card code ("AMBE-7K2Q-9XMP"), set from the bar's name the first time a card is
   *  issued and kept, so renaming the bar never changes the codes people hold (services/barGiftCards.ts). */
  giftCardPrefix: text('gift_card_prefix'),
  /** The last purchase order number handed out (services/barStock.ts): only goes forwards. */
  poSeq: integer('po_seq').default(0).notNull(),
  /** The room as the floor screen draws it: { tables: [{ id, name, kind: booth|table|bar, seats }] } (services/barFloor.ts). */
  floor: json('floor'),
  /** The register's card reader, the kiosk, online ordering and the delivery links (crm/bar/foodSettings.ts). */
  foodService: json('food_service').default({}).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('bar_settings_company_key').on(t.companyId),
])

// ─── Food service: the card reader, the kiosk and online orders (crm/bar/barTerminal.ts, barOrders.ts) ─────────────
// A Stripe Terminal reader registered to the business's own connected Stripe account, by the code it shows.
export const barReader = pgTable('bar_reader', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  stripeReaderId: text('stripe_reader_id').notNull(),   // tmr_…
  stripeAccount: text('stripe_account'),                // acct_… it was registered on
  locationId: text('location_id'),                      // tml_…
  label: text('label').notNull(),
  deviceType: text('device_type'),                      // bbpos_wisepos_e | stripe_s700 | simulated_wisepos_e
  serialNumber: text('serial_number'),
  createdByName: text('created_by_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('bar_reader_company_reader_key').on(t.companyId, t.stripeReaderId),
])

// One card payment sent to a reader: pending until Stripe says the PaymentIntent succeeded (then the check's payment
// row is written, once) or the reader says it failed, the guest or the bartender cancelled, or it ran out of time.
export const barTerminalCharge = pgTable('bar_terminal_charge', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  checkId: text('check_id').references(() => barCheck.id, { onDelete: 'set null' }),
  orderId: text('order_id'),                            // a kiosk order paid before it becomes a check
  readerId: text('reader_id').notNull(),                // bar_reader.id
  stripeAccount: text('stripe_account'),
  paymentIntentId: text('payment_intent_id').notNull(),
  amountCents: integer('amount_cents').notNull(),       // toward the check; a tip the reader asks for is on top
  tipCents: integer('tip_cents').default(0).notNull(),
  status: text('status').default('pending').notNull(), // pending | succeeded | failed | canceled | timed_out
  failure: text('failure'),
  paymentId: text('payment_id'),                        // bar_check_payment.id once recorded
  startedById: text('started_by_id').references(() => user.id, { onDelete: 'set null' }),
  startedByName: text('started_by_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('bar_terminal_charge_pi_key').on(t.companyId, t.paymentIntentId),
  index('bar_terminal_charge_check_idx').on(t.companyId, t.checkId, t.status),
])

// A kiosk or website order before (and after) it is paid. Its lines are priced on the server when it is placed; it
// becomes a paid check — and its food a grill ticket — only when the payment is confirmed (a kiosk "pay at the
// counter" order becomes an open check straight away, and the food goes when the counter takes the money).
export const barOrder = pgTable('bar_order', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: integer('number'),                            // the check number once it is one ("#214")
  channel: text('channel').notNull(),                   // kiosk | online
  status: text('status').default('awaiting_payment').notNull(), // awaiting_payment | at_counter | received | ready | collected | cancelled
  name: text('name'),
  tableLabel: text('table_label'),
  phone: text('phone'),
  email: text('email'),
  /** The guest ticked "Text me about my order" (site/smsConsent.ts records it). */
  textOk: boolean('text_ok').default(false).notNull(),
  /** [{ menuItemId, name, size, mods, qty, unitPriceCents, note, toKitchen }], priced on the server. */
  lines: json('lines').default([]).notNull(),
  subtotalCents: integer('subtotal_cents').notNull(),
  taxCents: integer('tax_cents').notNull(),
  totalCents: integer('total_cents').notNull(),
  taxRateBps: integer('tax_rate_bps').notNull(),
  pickupAt: timestamp('pickup_at'),
  checkId: text('check_id').references(() => barCheck.id, { onDelete: 'set null' }),
  stripeAccount: text('stripe_account'),
  stripeSessionId: text('stripe_session_id'),
  paymentIntentId: text('payment_intent_id'),
  paidAt: timestamp('paid_at'),
  receivedNotifiedAt: timestamp('received_notified_at'),
  readyAt: timestamp('ready_at'),
  readyByName: text('ready_by_name'),
  readyNotifiedAt: timestamp('ready_notified_at'),
  collectedAt: timestamp('collected_at'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_order_company_status_idx').on(t.companyId, t.status, t.createdAt),
  uniqueIndex('bar_order_session_key').on(t.companyId, t.stripeSessionId),
])

export const barSpecial = pgTable('bar_special', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  title: text('title').notNull(),
  description: text('description'),
  priceCents: integer('price_cents'),
  startsAt: timestamp('starts_at').notNull(),
  endsAt: timestamp('ends_at'),
  /** Weekly: the weekdays it runs, as two-letter codes ('MO,FR'). Null = every day while active. */
  isRecurring: boolean('is_recurring').default(false).notNull(),
  recurrenceDays: text('recurrence_days'),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_special_company_idx').on(t.companyId, t.startsAt),
])

export const barStatus = pgTable('bar_status', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  // null = follow the hours; false = closed now; true = open now (rare). All overrides lapse at overrideUntil.
  kitchenOpen: boolean('kitchen_open'),
  kitchenClosesAt: timestamp('kitchen_closes_at'),
  barOpen: boolean('bar_open'),
  barClosesAt: timestamp('bar_closes_at'),
  overrideUntil: timestamp('override_until'),
  roomStatus: text('room_status').default('quiet').notNull(), // quiet | filling | packed
  note: text('note'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedById: text('updated_by_id').references(() => user.id, { onDelete: 'set null' }),
  updatedByName: text('updated_by_name'),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('bar_status_company_key').on(t.companyId),
])

export const barStockCount = pgTable('bar_stock_count', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  status: text('status').default('open').notNull(), // open (being counted) | done
  startedAt: timestamp('started_at').defaultNow().notNull(),
  startedByName: text('started_by_name'),
  finishedAt: timestamp('finished_at'),
  finishedByName: text('finished_by_name'),
  note: text('note'),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_stock_count_company_idx').on(t.companyId, t.status, t.finishedAt),
])

export const barStockCountLine = pgTable('bar_stock_count_line', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  countId: text('count_id').notNull().references(() => barStockCount.id, { onDelete: 'cascade' }),
  stockItemId: text('stock_item_id').notNull().references(() => barStockItem.id, { onDelete: 'cascade' }),
  qty: decimal('qty', { precision: 12, scale: 3 }).notNull(),     // units on hand
  /** Open bottles counted by how full each is (0 to 1), when the venue counts by fill level (stock_fill_levels); they are part of qty. */
  fills: json('fills'),
  countedByName: text('counted_by_name'),
  countedAt: timestamp('counted_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('bar_stock_count_line_key').on(t.countId, t.stockItemId),
])

export const barStockItem = pgTable('bar_stock_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  category: text('category').default('food').notNull(),   // food | beer | liquor | wine | na | supplies
  unit: text('unit').default('each').notNull(),           // each | oz | lb | floz
  packName: text('pack_name').default('each').notNull(),  // "case of 24", "½ bbl keg"
  packSize: decimal('pack_size', { precision: 12, scale: 3 }).default('1').notNull(),   // units in a pack
  packCostCents: integer('pack_cost_cents'),              // last price paid (set when an order is received)
  vendorId: text('vendor_id').references(() => barVendor.id, { onDelete: 'set null' }),
  parPacks: decimal('par_packs', { precision: 10, scale: 2 }),   // keep at least this many packs
  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_stock_item_company_idx').on(t.companyId, t.category),
])

export const barTap = pgTable('bar_tap', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  lineNumber: integer('line_number').notNull(),
  beerName: text('beer_name').notNull(),
  brewery: text('brewery'),
  style: text('style'),
  abv: decimal('abv', { precision: 4, scale: 1 }),
  originCountry: text('origin_country'),
  description: text('description'),
  badge: text('badge'),
  priceCents: integer('price_cents'),
  /** pouring | just_tapped | last_keg | blown. The website shows the first three, never a keg level. */
  status: text('status').default('pouring').notNull(),
  /** The keg on this line (a stock item) and one pour, in fl oz: each pour on the register records what it took. */
  stockItemId: text('stock_item_id').references(() => barStockItem.id, { onDelete: 'set null' }),
  pourOz: decimal('pour_oz', { precision: 6, scale: 2 }).default('16').notNull(),
  /** Pour sizes [{ id, name, oz, priceCents }] — a pint, a pitcher (services/barTapSizes.ts). Empty = the one pour above. */
  sizes: json('sizes').default([]).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  tappedAt: timestamp('tapped_at'),
  blownAt: timestamp('blown_at'),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_tap_company_idx').on(t.companyId, t.isActive, t.sortOrder),
])

export const barTimeOff = pgTable('bar_time_off', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  note: text('note'),
  status: text('status').default('pending').notNull(), // pending | approved | denied
  decidedByName: text('decided_by_name'),
  decidedAt: timestamp('decided_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_time_off_company_day_idx').on(t.companyId, t.day),
])

// STOCK AND COSTING (services/barStock.ts, the pure arithmetic in barCosting.ts). Stock is bought by the pack (a
// case, a ½ bbl keg, a 750 ml bottle) and used by the unit (each, oz, lb, fl oz): cost per unit = pack cost / pack
// size. On hand is never typed in except by counting; between counts it is estimated — the last count + what was
// received since − what the register says was used since (recipes × items sold, and each tap pour's snapshot).
// Named bar_* because crm-basic's job-costing inventory (inventory_item, purchase_order) is still in this schema,
// unused by a bar. Ported from website-premium-bar's stock tables (Amber Inn, 9/28), scoped to a company.
export const barVendor = pgTable('bar_vendor', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  contactName: text('contact_name'),
  phone: text('phone'),
  email: text('email'),
  orderDays: text('order_days'),                 // "Tue, Fri" — what the rep said
  note: text('note'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bar_vendor_company_idx').on(t.companyId),
])
