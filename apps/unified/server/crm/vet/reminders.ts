// The recall engine — the practice's retention wedge. Moved from templates/crm-vet/backend/src/routes/reminders.ts.
//   GET  /reminders/due        preventive-care vaccinations overdue or due soon
//   GET  /reminders/lapsed     clients whose last visit is older than N months
//   POST /reminders/send       a text to each selected owner, personalised
//   GET  /reminders/rabies/:id a printable rabies certificate (HTML)
// The registry signs the person in and applies the 'reminders_recall' gate (the template's sidebar gate; its index.ts
// mounted it ungated).
import { Hono } from 'hono'
import { eq, and, isNotNull, inArray } from 'drizzle-orm'
import { vaccination, patient, contact, company, user } from '../../db/schema/index.ts'
import { lapsedPatients, stampVaccinationsReminded } from '../../data/vetReminders.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { z } from 'zod'
import { companyTimeZone, storeDateString } from '@twomiah/tenant-backend'
import { invalid } from '../../http/errors.ts'
import { vetReminderSettings, DEFAULT_VET_MESSAGE, QUIET_BEFORE, QUIET_FROM } from './vaccineReminders.ts'

// The clinic's today (UTC's was a day ahead every evening).
const todayStr = async (db: any, companyId: string) => storeDateString(new Date(), await companyTimeZone(db, companyId))

/** A reminder sent inside this many days counts as "already chased". (Vet T12 M9) */
const REMINDED_RECENTLY_DAYS = 7

/**
 * Merge fields for a recall message, so "your pet is due for care" becomes "Luna's Rabies is due October 3rd". A
 * field with nothing behind it falls back to wording that still reads as a sentence. (Vet T12 L7)
 */
const MERGE_FALLBACKS: Record<string, string> = { pet_name: 'your pet', vaccine: 'care', due_date: 'soon', owner_name: 'there', clinic_name: 'your veterinary team' }
export function mergeReminder(template: string, values: Record<string, string | undefined>): string {
  return String(template ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => {
    const k = key.toLowerCase()
    const v = (values[k] || '').trim()
    if (v) return v
    return k in MERGE_FALLBACKS ? MERGE_FALLBACKS[k] : whole
  })
}

/** "Luna" / "Luna and Max" / "Luna, Max and Pip" — a list a person would say out loud. */
export function listPhrase(items: string[]): string {
  const seen = [...new Set(items.filter(Boolean))]
  if (seen.length <= 1) return seen[0] || ''
  if (seen.length === 2) return `${seen[0]} and ${seen[1]}`
  return `${seen.slice(0, -1).join(', ')} and ${seen[seen.length - 1]}`
}

export const prettyDate = (d: unknown) => {
  const s = String(d ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  const [y, m, day] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' })
}

/**
 * The age on a certificate is the age at the date administered, in whole calendar months under two years (T41): a
 * reprint must not age the animal, and "0 yr" is what a puppy's first certificate used to say.
 */
const ageAt = (dob: unknown, at: unknown): string => {
  if (!dob) return ''
  const born = new Date(dob as string)
  const when = at ? new Date(at as string) : new Date()
  if (isNaN(born.getTime()) || isNaN(when.getTime()) || when.getTime() < born.getTime()) return ''
  let months = (when.getUTCFullYear() - born.getUTCFullYear()) * 12 + (when.getUTCMonth() - born.getUTCMonth())
  if (when.getUTCDate() < born.getUTCDate()) months--
  if (months < 1) return '< 1 mo'
  return months < 24 ? `${months} mo` : `${Math.floor(months / 12)} yr`
}

export function createReminderRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  // The printable rabies certificate is the rabies_certificates switch's (Settings › Features): off, it is refused, as the
  // chart's Rabies Certificate button is gone (live retest 2026-10-22: the switch hid nothing).
  app.use('/rabies/*', d.features.requireEnabledFeature('rabies_certificates'))

  // GET /reminders/due?window=30 — the latest administration per pet+vaccine whose due date is within `window` days
  // (or past). A report: its counts beside its rows, as the template answered.
  app.get('/due', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const windowDays = Math.min(365, Math.max(1, +(c.req.query('window') || '30')))
    // The window ends `windowDays` after the CLINIC's today (UTC's ran a day ahead every evening).
    const today = await todayStr(db, u.companyId)
    const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + windowDays)
    const cutoff = end.toISOString().slice(0, 10)

    const rows = await db.select({
      vaccinationId: vaccination.id, vaccine: vaccination.vaccine, givenDate: vaccination.givenDate, dueDate: vaccination.dueDate, isRabies: vaccination.isRabies,
      lastRemindedAt: vaccination.lastRemindedAt, reminderCount: vaccination.reminderCount,
      patientId: patient.id, patientName: patient.name, species: patient.species, deceased: patient.deceased,
      ownerId: contact.id, ownerName: contact.name, ownerEmail: contact.email, ownerPhone: contact.phone, ownerMobile: contact.mobile,
    })
      .from(vaccination)
      .leftJoin(patient, eq(vaccination.patientId, patient.id))
      .leftJoin(contact, eq(patient.ownerId, contact.id))
      .where(and(eq(vaccination.companyId, u.companyId), isNotNull(vaccination.dueDate)))

    // Only the most recent administration per (patient, vaccine), so a renewed vaccine doesn't nag on the old date.
    const latest = new Map<string, any>()
    for (const r of rows) {
      if (r.deceased) continue
      const key = r.patientId + '|' + (r.vaccine || '').toLowerCase()
      const cur = latest.get(key)
      if (!cur || (r.givenDate || '') > (cur.givenDate || '')) latest.set(key, r)
    }
    const t = today
    const recentCutoff = Date.now() - REMINDED_RECENTLY_DAYS * 86400000
    const data = [...latest.values()]
      .filter((r) => (r.dueDate || '') <= cutoff)
      .map((r) => ({ ...r, overdue: (r.dueDate || '') < t, remindedRecently: !!r.lastRemindedAt && new Date(r.lastRemindedAt).getTime() >= recentCutoff }))
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))

    return one(c, {
      count: data.length,
      overdue: data.filter((x) => x.overdue).length,
      remindedRecently: data.filter((x) => x.remindedRecently).length,
      remindedWithinDays: REMINDED_RECENTLY_DAYS,
      data,
    })
  })

  // GET /reminders/lapsed?months=12 — living patients whose last visit is older than N months (or never). A report,
  // as the template answered.
  app.get('/lapsed', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const months = Math.min(60, Math.max(1, +(c.req.query('months') || '12')))
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months)
    const rows = await lapsedPatients(db, u.companyId, cutoff.toISOString())
    return one(c, { count: rows.length, months, data: rows })
  })

  // POST /reminders/send { contactIds, message, vaccinationIds? } — a text to each owner.
  app.post('/send', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user') as any
    const body = await c.req.json()
    const contactIds: string[] = Array.isArray(body.contactIds) ? body.contactIds.filter(Boolean) : []
    const message: string = (body.message || '').trim()
    if (!contactIds.length || !message) return fail(c, 400, 'contactIds and message are required')

    // Which due shots this send is about, so the stamp lands on the thing being chased. The win-back tab sends none.
    const vaccinationIds: string[] = Array.isArray(body.vaccinationIds) ? body.vaccinationIds.filter(Boolean) : []
    const owners = await db.select().from(contact).where(and(eq(contact.companyId, u.companyId), inArray(contact.id, contactIds)))

    // What each owner's message is about — everything here is already on screen in the due list. (Vet T12 L7)
    const perOwner = new Map<string, { pets: string[]; vaccines: string[]; due: string[] }>()
    if (vaccinationIds.length) {
      const rows = await db.select({ ownerId: patient.ownerId, petName: patient.name, vaccine: vaccination.vaccine, dueDate: vaccination.dueDate })
        .from(vaccination)
        .leftJoin(patient, eq(vaccination.patientId, patient.id))
        .where(and(eq(vaccination.companyId, u.companyId), inArray(vaccination.id, vaccinationIds)))
      for (const r of rows) {
        if (!r.ownerId) continue
        const bucket = perOwner.get(r.ownerId) || { pets: [], vaccines: [], due: [] }
        if (r.petName) bucket.pets.push(r.petName)
        if (r.vaccine) bucket.vaccines.push(r.vaccine)
        const day = prettyDate(r.dueDate)
        if (day) bucket.due.push(day)
        perOwner.set(r.ownerId, bucket)
      }
    }
    const [clinic] = await db.select({ name: company.name }).from(company).where(eq(company.id, u.companyId)).limit(1)

    let sent = 0
    const failures: string[] = []
    const reached: string[] = []
    // Why nothing went out, when the reason is the same for everybody (an empty usage wallet, say).
    let blockedReason = ''
    // An owner who texted STOP is not texted, by hand or automatically (contact.optedOutSms).
    let optedOut = 0
    for (const ct of owners) {
      if ((ct as any).optedOutSms) { failures.push(ct.id); optedOut++; continue }
      const to = (ct as any).mobile || ct.phone
      if (!to) { failures.push(ct.id); continue }
      const b = perOwner.get(ct.id)
      const personalised = mergeReminder(message, {
        owner_name: String(ct.name || '').split(' ')[0],
        pet_name: listPhrase(b?.pets || []),
        vaccine: listPhrase(b?.vaccines || []),
        due_date: (b?.due || [])[0] || '',
        clinic_name: clinic?.name || '',
      })
      try {
        // sendSMS REFUSES rather than throws when the usage wallet is empty, and returns a 'failed' row when the
        // carrier rejects the number: neither is counted as sent or stamped. (T24 M9)
        const result: any = await d.services.sms.sendSMS(u.companyId, { contactId: ct.id, toPhone: to, message: personalised, userId: u.userId })
        if (result?.refused || result?.status === 'failed') {
          failures.push(ct.id)
          if (result?.errorMessage && !blockedReason) blockedReason = String(result.errorMessage)
          continue
        }
        sent++
        reached.push(ct.id)
      } catch (err: any) {
        failures.push(ct.id)
        if (err?.message && !blockedReason) blockedReason = String(err.message)
      }
    }

    // Only what actually went out is stamped — a reminder nobody received is not a reminder. (T12 M9)
    const now = new Date()
    let stamped = 0
    if (reached.length) {
      await db.update(contact).set({ lastRemindedAt: now, updatedAt: now })
        .where(and(eq(contact.companyId, u.companyId), inArray(contact.id, reached)))
      if (vaccinationIds.length) {
        // A shot only counts as chased if ITS owner was one of the people actually texted.
        const toStamp = await db.select({ id: vaccination.id })
          .from(vaccination)
          .leftJoin(patient, eq(vaccination.patientId, patient.id))
          .where(and(eq(vaccination.companyId, u.companyId), inArray(vaccination.id, vaccinationIds), inArray(patient.ownerId, reached)))
        if (toStamp.length) {
          await stampVaccinationsReminded(db, u.companyId, toStamp.map((r: any) => r.id), now)
          stamped = toStamp.length
        }
      }
    }
    // The outcome of a send, as the template answered it: `error` carries the shared reason when nothing went out,
    // which the page shows instead of a bare "0 sent".
    return one(c, {
      sent, failed: failures.length, failures, optedOut,
      remindersRecorded: stamped,
      remindedAt: reached.length ? now.toISOString() : null,
      ...(sent === 0 && blockedReason ? { error: blockedReason } : sent === 0 && optedOut === owners.length && optedOut > 0 ? { error: optedOut === 1 ? 'That owner asked not to be texted (they replied STOP).' : 'Those owners asked not to be texted (they replied STOP).' } : {}),
    })
  })

  // GET/PUT /reminders/settings — automatic vaccine reminders (./vaccineReminders.ts): the clinic's switch, how many days
  // ahead of the due date, and the words. Reading is anyone who reads the list; changing it is a company setting.
  const settingsView = (settings: unknown) => ({ ...vetReminderSettings(settings), defaultMessage: DEFAULT_VET_MESSAGE, sendsBetween: [QUIET_BEFORE, QUIET_FROM] })
  app.get('/settings', requirePermission('contacts:read'), async (c) => {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, c.get('user').companyId)).limit(1)
    return one(c, settingsView(co?.settings))
  })
  const settingsSchema = z.object({
    auto: z.boolean(),
    leadDays: z.number({ error: 'Enter a whole number of days' }).int('Enter a whole number of days').min(1, 'At least 1 day ahead').max(90, 'At most 90 days ahead'),
    message: z.string().trim().min(1, 'Write the text owners receive').max(480, 'Keep the text under 480 characters'),
  })
  app.put('/settings', requirePermission('company:update'), async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const settings: any = (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
    const before = vetReminderSettings(settings)
    const next = vetReminderSettings({ vetReminders: parsed.data })
    await db.update(company).set({ settings: { ...settings, vetReminders: next }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    d.audit.log({ action: d.audit.ACTIONS.UPDATE, entity: 'company', entityId: companyId, metadata: { vetReminders: { before, after: next } }, req: c })
    return one(c, settingsView({ vetReminders: next }))
  })

  // GET /reminders/rabies/:vaccinationId — a printable rabies vaccination certificate (HTML → print to PDF).
  app.get('/rabies/:vaccinationId', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const id = c.req.param('vaccinationId')
    const [vax] = await db.select().from(vaccination).where(and(eq(vaccination.id, id), eq(vaccination.companyId, u.companyId))).limit(1)
    if (!vax) return fail(c, 404, 'Vaccination not found')

    /**
     * A RABIES CERTIFICATE IS ONLY A RABIES CERTIFICATE (T51): accepted when the record says it is rabies — the flag,
     * or a vaccine named rabies (a row written before the flag existed). The template's refusal also carried the
     * vaccine's name as a field; it is in the sentence.
     */
    const looksRabies = vax.isRabies === true || /rabies/i.test(String(vax.vaccine || ''))
    if (!looksRabies) {
      return fail(c, 400, `${vax.vaccine || 'That vaccination'} is not a rabies vaccination, so it cannot be issued as a rabies certificate. Mark the record as rabies if that is what it is.`, 'NOT_A_RABIES_VACCINATION')
    }
    const [pet] = await db.select().from(patient).where(eq(patient.id, vax.patientId)).limit(1)
    const [owner] = pet ? await db.select().from(contact).where(eq(contact.id, pet.ownerId)).limit(1) : [null as any]
    const [clinic] = await db.select().from(company).where(eq(company.id, u.companyId)).limit(1)
    const [vet] = vax.providerId ? await db.select().from(user).where(eq(user.id, vax.providerId)).limit(1) : [null as any]

    const esc = (s: unknown) => String(s ?? '').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] as string))
    // Title-case enum values ("dog"/"male") — a legal document, not a database dump. (VET-28)
    const cap = (s: unknown) => String(s ?? '').replace(/\b\w/g, (ch: string) => ch.toUpperCase())
    const age = ageAt(pet?.dob, vax.givenDate)
    const row = (label: string, val: string) => `<tr><td class="l">${label}</td><td class="v">${esc(val)}</td></tr>`

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rabies Certificate — ${esc(pet?.name || '')}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;max-width:720px;margin:32px auto;padding:0 24px;}
  .head{text-align:center;border-bottom:3px double #1a1a1a;padding-bottom:12px;margin-bottom:20px;}
  .head h1{margin:0;font-size:22px;letter-spacing:.04em;text-transform:uppercase;}
  .head p{margin:4px 0 0;font-size:13px;color:#555;}
  h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:#333;border-bottom:1px solid #ccc;padding-bottom:4px;margin:22px 0 8px;}
  table{width:100%;border-collapse:collapse;font-size:14px;}
  td.l{width:38%;color:#666;padding:5px 8px 5px 0;vertical-align:top;}
  td.v{font-weight:600;padding:5px 0;}
  .sign{margin-top:40px;display:flex;justify-content:space-between;gap:24px;}
  .sign div{flex:1;border-top:1px solid #1a1a1a;padding-top:6px;font-size:12px;color:#555;text-align:center;}
  .note{margin-top:28px;font-size:11px;color:#888;text-align:center;}
  @media print{body{margin:0;}}
</style></head><body onload="window.print && setTimeout(()=>{},0)">
  <div class="head">
    <h1>Rabies Vaccination Certificate</h1>
    <p>${esc(clinic?.name || '')}${clinic?.address ? ' · ' + esc(clinic.address) : ''}${clinic?.city ? ', ' + esc(clinic.city) : ''}${clinic?.state ? ' ' + esc(clinic.state) : ''}${clinic?.phone ? ' · ' + esc(clinic.phone) : ''}</p>
  </div>
  <h2>Owner</h2>
  <table>${row('Name', owner?.name || '')}${row('Address', [owner?.address, owner?.city, owner?.state, owner?.zip].filter(Boolean).join(', '))}${row('Phone', owner?.mobile || owner?.phone || '')}</table>
  <h2>Animal</h2>
  <table>${row('Name', pet?.name || '')}${row('Species', cap(pet?.species || ''))}${row('Breed', cap(pet?.breed || ''))}${row('Sex', cap(pet?.sex || '') + (pet?.spayedNeutered ? ' (spayed/neutered)' : ''))}${row('Color / Markings', pet?.color || '')}${row('Age at vaccination', age)}${row('Microchip', pet?.microchip || '')}</table>
  <h2>Vaccination</h2>
  <table>${row('Vaccine', vax.vaccine || 'Rabies')}${row('Manufacturer', vax.manufacturer || '')}${row('Lot / Serial', [vax.lotNumber, vax.serialNumber].filter(Boolean).join(' / '))}${row('Date Administered', vax.givenDate || '')}${row('Expiration / Due', vax.dueDate || '')}${row('Tag Number', vax.rabiesTag || pet?.rabiesTag || '')}${row('Route / Site', [vax.route, vax.site].filter(Boolean).join(' / '))}</table>
  <div class="sign">
    <div>${esc([vet?.firstName, vet?.lastName].filter(Boolean).join(' ') || '')}<br>Veterinarian</div>
    <div>${esc(clinic?.licenseNumber || '')}<br>License #</div>
  </div>
  <p class="note">This certificate reflects the records of ${esc(clinic?.name || 'the practice')}. Rabies certificate format and retention requirements vary by state.</p>
</body></html>`

    return c.html(html)
  })

  return app
}
