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

/** Contact types that are NOT a client of the salon. */
export const NON_CLIENT_TYPES = ['lead', 'vendor'] as const

/** The filter for "a client": everyone who sits in your chairs. */
export const isClient = () => notInArray(contact.type, NON_CLIENT_TYPES as unknown as string[])

/** Every client of this company — the one definition the list and the count share. */
export const clientsOf = (companyId: string) => and(eq(contact.companyId, companyId), isClient())

/** The same rule in raw SQL, for the surfaces that build their own statements. */
export const isClientSql = sql`${contact.type} NOT IN ('lead', 'vendor')`
