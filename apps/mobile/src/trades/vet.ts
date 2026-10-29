/**
 * THE VET PRACTICE — built, tested, and kept OFF (VET_PHONE_ON in vertical/verticals.ts): the vet stays closed for signups and out of
 * the store app, and the website tells vets to use the website. A tech writes only four things on the phone: a vaccine given, a weight,
 * an appointment's status, and texts to owners.
 *
 * Words the screens keep to: the practice's own text (alerts, allergies) is shown first and unabridged, never computed or softened; no
 * medical icons; nothing says "safe", "normal" or "up to date"; a vaccine's next-due date is typed by the person, never defaulted;
 * nothing deletes. A recall text names the owners and the message, and asks first.
 */
import type { TileDef } from '../home/tiles'
import { type ScreenSpec, type Row, words, join, clock, calDay, dayOnly } from './kit'

const STATS = '/api/dashboard/stats'
const paged = (b: any): number => Number(b?.pagination?.total ?? b?.count ?? (Array.isArray(b?.data) ? b.data.length : Array.isArray(b) ? b.length : 0))

export const VET_TILES: TileDef[] = [
  { id: 'appointments-today', label: 'Appointments today', icon: 'calendar', tone: 'accent', any: ['contacts:read'], feature: 'appointment_scheduling', source: STATS, value: (s) => s?.appointments?.today,
    opens: "today's appointments", list: { path: '/api/appointments', query: { tile: 'today' } }, screen: 'trade', spec: 'vet-today', total: paged, banner: 'Appointments today' },
  { id: 'vaccines-overdue', label: 'Vaccines overdue', icon: 'alert-circle', tone: 'danger', any: ['contacts:read'], feature: 'reminders_recall', source: STATS, value: (s) => s?.reminders?.overdue,
    opens: 'the vaccines past their due date', list: { path: '/api/reminders/due', query: { tile: 'overdue' } }, screen: 'trade', spec: 'vet-recall', total: paged, banner: 'Vaccines overdue' },
  { id: 'vaccines-due-30', label: 'Due in 30 days', icon: 'time', tone: 'warning', any: ['contacts:read'], feature: 'reminders_recall', source: STATS, value: (s) => s?.reminders?.dueSoon,
    opens: 'the vaccines due in the next 30 days', list: { path: '/api/reminders/due', query: { tile: 'due_soon' } }, screen: 'trade', spec: 'vet-recall', total: paged, banner: 'Due in 30 days' },
  { id: 'active-patients', label: 'Active patients', icon: 'paw', tone: 'info', any: ['contacts:read'], feature: 'patient_records', source: STATS, value: (s) => s?.patients?.active,
    opens: 'the patients on the books', list: { path: '/api/patients', query: { tile: 'active' } }, screen: 'trade', spec: 'vet-patients', total: paged, banner: 'Active patients' },
]

const APPT_WORDS: Record<string, string> = { scheduled: 'Booked', confirmed: 'Confirmed', checked_in: 'Checked in', in_progress: 'In progress', completed: 'Done', no_show: 'No-show', cancelled: 'Cancelled' }
const TYPE_WORDS: Record<string, string> = { wellness: 'Wellness exam', sick: 'Sick visit', surgery: 'Surgery', dental: 'Dental', recheck: 'Recheck', grooming: 'Grooming', euthanasia: 'Euthanasia' }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const RECALL_TEXT = 'Hi {{owner_name}}, {{pet_name}} has a {{vaccine}} due on {{due_date}}. Please call us to book. — {{clinic_name}}'
const status = (id: string, label: string, icon: string, to: string, from: string[], done: string) => ({
  id, label, icon, any: ['contacts:update'], when: (d: any) => from.includes(d.status), request: (d: any) => ({ method: 'PUT' as const, path: `/api/appointments/${d.id}`, body: { status: to } }), done,
})
const owner = (d: any) => d.owner || { name: d.ownerName, phone: d.ownerPhone, mobile: d.ownerMobile }
const callLinks = (name: string, phone?: string | null) => (phone ? [{ label: `Call ${name || 'owner'} ${phone}`, url: `tel:${phone}`, icon: 'call' }] : [])

export const VET: ScreenSpec[] = [
  {
    id: 'vet-today', title: 'Today', any: ['contacts:read'], feature: 'appointment_scheduling',
    list: { path: '/api/appointments', query: { tile: 'today' } },
    rows: (a) => ({ id: a.id, key: a.id, title: a.patientName || 'Appointment', subtitle: join(a.ownerName, TYPE_WORDS[a.type] || words(a.type)), meta: clock(a.startTime), badge: APPT_WORDS[a.status] || words(a.status), tone: a.status === 'completed' ? 'success' : a.status === 'checked_in' || a.status === 'in_progress' ? 'info' : 'neutral' }),
    empty: { title: 'No appointments today', body: 'Today\'s appointments show here.' },
    detail: {
      path: () => null, title: (d) => d.patientName || 'Appointment', subtitle: (d) => join(clock(d.startTime), TYPE_WORDS[d.type] || words(d.type)), badge: (d) => APPT_WORDS[d.status] || words(d.status),
      sections: [
        { fields: [{ label: 'Owner', get: (d) => d.ownerName }, { label: 'Vet', get: (d) => join(d.providerFirstName, d.providerLastName) }, { label: 'Room', get: (d) => d.room }, { label: 'Reason', get: (d) => d.reason }, { label: 'Notes', get: (d) => d.notes }] },
        { links: (d) => callLinks(d.ownerName, d.ownerPhone) },
      ],
      actions: [
        { id: 'check-in', label: 'Check in', icon: 'log-in', any: ['contacts:update'], when: (d) => ['scheduled', 'confirmed'].includes(d.status), request: (d) => ({ method: 'POST', path: `/api/appointments/${d.id}/check-in` }), done: 'Checked in' },
        status('start', 'Start', 'play', 'in_progress', ['checked_in'], 'Started'),
        status('complete', 'Mark done', 'checkmark-done', 'completed', ['in_progress'], 'Marked done'),
        { ...status('no-show', 'Mark no-show', 'close-circle', 'no_show', ['scheduled', 'confirmed', 'checked_in'], 'Marked no-show'),
          confirm: { title: 'Mark as a no-show?', body: (d) => `${d.patientName || 'This appointment'} is marked as not coming. The owner is not told.`, button: 'Mark no-show' } },
        { id: 'text-owner', label: 'Text the owner', icon: 'chatbubble', any: ['sms:send'], when: (d) => !!(d.ownerPhone), confirm: { title: 'Text the owner', body: (d) => `This sends a text to ${d.ownerName || 'the owner'}. Say only what you would say at the desk.`, button: 'Send text' },
          inputs: [{ id: 'message', label: 'Message', kind: 'multiline', required: true, initial: () => 'We\'re running a few minutes behind.' }],
          request: (d, v) => ({ method: 'POST', path: '/api/sms/send', body: { toPhone: d.ownerPhone, contactId: d.ownerId, message: v.message } }), done: 'Text sent' },
      ],
    },
  },
  {
    id: 'vet-patients', title: 'Patients', any: ['contacts:read'], feature: 'patient_records',
    list: { path: '/api/patients', query: { tile: 'active' } },
    chips: [{ id: 'active', label: 'Active', query: { tile: 'active' } }, { id: 'all', label: 'Everyone', query: {} }],
    search: { param: 'search', placeholder: 'Pet or owner' },
    rows: (p) => ({ id: p.id, key: p.id, title: p.name || 'Patient', subtitle: join(words(p.species), p.breed, p.ownerName), badge: p.deceased ? 'Deceased' : (p.alerts || p.allergies) ? 'Alert' : undefined, tone: p.deceased ? 'neutral' : 'danger' }),
    empty: { title: 'No patients match', body: 'Look a pet up by its name or its owner.' },
    detail: {
      path: (id) => `/api/patients/${id}`, title: (d) => d.patient?.name || 'Patient', subtitle: (d) => join(words(d.patient?.species), d.patient?.breed), badge: (d) => (d.patient?.deceased ? 'Deceased' : undefined),
      sections: [
        { title: 'Medical alert', fields: [{ label: 'Alert', get: (d) => d.patient?.alerts }] },
        { title: 'Allergies', fields: [{ label: 'Allergies', get: (d) => d.patient?.allergies }] },
        { title: 'Patient', fields: [{ label: 'Sex', get: (d) => join(words(d.patient?.sex), d.patient?.spayedNeutered ? 'Spayed / neutered' : undefined) }, { label: 'Born', get: (d) => dayOnly(d.patient?.dob) }, { label: 'Weight', get: (d) => (d.patient?.weightLb != null ? `${d.patient.weightLb} lb` : undefined) }, { label: 'Colour', get: (d) => d.patient?.color }, { label: 'Microchip', get: (d) => d.patient?.microchip }] },
        { title: 'Owner', fields: [{ label: 'Name', get: (d) => d.owner?.name }], links: (d) => callLinks(d.owner?.name, d.owner?.mobile || d.owner?.phone) },
        { title: 'Vaccines given', rows: (d): Row[] => (d.vaccinations || []).map((v: any) => ({ key: v.id, title: v.vaccine, subtitle: join(v.givenDate && `Given ${dayOnly(v.givenDate)}`, v.dueDate && `Next due ${dayOnly(v.dueDate)}`) })), empty: 'No vaccines on the chart.' },
        { title: 'Last visit', rows: (d): Row[] => (d.visits || []).slice(0, 1).map((v: any) => ({ key: v.id, title: dayOnly(v.visitDate) || 'Visit', subtitle: v.reason })), empty: 'No visits yet.' },
      ],
      actions: [
        { id: 'record-vaccine', label: 'Record a vaccine given', icon: 'add-circle', any: ['contacts:create'], when: (d) => !d.patient?.deceased,
          inputs: [{ id: 'vaccine', label: 'Vaccine', required: true }, { id: 'givenDate', label: 'Given on (YYYY-MM-DD)', required: true, initial: today }, { id: 'dueDate', label: 'Next due (you choose, YYYY-MM-DD)', required: true }, { id: 'lotNumber', label: 'Lot number' }],
          request: (d, v) => ({ method: 'POST', path: '/api/vaccinations', body: { patientId: d.patient.id, vaccine: v.vaccine, givenDate: v.givenDate, dueDate: v.dueDate, lotNumber: v.lotNumber || undefined } }), done: 'Vaccine recorded' },
        { id: 'weight', label: 'Update weight', icon: 'scale', any: ['contacts:update'], when: (d) => !d.patient?.deceased,
          inputs: [{ id: 'lb', label: 'Weight in lb', kind: 'number', required: true }],
          request: (d, v) => ({ method: 'PUT', path: `/api/patients/${d.patient.id}`, body: { weightLb: Number(v.lb) } }), done: 'Weight saved' },
      ],
    },
  },
  {
    id: 'vet-recall', title: 'Vaccines due', any: ['contacts:read'], feature: 'reminders_recall',
    list: { path: '/api/reminders/due', query: { tile: 'overdue' } },
    chips: [{ id: 'overdue', label: 'Overdue', query: { tile: 'overdue' } }, { id: 'due_soon', label: 'Due in 30 days', query: { tile: 'due_soon' } }],
    rows: (r) => ({ id: r.vaccinationId, key: r.vaccinationId, title: r.patientName || 'Patient', subtitle: join(r.vaccine, r.ownerName), meta: r.dueDate && `Due ${dayOnly(r.dueDate)}`, badge: r.remindedRecently ? 'Texted this week' : undefined, tone: 'info' }),
    empty: { title: 'No vaccines due', body: 'Vaccines past due or coming up show here.' },
    detail: {
      path: () => null, title: (d) => d.patientName || 'Patient', subtitle: (d) => d.vaccine,
      sections: [{ fields: [{ label: 'Owner', get: (d) => d.ownerName }, { label: 'Due', get: (d) => dayOnly(d.dueDate) }, { label: 'Last given', get: (d) => dayOnly(d.givenDate) }, { label: 'Last texted', get: (d) => dayOnly(d.lastRemindedAt) }] },
        { links: (d) => callLinks(d.ownerName, d.ownerMobile || d.ownerPhone) }],
      actions: [{ id: 'recall-text', label: 'Text a reminder', icon: 'chatbubble', any: ['contacts:update'], when: (d) => !!(d.ownerMobile || d.ownerPhone),
        confirm: { title: 'Text this owner?', body: (d) => `This texts ${d.ownerName || 'the owner'} about ${d.patientName || 'their pet'}'s ${d.vaccine}. You can change the words below. Owners who opted out are skipped.`, button: 'Send text' },
        inputs: [{ id: 'message', label: 'Message', kind: 'multiline', required: true, initial: () => RECALL_TEXT }],
        request: (d, v) => ({ method: 'POST', path: '/api/reminders/send', body: { contactIds: [d.ownerId], vaccinationIds: [d.vaccinationId], message: v.message } }), done: 'Text sent' }],
    },
  },
]
export { calDay }
