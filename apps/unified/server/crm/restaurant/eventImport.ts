// Import events / spaces / menu packages from CSV (Settings › Import) — the CSV importer had no way to bring in a
// venue's core data (H-02). Moved from templates/crm-restaurant/backend/src/routes/import.ts (venueImport) and
// services/import.ts (importEvents, importSpaces, importMenus); templates/crm-bar has the same. Events go through the
// same rules and the same booking write as the form (#162): validateEventInput and createEvent (eventBooking.ts).
//
// Mounted at /api/import/events, /api/import/spaces and /api/import/menus (index.ts), beside the office import at
// /api/import, which answers their preview and sample CSV (crm/office/importService.ts). Admin and owner only, as the
// template's whole import router was.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, or, ilike, ne } from 'drizzle-orm'
import { contact, event, eventSpace, menuPackage } from '../../db/schema/index.ts'
import { sameText } from '../../data/textMatch.ts'
import { liveSpaceNamed } from '../../data/restaurantEvents.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { uploadedForm } from '../office/upload.ts'
import { parseCSV, normalizeColumns, getValue, parseDecimal, parseDate, importOptionsFrom, skippedDuplicate, type ImportOptions, type ImportResults } from '../office/importService.ts'
import { EVENT_COLUMN_MAP, SPACE_COLUMN_MAP, MENU_COLUMN_MAP } from './eventImportColumns.ts'
import { EVENT_STATUSES, EVENT_TYPES, HELD, SpaceClash, createEvent, findClash, clashMessage, validateEventInput } from './eventBooking.ts'

// The contact form's email rule (z.string().email(), lower-cased) — an imported contact is held to it too. (T16 N1)
const EMAIL = z.string().email()
const cleanEmail = (raw: string | null): { email: string | null; error?: string } => {
  if (!raw) return { email: null }
  const email = raw.toLowerCase().trim()
  return EMAIL.safeParse(email).success ? { email } : { email: null, error: `"${raw}" is not a valid email address.` }
}

// Our statuses plus the words other systems use for them. Anything else is a row error, never a silent "Enquiry".
// (T16 H4)
function mapEventStatus(status: string | null): string | null {
  if (!status) return 'enquiry'
  const s = status.toLowerCase().trim()
  if ((EVENT_STATUSES as readonly string[]).includes(s)) return s
  if (s.includes('confirm') || s.includes('booked') || s.includes('definite')) return 'confirmed'
  if (s.includes('tentative') || s.includes('hold') || s.includes('pencil')) return 'tentative'
  if (s.includes('complete') || s.includes('done')) return 'completed'
  if (s.includes('lost')) return 'lost'
  if (s.includes('cancel')) return 'cancelled'
  if (s.includes('enquir') || s.includes('inquir') || s.includes('prospect') || s.includes('lead')) return 'enquiry'
  return null
}

const emptyResults = (): ImportResults => ({ imported: 0, skipped: 0, errors: [], warnings: [], records: [] })

export function createVenueImportService(d: Pick<CrmDeps, 'db'>) {
  const { db } = d

  async function importEvents(csvContent: string, companyId: string, options: ImportOptions = {}): Promise<ImportResults> {
    const { dryRun = false, createContacts = true, skipDuplicates = true } = options
    const records = parseCSV(csvContent)
    const results = emptyResults()

    for (let i = 0; i < records.length; i++) {
      const row = normalizeColumns(records[i])
      const lineNum = i + 2
      try {
        const name = getValue(row, ...EVENT_COLUMN_MAP.name)
        if (!name) { results.errors.push({ line: lineNum, error: 'Event name is required' }); results.skipped++; continue }
        // The date as written when it is already YYYY-MM-DD (so 2027-02-30 is refused as not a real day instead of
        // being slid to March 2 by Date parsing); other spellings (09/12/2026) are parsed and normalised.
        const rawDate = getValue(row, ...EVENT_COLUMN_MAP.eventDate)
        const parsedDate = rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? parseDate(rawDate) : null
        const eventDateVal = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : parsedDate ? parsedDate.toISOString().slice(0, 10) : null
        if (!eventDateVal) { results.errors.push({ line: lineNum, error: 'Event date is required (YYYY-MM-DD)' }); results.skipped++; continue }
        const rawType = getValue(row, ...EVENT_COLUMN_MAP.eventType)
        if (rawType && !(EVENT_TYPES as readonly string[]).includes(rawType.toLowerCase().trim())) {
          results.errors.push({ line: lineNum, error: `Event type must be one of: ${EVENT_TYPES.join(', ')}` }); results.skipped++; continue
        }
        const status = mapEventStatus(getValue(row, ...EVENT_COLUMN_MAP.status))
        if (!status) { results.errors.push({ line: lineNum, error: `Status must be one of: ${EVENT_STATUSES.join(', ')}.` }); results.skipped++; continue }

        // Resolve (or create) the client contact — as a client, with the contact form's email rule. (T16 N1)
        let contactId: string | null = null
        const contactName = getValue(row, ...EVENT_COLUMN_MAP.contactName)
        const { email: contactEmail, error: emailError } = cleanEmail(getValue(row, ...EVENT_COLUMN_MAP.contactEmail))
        if (emailError) { results.errors.push({ line: lineNum, error: emailError }); results.skipped++; continue }
        if (contactName || contactEmail) {
          const conds = []
          if (contactEmail) conds.push(ilike(contact.email, contactEmail))
          if (contactName) conds.push(eq(contact.name, contactName))
          const [existing] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.companyId, companyId), or(...conds))).limit(1)
          if (existing) contactId = existing.id
          else if (createContacts && !dryRun) {
            const [nc] = await db.insert(contact).values({ companyId, name: contactName || contactEmail!, email: contactEmail, type: 'client', source: 'import' }).returning()
            contactId = nc.id
          }
        }

        // Resolve the space by name (optional). A room the venue doesn't have is a row error. (T16 H4)
        let spaceId: string | null = null
        const spaceName = getValue(row, ...EVENT_COLUMN_MAP.space)
        if (spaceName) {
          const [sp] = await db.select({ id: eventSpace.id }).from(eventSpace).where(and(eq(eventSpace.companyId, companyId), ilike(eventSpace.name, spaceName))).limit(1)
          if (!sp) { results.errors.push({ line: lineNum, error: `Space "${spaceName}" not found — add it under Spaces first, or leave the column blank.` }); results.skipped++; continue }
          spaceId = sp.id
        }

        const guests = getValue(row, ...EVENT_COLUMN_MAP.guestCount)
        const eventData = {
          name,
          eventType: rawType ? rawType.toLowerCase().trim() : 'private_dining',
          status,
          eventDate: eventDateVal,
          startTime: getValue(row, ...EVENT_COLUMN_MAP.startTime),
          endTime: getValue(row, ...EVENT_COLUMN_MAP.endTime),
          guestCount: guests ? (Number.isFinite(parseInt(guests, 10)) ? parseInt(guests, 10) : null) : null,
          quotedTotal: parseDecimal(getValue(row, ...EVENT_COLUMN_MAP.quotedTotal))?.toString() ?? null,
          depositRequired: parseDecimal(getValue(row, ...EVENT_COLUMN_MAP.depositRequired))?.toString() ?? null,
          dietaryRequirements: getValue(row, ...EVENT_COLUMN_MAP.dietaryRequirements),
          notes: getValue(row, ...EVENT_COLUMN_MAP.notes),
          contactId,
          spaceId,
        }

        // The form's rules, row by row: never a silent fix-up or a saved impossibility. (T15 H4)
        const vErr = validateEventInput(eventData)
        if (vErr) { results.errors.push({ line: lineNum, error: vErr }); results.skipped++; continue }

        // The same event on the same day is already booked (a cancelled one is history, not a booking).
        if (skipDuplicates) {
          const [dupe] = await db.select({ id: event.id }).from(event)
            .where(and(eq(event.companyId, companyId), sameText(event.name, name), eq(event.eventDate, eventDateVal), ne(event.status, 'cancelled'))).limit(1)
          if (dupe) { skippedDuplicate(results, lineNum, dupe.id, name); continue }
        }

        if (!dryRun) {
          // The booking write the form uses; a held room is a row error, the other rows still import. (T15 B1)
          let created: any
          try {
            created = await db.transaction((tx: any) => createEvent(tx, companyId, eventData))
          } catch (e: unknown) {
            if (e instanceof SpaceClash) { results.errors.push({ line: lineNum, error: e.message }); results.skipped++; continue }
            throw e
          }
          results.records.push({ line: lineNum, id: created.id, name: created.name })
        } else {
          // preview: report a room that is already held, without taking the lock
          if (spaceId && HELD.includes(eventData.status)) {
            const held = await findClash(db, companyId, spaceId, eventDateVal)
            if (held) { results.errors.push({ line: lineNum, error: clashMessage(eventDateVal, held) }); results.skipped++; continue }
          }
          results.records.push({ line: lineNum, data: { ...eventData, companyId } })
        }
        results.imported++
      } catch (error: any) {
        results.errors.push({ line: lineNum, error: error.message }); results.skipped++
      }
    }
    return results
  }

  async function importSpaces(csvContent: string, companyId: string, options: ImportOptions = {}): Promise<ImportResults> {
    const { dryRun = false, skipDuplicates = true } = options
    const records = parseCSV(csvContent)
    const results = emptyResults()
    for (let i = 0; i < records.length; i++) {
      const row = normalizeColumns(records[i])
      const lineNum = i + 2
      try {
        const name = getValue(row, ...SPACE_COLUMN_MAP.name)
        if (!name) { results.errors.push({ line: lineNum, error: 'Space name is required' }); results.skipped++; continue }
        const seated = getValue(row, ...SPACE_COLUMN_MAP.seatedCapacity)
        const standing = getValue(row, ...SPACE_COLUMN_MAP.standingCapacity)
        const spaceData = {
          companyId,
          name,
          description: getValue(row, ...SPACE_COLUMN_MAP.description),
          seatedCapacity: seated ? parseInt(seated, 10) || null : null,
          standingCapacity: standing ? parseInt(standing, 10) || null : null,
          minimumSpend: parseDecimal(getValue(row, ...SPACE_COLUMN_MAP.minimumSpend))?.toString() ?? null,
          hireFee: parseDecimal(getValue(row, ...SPACE_COLUMN_MAP.hireFee))?.toString() ?? null,
        }
        // Same rule as POST /event-spaces — capacities and money can't be negative.
        const negative = ([['seatedCapacity', 'Seated capacity'], ['standingCapacity', 'Standing capacity'], ['minimumSpend', 'Minimum spend'], ['hireFee', 'Hire fee']] as const)
          .find(([k]) => spaceData[k] !== null && Number(spaceData[k]) < 0)
        if (negative) { results.errors.push({ line: lineNum, error: `${negative[1]} cannot be negative` }); results.skipped++; continue }
        // The form's rule (eventSpaces.ts): one live room per name. Skipped when it's the same room, refused otherwise.
        const taken = await liveSpaceNamed(db, companyId, name.trim())
        if (taken) {
          if (skipDuplicates) skippedDuplicate(results, lineNum, taken.id, name)
          else { results.errors.push({ line: lineNum, error: `A space named "${taken.name}" already exists.` }); results.skipped++ }
          continue
        }
        if (!dryRun) {
          const [created] = await db.insert(eventSpace).values(spaceData).returning()
          results.records.push({ line: lineNum, id: created.id, name: created.name })
        } else {
          results.records.push({ line: lineNum, data: spaceData })
        }
        results.imported++
      } catch (error: any) {
        results.errors.push({ line: lineNum, error: error.message }); results.skipped++
      }
    }
    return results
  }

  async function importMenus(csvContent: string, companyId: string, options: ImportOptions = {}): Promise<ImportResults> {
    const { dryRun = false, skipDuplicates = true } = options
    const records = parseCSV(csvContent)
    const results = emptyResults()
    for (let i = 0; i < records.length; i++) {
      const row = normalizeColumns(records[i])
      const lineNum = i + 2
      try {
        const name = getValue(row, ...MENU_COLUMN_MAP.name)
        if (!name) { results.errors.push({ line: lineNum, error: 'Package name is required' }); results.skipped++; continue }
        const minG = getValue(row, ...MENU_COLUMN_MAP.minGuests)
        const menuData = {
          companyId,
          name,
          description: getValue(row, ...MENU_COLUMN_MAP.description),
          category: getValue(row, ...MENU_COLUMN_MAP.category) || 'dinner',
          pricePerPerson: parseDecimal(getValue(row, ...MENU_COLUMN_MAP.pricePerPerson))?.toString() ?? null,
          minGuests: minG ? parseInt(minG, 10) || null : null,
          dietaryNotes: getValue(row, ...MENU_COLUMN_MAP.dietaryNotes),
        }
        // Same rule as POST /menu-packages — price and minimum can't be negative.
        const negative = ([['pricePerPerson', 'Price per person'], ['minGuests', 'Minimum guests']] as const)
          .find(([k]) => menuData[k] !== null && Number(menuData[k]) < 0)
        if (negative) { results.errors.push({ line: lineNum, error: `${negative[1]} cannot be negative` }); results.skipped++; continue }
        if (skipDuplicates) {
          const [dupe] = await db.select({ id: menuPackage.id }).from(menuPackage).where(and(eq(menuPackage.companyId, companyId), sameText(menuPackage.name, name))).limit(1)
          if (dupe) { skippedDuplicate(results, lineNum, dupe.id, name); continue }
        }
        if (!dryRun) {
          const [created] = await db.insert(menuPackage).values(menuData).returning()
          results.records.push({ line: lineNum, id: created.id, name: created.name })
        } else {
          results.records.push({ line: lineNum, data: menuData })
        }
        results.imported++
      } catch (error: any) {
        results.errors.push({ line: lineNum, error: error.message }); results.skipped++
      }
    }
    return results
  }

  return { importEvents, importSpaces, importMenus }
}

type VenueKind = 'events' | 'spaces' | 'menus'
const HANDLER = { events: 'importEvents', spaces: 'importSpaces', menus: 'importMenus' } as const

/** POST / for one of the three kinds: the uploaded CSV, imported. */
export function createVenueImportRoutes(d: CrmDeps, kind: VenueKind) {
  const service = createVenueImportService(d)
  const app = new Hono<AppEnv>()
  app.use('*', d.permissions.requireRole('admin', 'owner'))
  app.post('/', async (c) => {
    const user = c.get('user') as any
    const formData = await uploadedForm(c)
    const file = formData.get('file') as File | null
    if (!file) return fail(c, 400, 'No file uploaded')
    const results = await service[HANDLER[kind]](await file.text(), user.companyId, importOptionsFrom(formData))
    d.audit.log({ req: c, action: 'IMPORT', entity: kind, metadata: { imported: results.imported, skipped: results.skipped }, userId: user.userId, companyId: user.companyId })
    return one(c, results)
  })
  return app
}
