// Parity row 23 (care_billing_contacts, docs/parity/homecare-private-pay.md): who pays a client's invoices, and every address
// the invoice, its reminders and the payment notices go to. AlayaCare's billing contact: the client (self-pay) or a family
// member, invoices sent to up to five emails, set for many at once.
//
//   · kind 'client'  — the client pays: the portal email, else the client's email, then the extra addresses;
//   · kind 'family'  — one of the client's family members (family_members, this client's, still active): their email, then the extras;
//   · kind 'other'   — someone typed here (a name and the extra addresses only: a trust officer, a son in another state);
//   · not set (NULL) — nothing changes: callers send where they always sent (the portal email, else the client's).
// At most five addresses in all, the first one first. The feature switch is the caller's: off, recipientsOf answers null and
// every sender keeps its old rule.
import { sql } from 'drizzle-orm'
import { camelFirst, camelRows, rowsOf } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

export const BILLING_CONTACTS_FEATURE = 'care_billing_contacts'
export const MAX_BILLING_EMAILS = 5
export const BILLING_KINDS = ['client', 'family', 'other'] as const
export type BillingKind = (typeof BILLING_KINDS)[number]

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
const clean = (e: unknown) => String(e ?? '').trim()

/** Unique addresses (case-insensitive), first spelling kept, in order. */
export function uniqueEmails(list: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const e = clean(raw)
    if (!e || seen.has(e.toLowerCase())) continue
    seen.add(e.toLowerCase())
    out.push(e)
  }
  return out
}

export interface BillingRecipients { kind: BillingKind; name: string | null; emails: string[] }

interface ContactRow {
  id: string; firstName: string; lastName: string; email: string | null; portalEmail: string | null
  billingContactKind: string | null; billingFamilyMemberId: string | null; billingContactName: string | null; billingEmails: unknown
  memberName: string | null; memberEmail: string | null
}

async function contactRow(q: Q, companyId: string, clientId: string): Promise<ContactRow | null> {
  return (camelFirst(await q.execute(sql`
    SELECT c.id, c.first_name, c.last_name, c.email, c.portal_email, c.billing_contact_kind, c.billing_family_member_id,
           c.billing_contact_name, c.billing_emails, fm.name AS member_name, fm.email AS member_email
      FROM clients c
      LEFT JOIN family_members fm ON fm.id = c.billing_family_member_id AND fm.client_id = c.id AND fm.company_id = c.company_id AND fm.is_active
     WHERE c.id = ${clientId} AND c.company_id = ${companyId}`)) as ContactRow | null) ?? null
}

const extrasOf = (v: unknown): string[] => {
  let a: unknown = v
  if (typeof a === 'string') { try { a = JSON.parse(a) } catch { a = [] } }
  return Array.isArray(a) ? a.map(clean).filter(Boolean) : []
}

/** Who the billing contact is and every address, from one client row. Null: not set, or no address to send to. */
export function recipientsFromRow(r: ContactRow | null): BillingRecipients | null {
  if (!r || !BILLING_KINDS.includes(r.billingContactKind as BillingKind)) return null
  const kind = r.billingContactKind as BillingKind
  const extras = extrasOf(r.billingEmails)
  const first = kind === 'client' ? clean(r.portalEmail) || clean(r.email) : kind === 'family' ? clean(r.memberEmail) : ''
  const emails = uniqueEmails([first, ...extras]).slice(0, MAX_BILLING_EMAILS)
  if (!emails.length) return null
  const name = kind === 'client' ? `${r.firstName} ${r.lastName}`.trim() : kind === 'family' ? clean(r.memberName) || null : clean(r.billingContactName) || null
  return { kind, name, emails }
}

/**
 * The addresses a client's invoices, reminders and payment notices go to — or null, and the caller keeps its old rule, when
 * the feature is off (`on`), no billing contact is set, or the one set has no address.
 */
export async function recipientsOf(q: Q, companyId: string, clientId: string, on: boolean): Promise<BillingRecipients | null> {
  if (!on) return null
  return recipientsFromRow(await contactRow(q, companyId, clientId))
}

/** Every active client with its billing contact, for the office's list. */
export async function billingContactList(q: Q, companyId: string) {
  const rows = camelRows(await q.execute(sql`
    SELECT c.id, c.first_name, c.last_name, c.email, c.portal_email, c.billing_contact_kind, c.billing_family_member_id,
           c.billing_contact_name, c.billing_emails, fm.name AS member_name, fm.email AS member_email
      FROM clients c
      LEFT JOIN family_members fm ON fm.id = c.billing_family_member_id AND fm.client_id = c.id AND fm.company_id = c.company_id AND fm.is_active
     WHERE c.company_id = ${companyId} AND c.is_active
     ORDER BY c.last_name, c.first_name`)) as ContactRow[]
  return rows.map((r) => shape(r))
}

function shape(r: ContactRow) {
  const set = recipientsFromRow(r)
  return {
    clientId: r.id, firstName: r.firstName, lastName: r.lastName, clientEmail: clean(r.portalEmail) || clean(r.email) || null,
    kind: (BILLING_KINDS.includes(r.billingContactKind as BillingKind) ? r.billingContactKind : null) as BillingKind | null,
    familyMemberId: r.billingFamilyMemberId, contactName: r.billingContactName, extraEmails: extrasOf(r.billingEmails),
    // Where the next invoice goes: the billing contact's addresses, or (not set) the old rule's one address.
    sendsTo: set ? set.emails : [clean(r.portalEmail) || clean(r.email)].filter(Boolean),
    // A family member was chosen and is gone or has no email: the office is shown it.
    problem: r.billingContactKind === 'family' && !clean(r.memberEmail)
      ? (r.memberName ? `${r.memberName} has no email address.` : 'The family member chosen is no longer on file.')
      : r.billingContactKind && !set ? 'No email address to send to.' : null,
  }
}

/** One client's billing contact, with the family members that may be chosen. Null: not this company's client. */
export async function billingContactOfClient(q: Q, companyId: string, clientId: string) {
  const r = await contactRow(q, companyId, clientId)
  if (!r) return null
  const members = camelRows(await q.execute(sql`
    SELECT id, name, relationship, email FROM family_members
     WHERE company_id = ${companyId} AND client_id = ${clientId} AND is_active ORDER BY is_primary_contact DESC, name`))
  return { ...shape(r), familyMembers: members }
}

export interface BillingContactInput { kind: BillingKind | null; familyMemberId?: string | null; name?: string | null; emails?: string[] }

/**
 * Check what the office typed. Returns the values to store, or the problem in words. `clientEmail` and `memberEmail` are the
 * address that comes first, so the five-address limit counts it.
 */
export function checkBillingContact(b: any, first: { clientEmail?: string | null; memberEmail?: string | null } = {}):
  { value: { kind: BillingKind | null; familyMemberId: string | null; name: string | null; emails: string[] } } | { problem: string; field: string } {
  const kind = b?.kind == null || b.kind === '' ? null : String(b.kind)
  if (kind !== null && !BILLING_KINDS.includes(kind as BillingKind)) return { problem: 'Choose who pays: the client, a family member or someone else.', field: 'kind' }
  if (kind === null) return { value: { kind: null, familyMemberId: null, name: null, emails: [] } }
  const rawEmails: unknown[] = Array.isArray(b?.emails) ? b.emails : typeof b?.emails === 'string' ? b.emails.split(/[,;\s]+/) : []
  const emails = uniqueEmails(rawEmails)
  const bad = emails.find((e) => !EMAIL_RE.test(e))
  if (bad) return { problem: `"${bad}" is not an email address.`, field: 'emails' }
  const lead = kind === 'client' ? clean(first.clientEmail) : kind === 'family' ? clean(first.memberEmail) : ''
  const extras = emails.filter((e) => e.toLowerCase() !== lead.toLowerCase())
  const room = MAX_BILLING_EMAILS - (lead ? 1 : 0)
  if (extras.length > room) return { problem: `At most ${MAX_BILLING_EMAILS} addresses in all${lead ? ` — ${lead} is already one of them` : ''}.`, field: 'emails' }
  const name = clean(b?.name).slice(0, 200) || null
  if (kind === 'family' && !clean(b?.familyMemberId)) return { problem: 'Choose the family member who pays.', field: 'familyMemberId' }
  if (kind === 'other' && !name) return { problem: 'Type the name of the person who pays.', field: 'name' }
  if (kind === 'other' && !extras.length) return { problem: 'Add at least one email address for them.', field: 'emails' }
  return { value: { kind: kind as BillingKind, familyMemberId: kind === 'family' ? clean(b.familyMemberId) : null, name: kind === 'other' ? name : null, emails: extras } }
}

/** A family member of this client (active), with their email; null when not. */
export async function familyMemberOf(q: Q, companyId: string, clientId: string, memberId: string): Promise<{ id: string; name: string; email: string | null } | null> {
  return (camelFirst(await q.execute(sql`
    SELECT id, name, email FROM family_members WHERE id = ${memberId} AND client_id = ${clientId} AND company_id = ${companyId} AND is_active`)) as any) ?? null
}

/** Store one client's billing contact (already checked). */
export async function saveBillingContact(q: Q, companyId: string, clientId: string, v: { kind: BillingKind | null; familyMemberId: string | null; name: string | null; emails: string[] }): Promise<boolean> {
  const rows = await q.execute(sql`
    UPDATE clients SET billing_contact_kind = ${v.kind}, billing_family_member_id = ${v.familyMemberId}, billing_contact_name = ${v.name},
           billing_emails = ${JSON.stringify(v.emails)}::json, updated_at = NOW()
     WHERE id = ${clientId} AND company_id = ${companyId} RETURNING id`)
  return rowsOf(rows).length > 0
}

/** The clients' own emails (portal, else their own), for checking a bulk change against each one's limit. */
export async function clientEmailsOf(q: Q, companyId: string, clientIds: string[]): Promise<Map<string, string | null>> {
  if (!clientIds.length) return new Map()
  const rows = camelRows(await q.execute(sql`
    SELECT id, COALESCE(NULLIF(TRIM(portal_email), ''), NULLIF(TRIM(email), '')) AS client_email FROM clients
     WHERE company_id = ${companyId} AND id IN (${sql.join(clientIds.map((id) => sql`${id}`), sql`, `)})`)) as Array<{ id: string; clientEmail: string | null }>
  return new Map(rows.map((r) => [r.id, r.clientEmail]))
}
