// Core layer (SPEC §4.1): the business, the people who sign in, and the audit log. Present in every tenant.
//
// Column for column the base CRM's tables (templates/crm/backend/db/schema.ts), so a tenant's existing rows move
// across unchanged. The one difference is primaryColor's default: the template's was a build-time placeholder
// ('{{PRIMARY_COLOR}}'); the unified app has no build step for its schema, so the default is the shared UI's own
// fallback (packages/tenant-ui/src/brandPalette.js DEFAULT_BRAND_HEX) and the Factory sets the real colour.
import { pgTable, text, boolean, integer, decimal, timestamp, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'

export const company = pgTable('company', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  logo: text('logo'),
  primaryColor: text('primary_color').default('#f97316').notNull(),
  secondaryColor: text('secondary_color'),
  website: text('website'),
  licenseNumber: text('license_number'),
  enabledFeatures: json('enabled_features').default([]).notNull(),
  settings: json('settings').default({}).notNull(),
  integrations: json('integrations').default({}).notNull(),

  // Instant Estimator
  estimatorEnabled: boolean('estimator_enabled').default(false).notNull(),
  pricePerSquareLow: decimal('price_per_square_low', { precision: 10, scale: 2 }).default('350.00').notNull(),
  pricePerSquareHigh: decimal('price_per_square_high', { precision: 10, scale: 2 }).default('550.00').notNull(),
  estimatorHeadline: text('estimator_headline').default('Get Your Free Instant Estimate').notNull(),
  estimatorDisclaimer: text('estimator_disclaimer').default('This is an automated estimate based on satellite data. Final pricing may vary after on-site inspection.').notNull(),

  // Stripe
  stripeCustomerId: text('stripe_customer_id').unique(),
  subscriptionTier: text('subscription_tier'),
  licenseType: text('license_type'),
  lifetimeAccess: boolean('lifetime_access').default(false).notNull(),

  // Twilio
  twilioPhoneNumber: text('twilio_phone_number'),
  twilioAccountSid: text('twilio_account_sid'),
  twilioAuthToken: text('twilio_auth_token'),
  // CallRail webhook signing key (Call Tracking › Settings). Write-only: never returned, the screen sees set / not set.
  callrailSigningKey: text('callrail_signing_key'),

  // Onboarding (V1 domain + email setup wizard)
  onboardingCompletedAt: timestamp('onboarding_completed_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const user = pgTable('user', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  phone: text('phone'),
  avatar: text('avatar'),
  role: text('role').default('user').notNull(),
  hourlyRate: decimal('hourly_rate', { precision: 10, scale: 2 }),
  isActive: boolean('is_active').default(true).notNull(),
  lastLogin: timestamp('last_login'),
  // Per-account lockout: consecutive failed logins → 15-minute lock (shared auth). Per-IP rate limiting alone
  // never stopped a credential-stuffing run that rotates addresses.
  failedLoginCount: integer('failed_login_count').default(0).notNull(),
  lockedUntil: timestamp('locked_until'),
  // Grants the OWNER hands out on top of the role (Settings › Users), e.g. 'users:read'.
  extraPermissions: json('extra_permissions').default([]),
  refreshToken: text('refresh_token'),
  resetToken: text('reset_token'),
  resetTokenExp: timestamp('reset_token_exp'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('user_email_company_id_key').on(t.email, t.companyId),
  index('user_company_id_idx').on(t.companyId),
])

// Two-factor (SPEC §5.3). The shared sign-in (packages/tenant-backend/src/auth/mfa.ts) asks the database whether
// these two tables exist, so they are core: every tenant has two-factor.
export const mfaDevice = pgTable('mfa_devices', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  /** totp | backup_codes. sms/email are presentable factors the engine knows but no vertical offers yet. */
  type: text('type').notNull(),
  name: text('name'),
  /** The base32 TOTP seed. Only ever read by the verifier; never returned by a route after enrolment. */
  secret: text('secret'),
  phoneNumber: text('phone_number'),
  /** Recovery codes, SHA-256 hashed and removed as they are spent. */
  backupCodes: json('backup_codes'),
  /** An enrolment nobody finished is not a second factor: the gate only counts verified devices. */
  isVerified: boolean('is_verified').default(false),
  isPrimary: boolean('is_primary').default(false),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('mfa_device_user_idx').on(t.userId),
  index('mfa_device_company_idx').on(t.companyId),
])

export const mfaChallenge = pgTable('mfa_challenges', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  // SET NULL: a challenge row records that a sign-in happened, and its device may later be removed.
  deviceId: text('device_id').references(() => mfaDevice.id, { onDelete: 'set null' }),
  code: text('code'),
  /** 'login' for the sign-in challenge; the in-app ones use the factor's own name. */
  type: text('type').notNull(),
  status: text('status').default('pending'), // pending|verified|expired|failed
  /** Wrong codes spent against this challenge — five and it is done. */
  attempts: integer('attempts').default(0).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  expiresAt: timestamp('expires_at').notNull(),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('mfa_challenge_user_idx').on(t.userId),
])

/**
 * Every photo: a job's, a contact's, and the website's library (SPEC §4.1, one library shared by site and CRM).
 * The base CRM's photo table, plus three columns for the website's: a CRM photo is private (served to a signed-in
 * person through /api/photos/:id/file); a website photo is public, at `publicUrl`, and carries its alt text.
 */
export const photo = pgTable('photo', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  /** The storage key. */
  filename: text('filename').notNull(),
  originalName: text('original_name'),
  mimeType: text('mime_type').default('image/jpeg').notNull(),
  size: integer('size'),
  width: integer('width'),
  height: integer('height'),
  thumbnailPath: text('thumbnail_path'),
  caption: text('caption'),
  tags: json('tags'),
  /** On the public website (true) or only for signed-in people (false). */
  isPublic: boolean('is_public').default(false).notNull(),
  /** Where the public website loads it from; set only when isPublic. */
  publicUrl: text('public_url'),
  /** Describes the picture for someone who can't see it. */
  alt: text('alt'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('photo_company_id_idx').on(t.companyId),
  index('photo_entity_type_entity_id_idx').on(t.entityType, t.entityId),
])

/** The company's email addresses at its own domain (the base CRM's table; the Factory reads them back to Cloudflare). */
export const emailAlias = pgTable('email_alias', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  localPart: text('local_part').notNull(),
  routingMode: text('routing_mode').notNull().default('forward'), // 'forward' | 'crm'
  forwardTo: text('forward_to'),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('email_alias_local_part_idx').on(t.localPart),
])

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  entityName: text('entity_name'),
  changes: json('changes'),
  metadata: json('metadata'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  userId: text('user_id'),
  userName: text('user_name'),
  userEmail: text('user_email'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('audit_log_company_id_idx').on(t.companyId),
  index('audit_log_entity_entity_id_idx').on(t.entity, t.entityId),
  index('audit_log_user_id_idx').on(t.userId),
  index('audit_log_created_at_idx').on(t.createdAt),
])
