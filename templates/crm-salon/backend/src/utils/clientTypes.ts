// Who counts as a client of this salon, answered once.
//
// Salon T20 M2 — GET /api/clients returned all 74 contacts, 8 of them type "lead". The Clients page
// ("Everyone who sits in your chairs") listed them, and the dashboard tile read "Clients 74 — In your
// book" while counting every contact row there was, vendors included. Meanwhile /api/contacts/stats
// reported the split correctly — 8 leads, 66 clients — and the Contacts page showed a Lead badge. So
// the number the owner is most likely to quote was the wrong one of the two the product already had.
//
// A lead has not sat in a chair yet. They belong on Contacts, where they are labelled, and they become
// a client the moment they are converted — POST /api/contacts/:id/convert already sets type 'client'.
// A vendor is not a customer at all.
import { and, eq, notInArray, sql } from 'drizzle-orm'
import { contact } from '../../db/schema.ts'

/**
 * Contact types that are NOT a client of the salon.
 *
 * "other" joined this list in T28. It is not a type the product offers — Clients, Leads and Suppliers
 * are the three on the Contacts form — it only exists on rows a pre-validation CSV import let through.
 * Those rows were counted as clients by the Clients page and NOT counted by /api/contacts/stats, which
 * counts by literal type, so the two figures differed by exactly one (88 against 87). Two answers to
 * one question; this is the one that is true, and it needs no data migration to become true. (T28 L2)
 */
export const NON_CLIENT_TYPES = ['lead', 'vendor', 'other'] as const

/** The filter for "a client": everyone who sits in your chairs. */
export const isClient = () => notInArray(contact.type, NON_CLIENT_TYPES as unknown as string[])

/** Every client of this company — the one definition the list and the count share. */
export const clientsOf = (companyId: string) => and(eq(contact.companyId, companyId), isClient())

/** The same rule in raw SQL, for the surfaces that build their own statements. */
export const isClientSql = sql`${contact.type} NOT IN ('lead', 'vendor', 'other')`
