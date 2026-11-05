// What the agency says to a relative, in its own words, and what a relative asks of the agency (row 7, care_family_comms; not ready until the
// owner has tried it):
//   · the arrival / finish TEXT wording, editable, with {caregiver} {client} {time} {agency};
//   · four portal EMAILS, editable: account created, forgot password, access granted, access revoked (the last two can be switched off);
//   · a relative's REQUEST to the office — change a visit, change the service, ask for a new visit — which becomes an office task and counts on
//     the "Open requests" tile until the office has dealt with it;
//   · the exact words the relative agreed to, kept with their yes (consentWording).
// Words are plain text with {tags}; a tag we do not know is refused when the office saves, so a typo never goes out to a family.
import { and, count, desc, eq } from 'drizzle-orm'
import { company, familyMembers, familyRequest, clients, task } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyProfiles } from './agencyProfile.ts'
import type { VisitNotify } from './visitNotify.ts'

export const FAMILY_COMMS_FEATURE = 'care_family_comms'

/** What a relative can ask for — codes are stored, labels are what every screen shows. */
export const REQUEST_KINDS = [
  { code: 'visit_change', label: 'Change a visit' },
  { code: 'service_change', label: 'Change the service' },
  { code: 'new_visit', label: 'Ask for a new visit' },
] as const
export const kindLabel = (code: string) => REQUEST_KINDS.find((k) => k.code === code)?.label ?? code
export const STATUS_LABELS: Record<string, string> = { open: 'Open', done: 'Done', declined: 'Declined' }

/** The words a relative agrees to when the office records their yes to arrival and finish texts (stored word for word with the yes). */
export const consentWording = (agency: string) =>
  `${agency || 'The agency'} may text me when a caregiver arrives at and leaves my loved one's home. About two short texts per visit. Message and data rates may apply. Reply STOP at any time to stop these texts, or HELP for help.`
export const emailConsentWording = (agency: string) =>
  `${agency || 'The agency'} may email me when a caregiver arrives at and leaves my loved one's home. I can ask the office to stop these emails at any time.`

// ── Wording with {tags} ──────────────────────────────────────────────────────────────────────────────────────
export const TEXT_TAGS = ['caregiver', 'client', 'time', 'agency'] as const
export const DEFAULT_TEXTS = {
  arrivalText: '{caregiver} has arrived to help {client} ({time}).',
  departureText: '{caregiver} has finished the visit with {client} ({time}).',
}
export const EMAIL_KINDS = ['accountCreated', 'forgotPassword', 'accessGranted', 'accessRevoked'] as const
export type EmailKind = typeof EMAIL_KINDS[number]
export const EMAIL_LABELS: Record<EmailKind, string> = {
  accountCreated: 'Account created', forgotPassword: 'Forgot password', accessGranted: 'Access granted', accessRevoked: 'Access revoked',
}
/** Which tags each email may use. */
export const EMAIL_TAGS: Record<EmailKind, string[]> = {
  accountCreated: ['name', 'client', 'agency', 'email', 'tempPassword', 'loginUrl'],
  forgotPassword: ['name', 'client', 'agency', 'resetUrl'],
  accessGranted: ['name', 'client', 'agency', 'loginUrl'],
  accessRevoked: ['name', 'client', 'agency'],
}
/** The two that can be switched off (the others are the account's own mail and always go). */
export const SWITCHABLE: EmailKind[] = ['accessGranted', 'accessRevoked']
export const DEFAULT_EMAILS: Record<EmailKind, { subject: string; body: string }> = {
  accountCreated: {
    subject: 'Welcome to the {agency} family portal',
    body: 'Hello {name},\n\n{agency} has given you access to the family portal for {client}.\n\nYour login:\nEmail: {email}\nTemporary password: {tempPassword}\n\nLog in here: {loginUrl}\n\nPlease change your password after you first sign in.',
  },
  forgotPassword: {
    subject: 'Reset your {agency} family portal password',
    body: 'Hello {name},\n\nWe got a request to reset your password for the family portal of {client}. This link works for one hour:\n{resetUrl}\n\nIf you did not ask for this, you can ignore this email; your password has not changed.',
  },
  accessGranted: {
    subject: 'Your {agency} family portal access is back on',
    body: 'Hello {name},\n\n{agency} has turned your access to the family portal for {client} back on.\n\nSign in here: {loginUrl}',
  },
  accessRevoked: {
    subject: 'Your {agency} family portal access has been turned off',
    body: 'Hello {name},\n\n{agency} has turned off your access to the family portal for {client}. If you think this is a mistake, please call the office.',
  },
}

/** Fill {tags}; a tag with no value becomes empty. */
export const fill = (text: string, vars: Record<string, string>) => String(text).replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? '')

/** Why this wording cannot be saved, in plain words — or null. A tag we do not know would go out as a hole in a family's message. */
export function wordingProblem(text: unknown, allowed: readonly string[], max: number, what: string): string | null {
  const s = String(text ?? '')
  if (!s.trim()) return `Write the words for ${what}.`
  if (s.length > max) return `${what[0].toUpperCase() + what.slice(1)} is too long: keep it under ${max} characters.`
  const unknown = [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((t) => !allowed.includes(t)))]
  if (unknown.length) return `${unknown.map((u) => `{${u}}`).join(', ')} is not something we can fill in. You can use ${allowed.map((a) => `{${a}}`).join(', ')}.`
  if (/[{}]/.test(s.replace(/\{\w+\}/g, ''))) return 'A curly bracket is left open. Write each tag like {name}.'
  return null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Plain words to a simple email: paragraphs, line breaks, and web addresses as links. */
export const emailHtml = (agency: string, body: string) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">${
  body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`).join('')
}<p style="color:#6b7280;font-size:12px">${esc(agency)}</p></div>`

export function createFamilyComms(d: CrmDeps, deps: { notify: VisitNotify; profile: Pick<AgencyProfiles, 'agencyShortName'> }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, FAMILY_COMMS_FEATURE)
  const readSettings = async (companyId: string) => {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return ((row?.settings as any) || {}) as Record<string, any>
  }
  const writeSettings = async (companyId: string, patch: (s: Record<string, any>) => Record<string, any>) => {
    const cur = await readSettings(companyId)
    await d.db.update(company).set({ settings: patch(cur) as any, updatedAt: new Date() } as any).where(eq(company.id, companyId))
  }

  // ── The arrival / finish text wording ──
  async function textWording(companyId: string): Promise<{ arrivalText: string; departureText: string; tags: readonly string[] }> {
    const own = (await readSettings(companyId)).familyTexts || {}
    return {
      arrivalText: typeof own.arrivalText === 'string' && own.arrivalText.trim() ? own.arrivalText : DEFAULT_TEXTS.arrivalText,
      departureText: typeof own.departureText === 'string' && own.departureText.trim() ? own.departureText : DEFAULT_TEXTS.departureText,
      tags: TEXT_TAGS,
    }
  }
  async function saveTextWording(companyId: string, b: { arrivalText?: unknown; departureText?: unknown }): Promise<{ problem: string; field: string } | { arrivalText: string; departureText: string; tags: readonly string[] }> {
    for (const [k, what] of [['arrivalText', 'the arrival text'], ['departureText', 'the finish text']] as const) {
      const p = wordingProblem(b[k], TEXT_TAGS, 300, what)
      if (p) return { problem: p, field: k }
    }
    await writeSettings(companyId, (s) => ({ ...s, familyTexts: { ...(s.familyTexts || {}), arrivalText: String(b.arrivalText).trim(), departureText: String(b.departureText).trim() } }))
    return textWording(companyId)
  }

  // ── The portal emails ──
  async function emailTemplates(companyId: string) {
    const own = (await readSettings(companyId)).familyEmails || {}
    return EMAIL_KINDS.map((kind) => ({
      kind, label: EMAIL_LABELS[kind], tags: EMAIL_TAGS[kind], switchable: SWITCHABLE.includes(kind),
      enabled: SWITCHABLE.includes(kind) ? own[kind]?.enabled !== false : true,
      subject: typeof own[kind]?.subject === 'string' && own[kind].subject.trim() ? own[kind].subject : DEFAULT_EMAILS[kind].subject,
      body: typeof own[kind]?.body === 'string' && own[kind].body.trim() ? own[kind].body : DEFAULT_EMAILS[kind].body,
      custom: !!(own[kind]?.subject || own[kind]?.body),
    }))
  }
  async function saveEmailTemplate(companyId: string, kind: string, b: { subject?: unknown; body?: unknown; enabled?: unknown }) {
    if (!(EMAIL_KINDS as readonly string[]).includes(kind)) return { problem: 'That is not one of the portal emails.', field: 'kind' }
    const k = kind as EmailKind
    const sp = wordingProblem(b.subject, EMAIL_TAGS[k], 200, 'the subject'); if (sp) return { problem: sp, field: 'subject' }
    const bp = wordingProblem(b.body, EMAIL_TAGS[k], 4000, 'the email'); if (bp) return { problem: bp, field: 'body' }
    if (b.enabled !== undefined && typeof b.enabled !== 'boolean') return { problem: 'Say whether this email is on or off.', field: 'enabled' }
    if (b.enabled === false && !SWITCHABLE.includes(k)) return { problem: 'This email is the account\'s own mail and always goes. Only "Access granted" and "Access revoked" can be switched off.', field: 'enabled' }
    await writeSettings(companyId, (s) => ({ ...s, familyEmails: { ...(s.familyEmails || {}), [k]: { ...((s.familyEmails || {})[k] || {}), subject: String(b.subject).trim(), body: String(b.body).trim(), ...(b.enabled !== undefined ? { enabled: b.enabled } : {}) } } }))
    return (await emailTemplates(companyId)).find((t) => t.kind === k)!
  }
  /** Back to our wording for one email. */
  async function resetEmailTemplate(companyId: string, kind: string) {
    if (!(EMAIL_KINDS as readonly string[]).includes(kind)) return false
    await writeSettings(companyId, (s) => { const e = { ...(s.familyEmails || {}) }; if (e[kind]) e[kind] = { ...(e[kind].enabled === false ? { enabled: false } : {}) }; return { ...s, familyEmails: e } })
    return true
  }

  /**
   * Send one of the four emails in the agency's wording. `accessGranted` / `accessRevoked` do nothing when the agency switched them off, and
   * nothing at all when the feature is off (the caller keeps its old email then). Never throws. Returns true when an email went out.
   */
  async function sendPortalEmail(companyId: string, kind: EmailKind, to: string | null | undefined, vars: Record<string, string>): Promise<boolean> {
    try {
      if (!to || !(await enabled(companyId))) return false
      const t = (await emailTemplates(companyId)).find((x) => x.kind === kind)!
      if (!t.enabled) return false
      const agency = (await deps.profile.agencyShortName(companyId)) || 'Your care agency'
      const all = { agency, ...vars }
      await d.services.emailService.sendRaw({ to, subject: fill(t.subject, all), html: emailHtml(agency, fill(t.body, all)) })
      return true
    } catch (e: any) {
      d.logger.error('[family-comms] email', { kind, error: e?.message })
      return false
    }
  }

  // ── Requests ──
  async function createRequest(companyId: string, member: { id: string; clientId: string; name: string }, b: { kind?: unknown; visitDate?: unknown; details?: unknown }):
    Promise<{ ok: true; id: string } | { ok: false; message: string; code: string; fields?: Record<string, string> }> {
    const kind = String(b.kind ?? '')
    if (!REQUEST_KINDS.some((k) => k.code === kind)) return { ok: false, message: 'Pick what you would like: change a visit, change the service, or ask for a new visit.', code: 'bad_kind', fields: { kind: 'Pick one' } }
    const details = String(b.details ?? '').trim()
    if (!details) return { ok: false, message: 'Tell the office what you would like.', code: 'details_required', fields: { details: 'Say what you need' } }
    if (details.length > 2000) return { ok: false, message: 'That is too long. Keep it under 2000 characters.', code: 'details_too_long', fields: { details: 'Shorten it' } }
    const visitDate = b.visitDate ? String(b.visitDate) : null
    if (visitDate && !/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) return { ok: false, message: 'Give the day as a date.', code: 'bad_date', fields: { visitDate: 'Pick a date' } }
    // One open request of the same kind for the same day from the same relative is a double tap, not a second request.
    const [dupe] = await d.db.select({ id: familyRequest.id }).from(familyRequest).where(and(eq(familyRequest.companyId, companyId), eq(familyRequest.familyMemberId, member.id),
      eq(familyRequest.kind, kind), eq(familyRequest.status, 'open'), eq(familyRequest.details, details))).limit(1)
    if (dupe) return { ok: true, id: dupe.id }
    const [client] = await d.db.select({ f: clients.firstName, l: clients.lastName }).from(clients).where(and(eq(clients.id, member.clientId), eq(clients.companyId, companyId))).limit(1)
    const clientName = `${client?.f ?? ''} ${client?.l ?? ''}`.trim()
    const title = `Family request: ${kindLabel(kind).toLowerCase()} for ${clientName}`
    const [t] = await d.db.insert(task).values({
      companyId, title, priority: 'medium', status: 'pending', dueDate: new Date(Date.now() + 24 * 3600_000),
      description: `${member.name} (family of ${clientName}) asks: ${kindLabel(kind).toLowerCase()}${visitDate ? ` — about ${visitDate}` : ''}.\n\n${details}`,
    } as any).returning({ id: task.id })
    const [row] = await d.db.insert(familyRequest).values({ companyId, clientId: member.clientId, familyMemberId: member.id, kind, visitDate, details, taskId: t.id } as any).returning({ id: familyRequest.id })
    await deps.notify.notifyAdmins(companyId, 'family_request', title, `${member.name} asked: ${details.slice(0, 160)}`)
    return { ok: true, id: row.id }
  }

  const requestRows = (companyId: string, where: any[]) => d.db.select({
    id: familyRequest.id, kind: familyRequest.kind, visitDate: familyRequest.visitDate, details: familyRequest.details, status: familyRequest.status,
    handledNote: familyRequest.handledNote, handledAt: familyRequest.handledAt, createdAt: familyRequest.createdAt, clientId: familyRequest.clientId,
    relativeName: familyMembers.name, relationship: familyMembers.relationship, clientFirst: clients.firstName, clientLast: clients.lastName,
  }).from(familyRequest).innerJoin(familyMembers, eq(familyMembers.id, familyRequest.familyMemberId)).innerJoin(clients, eq(clients.id, familyRequest.clientId))
    .where(and(eq(familyRequest.companyId, companyId), ...where)).orderBy(desc(familyRequest.createdAt)).limit(300)
    .then((rs: any[]) => rs.map((r) => ({ ...r, kindLabel: kindLabel(r.kind), statusLabel: STATUS_LABELS[r.status] || r.status })))

  const listRequests = (companyId: string, status?: string) => requestRows(companyId, status ? [eq(familyRequest.status, status)] : [])
  const requestsOf = (companyId: string, familyMemberId: string) => requestRows(companyId, [eq(familyRequest.familyMemberId, familyMemberId)])
  /** The "Open requests" tile. */
  async function openCount(companyId: string): Promise<number> {
    const [r] = await d.db.select({ n: count() }).from(familyRequest).where(and(eq(familyRequest.companyId, companyId), eq(familyRequest.status, 'open')))
    return Number(r?.n ?? 0)
  }
  /** The office deals with a request: done or declined (with a note the relative sees); its task is closed with it. */
  async function handle(companyId: string, id: string, by: string, status: string, note: unknown): Promise<'ok' | 'missing' | 'bad_status' | 'already'> {
    if (!['done', 'declined'].includes(status)) return 'bad_status'
    const [r] = await d.db.select().from(familyRequest).where(and(eq(familyRequest.id, id), eq(familyRequest.companyId, companyId))).limit(1)
    if (!r) return 'missing'
    if (r.status !== 'open') return 'already'
    await d.db.update(familyRequest).set({ status, handledById: by, handledAt: new Date(), handledNote: note && String(note).trim() ? String(note).trim().slice(0, 1000) : null } as any).where(eq(familyRequest.id, id))
    if (r.taskId) await d.db.update(task).set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() } as any).where(and(eq(task.id, r.taskId), eq(task.companyId, companyId)))
    return 'ok'
  }

  return {
    enabled, textWording, saveTextWording, emailTemplates, saveEmailTemplate, resetEmailTemplate, sendPortalEmail,
    createRequest, listRequests, requestsOf, openCount, handle,
  }
}
export type FamilyComms = ReturnType<typeof createFamilyComms>
