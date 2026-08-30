import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { vaccination, patient, contact, visit, company, user } from '../../db/schema.ts'
import { eq, and, lte, isNotNull, inArray, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { sendSMS } from '../services/sms.ts'

/**
 * Reminder / recall engine — the retention wedge.
 *   GET  /reminders/due       preventive-care vaccinations overdue or due soon
 *   GET  /reminders/lapsed    clients whose last visit is older than N months
 *   POST /reminders/send      bulk SMS reminder/reactivation to selected owners
 *   GET  /reminders/rabies/:vaccinationId  printable rabies certificate (HTML)
 */

const app = new Hono()
app.use('*', authenticate)

const todayStr = () => new Date().toISOString().slice(0, 10)

// GET /reminders/due?window=30 — latest administration per pet+vaccine whose due date is within `window` days (or past).
app.get('/due', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user') as any
  const windowDays = Math.min(365, Math.max(1, +(c.req.query('window') || '30')))
  const cutoff = new Date(Date.now() + windowDays * 86400000).toISOString().slice(0, 10)

  const rows = await db.select({
    vaccinationId: vaccination.id, vaccine: vaccination.vaccine, givenDate: vaccination.givenDate, dueDate: vaccination.dueDate, isRabies: vaccination.isRabies,
    patientId: patient.id, patientName: patient.name, species: patient.species, deceased: patient.deceased,
    ownerId: contact.id, ownerName: contact.name, ownerEmail: contact.email, ownerPhone: contact.phone, ownerMobile: contact.mobile,
  })
    .from(vaccination)
    .leftJoin(patient, eq(vaccination.patientId, patient.id))
    .leftJoin(contact, eq(patient.ownerId, contact.id))
    .where(and(eq(vaccination.companyId, u.companyId), isNotNull(vaccination.dueDate)))

  // Keep only the most recent administration per (patient, vaccine) so a renewed
  // vaccine doesn't keep nagging on the old due date.
  const latest = new Map<string, any>()
  for (const r of rows) {
    if (r.deceased) continue
    const key = r.patientId + '|' + (r.vaccine || '').toLowerCase()
    const cur = latest.get(key)
    if (!cur || (r.givenDate || '') > (cur.givenDate || '')) latest.set(key, r)
  }
  const t = todayStr()
  const data = [...latest.values()]
    .filter(r => (r.dueDate || '') <= cutoff)
    .map(r => ({ ...r, overdue: (r.dueDate || '') < t }))
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))

  return c.json({ count: data.length, overdue: data.filter(d => d.overdue).length, data })
})

// GET /reminders/lapsed?months=12 — active patients whose last visit is older than N months (or never).
app.get('/lapsed', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user') as any
  const months = Math.min(60, Math.max(1, +(c.req.query('months') || '12')))
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffIso = cutoff.toISOString()

  const rows = await db.select({
    patientId: patient.id, patientName: patient.name, species: patient.species,
    ownerId: contact.id, ownerName: contact.name, ownerEmail: contact.email, ownerPhone: contact.phone, ownerMobile: contact.mobile,
    lastVisit: sql<string | null>`max(${visit.visitDate})`,
  })
    .from(patient)
    .leftJoin(visit, eq(visit.patientId, patient.id))
    .leftJoin(contact, eq(patient.ownerId, contact.id))
    .where(and(eq(patient.companyId, u.companyId), eq(patient.deceased, false)))
    .groupBy(patient.id, contact.id)
    // Lapsed = hasn't been in for N months. That's either "last visit older than the
    // cutoff" OR "never visited AND registered before the cutoff" — a pet who registered
    // long ago and never came is a win-back; one registered days ago is just new, not
    // lapsed. (Earlier this dropped ALL never-visited, which was an over-correction.) (VET-17/VET-12)
    .having(sql`max(${visit.visitDate}) < ${cutoffIso} OR (max(${visit.visitDate}) IS NULL AND min(${patient.createdAt}) < ${cutoffIso})`)

  return c.json({ count: rows.length, months, data: rows })
})

// POST /reminders/send  { contactIds: string[], message: string } — bulk SMS.
app.post('/send', requirePermission('contacts:update'), async (c) => {
  const u = c.get('user') as any
  const body = await c.req.json()
  const contactIds: string[] = Array.isArray(body.contactIds) ? body.contactIds.filter(Boolean) : []
  const message: string = (body.message || '').trim()
  if (!contactIds.length || !message) return c.json({ error: 'contactIds and message are required' }, 400)

  const owners = await db.select().from(contact).where(and(eq(contact.companyId, u.companyId), inArray(contact.id, contactIds)))
  let sent = 0
  const failures: string[] = []
  for (const ct of owners) {
    const to = (ct as any).mobile || ct.phone
    if (!to) { failures.push(ct.id); continue }
    try {
      await sendSMS(u.companyId, { contactId: ct.id, toPhone: to, message, userId: u.userId })
      sent++
    } catch { failures.push(ct.id) }
  }
  return c.json({ sent, failed: failures.length, failures })
})

// GET /reminders/rabies/:vaccinationId — printable rabies vaccination certificate (HTML → print to PDF).
app.get('/rabies/:vaccinationId', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user') as any
  const id = c.req.param('vaccinationId')
  const [vax] = await db.select().from(vaccination).where(and(eq(vaccination.id, id), eq(vaccination.companyId, u.companyId))).limit(1)
  if (!vax) return c.json({ error: 'Vaccination not found' }, 404)
  const [pet] = await db.select().from(patient).where(eq(patient.id, vax.patientId)).limit(1)
  const [owner] = pet ? await db.select().from(contact).where(eq(contact.id, pet.ownerId)).limit(1) : [null as any]
  const [clinic] = await db.select().from(company).where(eq(company.id, u.companyId)).limit(1)
  const [vet] = vax.providerId ? await db.select().from(user).where(eq(user.id, vax.providerId)).limit(1) : [null as any]

  const esc = (s: any) => String(s ?? '').replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] as string))
  const age = pet?.dob ? Math.max(0, Math.floor((Date.now() - new Date(pet.dob).getTime()) / (365.25 * 86400000))) + ' yr' : ''
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
  <table>${row('Name', pet?.name || '')}${row('Species', pet?.species || '')}${row('Breed', pet?.breed || '')}${row('Sex', (pet?.sex || '') + (pet?.spayedNeutered ? ' (spayed/neutered)' : ''))}${row('Color / Markings', pet?.color || '')}${row('Age', age)}${row('Microchip', pet?.microchip || '')}</table>
  <h2>Vaccination</h2>
  <table>${row('Vaccine', vax.vaccine || 'Rabies')}${row('Manufacturer', vax.manufacturer || '')}${row('Lot / Serial', [vax.lotNumber, vax.serialNumber].filter(Boolean).join(' / '))}${row('Date Administered', vax.givenDate || '')}${row('Expiration / Due', vax.dueDate || '')}${row('Tag Number', vax.rabiesTag || pet?.rabiesTag || '')}${row('Route / Site', [vax.route, vax.site].filter(Boolean).join(' / '))}</table>
  <div class="sign">
    <div>${esc([vet?.firstName, vet?.lastName].filter(Boolean).join(' ') || '')}<br>Veterinarian</div>
    <div>License #<br>&nbsp;</div>
  </div>
  <p class="note">This certificate reflects the records of ${esc(clinic?.name || 'the practice')}. Rabies certificate format and retention requirements vary by state.</p>
</body></html>`

  return c.html(html)
})

export default app
