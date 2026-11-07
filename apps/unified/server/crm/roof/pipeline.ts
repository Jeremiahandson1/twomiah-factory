// What a roofing company calls its pipeline stages, and its separate Retail and Insurance boards (roofing depth, gap 8;
// docs/parity/roof-pipeline.md). Behind the not-ready feature `pipeline_boards`.
//
// DISPLAY NAMES ONLY. A job is stored with one of the same eleven stage keys it always was (validation.ts
// PIPELINE_STATUSES) and nothing here changes that: Advance still steps along the keys, the stage texts (stageEffects.ts
// AUTO_SMS) and the review request are chosen by key, a paid job still goes from `invoiced` to `collected` (collected.ts),
// and the measurement stage is still hidden while Measurement Reports is off. Nothing reads a name to decide anything. A
// company with no names set — and every company while the feature is off — sees today's names.
//
// A name has three layers, each over the one beneath: the board's own name for a stage ("Signed" is "Claim approved" on the
// Insurance board), then the company's name for it, then today's. A job is on the Insurance board when its type is
// insurance and on the Retail board otherwise (commercial, new construction, emergency and retail jobs).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { company, roofPipelineConfig, roofPipelineBoard, roofJobStatus, job } from '../../db/schema/index.ts'
import { stripHtml } from '../../core/sanitize.ts'
import { invalid } from '../../http/errors.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { STAGE_LABELS } from './jobRecord.ts'
import { PIPELINE_STATUSES } from './validation.ts'

export const BOARD_IDS = ['retail', 'insurance'] as const
export type BoardId = (typeof BOARD_IDS)[number]
export const DEFAULT_BOARD_NAMES: Record<BoardId, string> = { retail: 'Retail', insurance: 'Insurance' }
export const MAX_LABEL = 40
export const MAX_BOARD_NAME = 30

type Labels = Record<string, string>
export interface PipelineConfig {
  stageLabels: Labels
  boards: Record<BoardId, { name?: string; stageLabels: Labels }>
}
const STAGE_KEYS = PIPELINE_STATUSES as readonly string[]

/** The board a job of this type is on. */
export const boardOf = (jobType: string | null | undefined): BoardId => (jobType === 'insurance' ? 'insurance' : 'retail')

/** A stored name that is still usable: a real stage, text within the limit. Anything else in a stored config is ignored. */
function cleanLabels(raw: unknown): Labels {
  const out: Labels = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!STAGE_KEYS.includes(k) || typeof v !== 'string') continue
    const label = stripHtml(v).trim()
    if (label && label.length <= MAX_LABEL && label !== STAGE_LABELS[k]) out[k] = label
  }
  return out
}

/** The stored config, made safe to use whatever it holds (a hand-edited row, an older shape). */
export function readConfig(raw: unknown): PipelineConfig {
  const r: any = raw && typeof raw === 'object' ? raw : {}
  const board = (id: BoardId) => {
    const b = r.boards?.[id]
    const name = typeof b?.name === 'string' ? stripHtml(b.name).trim() : ''
    return { ...(name && name.length <= MAX_BOARD_NAME && name !== DEFAULT_BOARD_NAMES[id] ? { name } : {}), stageLabels: cleanLabels(b?.stageLabels) }
  }
  return { stageLabels: cleanLabels(r.stageLabels), boards: { retail: board('retail'), insurance: board('insurance') } }
}

/** The name of a stage: the board's own, else the company's, else today's. Not a pipeline stage (lost, cancelled): today's. */
export function stageLabelFor(cfg: PipelineConfig | null | undefined, stage: string, jobType?: string | null): string {
  const fallback = STAGE_LABELS[stage] ?? stage
  if (!cfg) return fallback
  return cfg.boards[boardOf(jobType)].stageLabels[stage] ?? cfg.stageLabels[stage] ?? fallback
}

/** Every stage's name on one board (jobType 'insurance' or any other), or company-wide when no type is given. */
const resolved = (cfg: PipelineConfig, board?: BoardId): Labels =>
  Object.fromEntries(STAGE_KEYS.map((k) => [k, (board ? cfg.boards[board].stageLabels[k] : undefined) ?? cfg.stageLabels[k] ?? STAGE_LABELS[k]]))

/** What the screens and the phone read: the stages in order, the company's names, and each board's. */
export function describePipeline(cfg: PipelineConfig) {
  return {
    stages: STAGE_KEYS.map((key) => ({ key, defaultLabel: STAGE_LABELS[key] })),
    stageLabels: resolved(cfg),
    overrides: cfg.stageLabels,
    boards: BOARD_IDS.map((id) => ({
      id, name: cfg.boards[id].name ?? DEFAULT_BOARD_NAMES[id], defaultName: DEFAULT_BOARD_NAMES[id],
      stageLabels: resolved(cfg, id), overrides: cfg.boards[id].stageLabels,
    })),
  }
}
export type PipelineView = ReturnType<typeof describePipeline>

export async function loadPipelineConfig(db: any, companyId: string): Promise<PipelineConfig> {
  const [row] = await db.select({ config: roofPipelineConfig.config }).from(roofPipelineConfig).where(eq(roofPipelineConfig.companyId, companyId)).limit(1)
  return readConfig(row?.config)
}

/**
 * The names the page carries for the screens (server/app.ts, the admin page's JSON): nothing unless the feature is on for the
 * business, so a business that does not have it reads exactly what it read before.
 */
export async function pipelineForPage(db: any, features: { enabledFeaturesFor: (companyId: string) => Promise<string[]> }): Promise<PipelineView | null> {
  try {
    const [co] = await db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1)
    if (!co || !(await features.enabledFeaturesFor(co.id)).includes('pipeline_boards')) return null
    return describePipeline(await loadPipelineConfig(db, co.id))
  } catch { return null }
}

// ── the change ──────────────────────────────────────────────────────────────────────────────────────────────────────

const labelValue = z.union([z.string(), z.null()])
const labelPatch = z.record(z.string(), labelValue)
const boardPatch = z.object({ name: z.string().optional(), stageLabels: labelPatch.optional() }).strict()
const patchSchema = z.object({
  stageLabels: labelPatch.optional(),
  boards: z.object({ retail: boardPatch.optional(), insurance: boardPatch.optional() }).strict().optional(),
}).strict()

/** Apply a patch of names to a label map: '' or null puts a stage back to the level beneath. Returns the problem, or null. */
function applyLabels(into: Labels, patch: Record<string, string | null>, where: string): string | null {
  for (const [key, value] of Object.entries(patch)) {
    if (!STAGE_KEYS.includes(key)) return `${key} is not a pipeline stage. The stages are ${STAGE_KEYS.join(', ')}.`
    const label = value === null ? '' : stripHtml(value).trim()
    if (label.length > MAX_LABEL) return `${where}: the name for ${STAGE_LABELS[key]} must be ${MAX_LABEL} characters or fewer.`
    if (!label || label === STAGE_LABELS[key]) delete into[key]
    else into[key] = label
  }
  return null
}
/** Two stages with one name on the same board would be one column twice. */
function duplicate(labels: Labels): string | null {
  const seen = new Map<string, string>()
  for (const key of STAGE_KEYS) {
    const name = labels[key].toLowerCase()
    if (seen.has(name)) return `“${labels[key]}” is the name of both ${STAGE_LABELS[seen.get(name)!]} and ${STAGE_LABELS[key]}. Give each stage its own name.`
    seen.set(name, key)
  }
  return null
}

// ── the company's own boards (row 19; JobNimbus boards; pipeline_custom_boards, not ready) ──────────────────────────────

export const CUSTOM_BOARDS = 'pipeline_custom_boards'
export const MAX_BOARDS = 50
const FILTER_KEYS = ['assignedToId', 'salesRepId', 'locationId', 'subcontractorId'] as const
export type BoardFilters = Partial<Record<typeof FILTER_KEYS[number], string[]>>
export interface CustomBoard { id: string; name: string; color: string; jobTypes: string[]; filters: BoardFilters; visibility: 'all' | 'me' | 'roles'; roles: string[]; ownerId: string | null }

/** A job is on a board when it matches every filter the board sets (an unset one matches any job). Pure; the screen asks the same. */
export function boardMatches(b: Pick<CustomBoard, 'jobTypes' | 'filters'>, j: { jobType?: string | null; assignedToId?: string | null; assignedSalesRepId?: string | null; locationId?: string | null; subcontractorId?: string | null }): boolean {
  const has = (list: string[] | undefined, v: string | null | undefined) => !list?.length || (!!v && list.includes(v))
  return has(b.jobTypes, j.jobType) && has(b.filters.assignedToId, j.assignedToId) && has(b.filters.salesRepId, j.assignedSalesRepId)
    && has(b.filters.locationId, j.locationId) && has(b.filters.subcontractorId, j.subcontractorId)
}
/** Who sees a board: everyone, its owner, or the roles it names (its owner always). */
export const boardVisibleTo = (b: Pick<CustomBoard, 'visibility' | 'roles' | 'ownerId'>, u: { userId: string; role: string }) =>
  b.visibility === 'all' || b.ownerId === u.userId || (b.visibility === 'roles' && b.roles.includes(u.role))

const strList = (v: unknown, max = 100) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x.length <= 80))].slice(0, max) as string[] : [])
const shapeBoard = (r: any): CustomBoard => ({
  id: r.id, name: r.name, color: r.color, jobTypes: strList(r.jobTypes),
  filters: Object.fromEntries(FILTER_KEYS.map((k) => [k, strList(r.filters?.[k])]).filter(([, v]) => (v as string[]).length)) as BoardFilters,
  visibility: ['all', 'me', 'roles'].includes(r.visibility) ? r.visibility : 'all', roles: strList(r.roles), ownerId: r.ownerId ?? null,
})
/** A board body checked. A problem names the box. */
function readBoard(b: any): { board: Omit<CustomBoard, 'id' | 'ownerId'> } | { problem: string; field: string } {
  const name = typeof b?.name === 'string' ? stripHtml(b.name).trim() : ''
  if (!name || name.length > MAX_BOARD_NAME) return { problem: `Name the board (${MAX_BOARD_NAME} characters at most).`, field: 'name' }
  const color = typeof b?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : '#ea580c'
  const visibility = ['all', 'me', 'roles'].includes(b?.visibility) ? b.visibility : 'all'
  const roles = strList(b?.roles, 10)
  if (visibility === 'roles' && !roles.length) return { problem: 'Pick at least one role to show the board to.', field: 'roles' }
  const filters: BoardFilters = {}
  for (const k of FILTER_KEYS) { const v = strList(b?.filters?.[k]); if (v.length) filters[k] = v }
  return { board: { name, color, jobTypes: strList(b?.jobTypes, 20), filters, visibility, roles } }
}

// ── company statuses under the milestones (row 20; AccuLynx Workflow Manager; pipeline_statuses, not ready) ───────────────────

export const STATUSES_FEATURE = 'pipeline_statuses'
const ROOF_JOB_TYPES = ['insurance', 'retail', 'commercial', 'new_construction', 'emergency']
export const MAX_STATUSES = 200
export const MAX_CHECKS = 30
export interface RoofStatus { id: string; milestone: string; name: string; jobTypes: string[]; checklist: Array<{ id: string; text: string }>; sortOrder: number }

const shapeStatus = (r: any): RoofStatus => ({
  id: r.id, milestone: r.milestone, name: r.name, sortOrder: r.sortOrder ?? 0,
  jobTypes: (Array.isArray(r.jobTypes) ? r.jobTypes : []).filter((x: any) => ROOF_JOB_TYPES.includes(x)),
  checklist: (Array.isArray(r.checklist) ? r.checklist : []).filter((c: any) => c && typeof c.id === 'string' && typeof c.text === 'string'),
})
/** The statuses a job may take: its milestone's, for its job type (a status with no job types is every type's). */
export const statusesFor = (all: RoofStatus[], j: { status: string; jobType?: string | null }) =>
  all.filter((s) => s.milestone === j.status && (!s.jobTypes.length || s.jobTypes.includes(String(j.jobType || '')))).sort((a, b) => a.sortOrder - b.sortOrder)
/** A status body checked; the checklist keeps the ids it has and gives new items one. A problem names the box. */
function readStatus(b: any, had?: RoofStatus): { status: Omit<RoofStatus, 'id' | 'sortOrder'> } | { problem: string; field: string } {
  if (!STAGE_KEYS.includes(b?.milestone)) return { problem: 'Pick the milestone this status sits under.', field: 'milestone' }
  const name = typeof b?.name === 'string' ? stripHtml(b.name).trim() : ''
  if (!name || name.length > MAX_LABEL) return { problem: `Name the status (${MAX_LABEL} characters at most).`, field: 'name' }
  const jobTypes = Array.isArray(b?.jobTypes) ? [...new Set(b.jobTypes.filter((x: any) => ROOF_JOB_TYPES.includes(x)))] as string[] : []
  const raw = Array.isArray(b?.checklist) ? b.checklist : []
  if (raw.length > MAX_CHECKS) return { problem: `A checklist has ${MAX_CHECKS} items at most.`, field: 'checklist' }
  const checklist: Array<{ id: string; text: string }> = []
  for (const [i, c] of raw.entries()) {
    const text = stripHtml(typeof c === 'string' ? c : String(c?.text ?? '')).trim()
    if (!text) continue
    if (text.length > 120) return { problem: `Checklist item ${i + 1} is over 120 characters.`, field: 'checklist' }
    const keep = typeof c?.id === 'string' && had?.checklist.some((x) => x.id === c.id) ? c.id : `c${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 6)}`
    checklist.push({ id: keep, text })
  }
  return { status: { milestone: b.milestone, name, jobTypes, checklist } }
}

export function createPipelineRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()

  // ---- row 20: company statuses and their checklists ----
  const statusesOn = (c: any) => d.features.isFeatureEnabled(c.get('user').companyId, STATUSES_FEATURE).catch(() => false)
  const allStatuses = async (companyId: string): Promise<RoofStatus[]> => (await db.select().from(roofJobStatus).where(eq(roofJobStatus.companyId, companyId)).orderBy(asc(roofJobStatus.milestone), asc(roofJobStatus.sortOrder))).map(shapeStatus)
  app.get('/statuses', d.permissions.requirePermission('jobs:read'), async (c) => {
    if (!(await statusesOn(c))) return fail(c, 404, 'Not found')
    return one(c, { data: await allStatuses(c.get('user').companyId) })
  })
  app.post('/statuses', d.permissions.requirePermission('company:update'), async (c) => {
    if (!(await statusesOn(c))) return fail(c, 404, 'Not found')
    const u = c.get('user')
    const read = readStatus(await c.req.json().catch(() => ({})))
    if ('problem' in read) return fail(c, 400, read.problem, 'validation_failed', { [read.field]: read.problem })
    const all = await allStatuses(u.companyId)
    if (all.length >= MAX_STATUSES) return fail(c, 409, `A company can have ${MAX_STATUSES} statuses.`)
    if (all.some((s) => s.milestone === read.status.milestone && s.name.toLowerCase() === read.status.name.toLowerCase())) return fail(c, 409, `“${read.status.name}” is already a status under that milestone.`)
    const [row] = await db.insert(roofJobStatus).values({ companyId: u.companyId, ...read.status, sortOrder: all.filter((s) => s.milestone === read.status.milestone).length } as any).returning()
    return one(c, shapeStatus(row), 201)
  })
  app.put('/statuses/:id', d.permissions.requirePermission('company:update'), async (c) => {
    if (!(await statusesOn(c))) return fail(c, 404, 'Not found')
    const u = c.get('user')
    const had = (await allStatuses(u.companyId)).find((s) => s.id === c.req.param('id'))
    if (!had) return fail(c, 404, 'Status not found')
    const b: any = await c.req.json().catch(() => ({}))
    const read = readStatus({ ...had, ...b }, had)
    if ('problem' in read) return fail(c, 400, read.problem, 'validation_failed', { [read.field]: read.problem })
    const sortOrder = Number.isInteger(b?.sortOrder) ? b.sortOrder : had.sortOrder
    const [row] = await db.update(roofJobStatus).set({ ...read.status, sortOrder, updatedAt: new Date() } as any).where(eq(roofJobStatus.id, had.id)).returning()
    return one(c, shapeStatus(row))
  })
  app.delete('/statuses/:id', d.permissions.requirePermission('company:update'), async (c) => {
    if (!(await statusesOn(c))) return fail(c, 404, 'Not found')
    const u = c.get('user')
    const [row] = await db.delete(roofJobStatus).where(and(eq(roofJobStatus.id, c.req.param('id')), eq(roofJobStatus.companyId, u.companyId))).returning({ id: roofJobStatus.id })
    if (!row) return fail(c, 404, 'Status not found')
    // Jobs at it go back to "no status" inside their milestone (the milestone itself never changes here).
    await db.update(job).set({ roofStatusId: null, roofStatusChecks: null } as any).where(and(eq(job.companyId, u.companyId), eq(job.roofStatusId, row.id)))
    return one(c, { id: row.id, deleted: true })
  })
  /** A job of this company, with its statuses: the ones it may take now, the one it is at (null when that was another milestone's). */
  const jobStatusView = async (companyId: string, jobId: string) => {
    const [j] = await db.select({ id: job.id, status: job.status, jobType: job.jobType, roofStatusId: job.roofStatusId, roofStatusChecks: job.roofStatusChecks }).from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
    if (!j) return null
    const choices = statusesFor(await allStatuses(companyId), j)
    const current = choices.find((s) => s.id === j.roofStatusId) ?? null
    return { jobId: j.id, milestone: j.status, choices, current, checks: current ? ((j.roofStatusChecks as any) || {}) : {} }
  }
  app.get('/jobs/:jobId/status', d.permissions.requirePermission('jobs:read'), async (c) => {
    if (!(await statusesOn(c))) return fail(c, 404, 'Not found')
    const v = await jobStatusView(c.get('user').companyId, c.req.param('jobId'))
    return v ? one(c, v) : fail(c, 404, 'Job not found')
  })
  app.put('/jobs/:jobId/status', d.permissions.requirePermission('jobs:update'), async (c) => {
    if (!(await statusesOn(c))) return fail(c, 404, 'Not found')
    const u = c.get('user')
    const v = await jobStatusView(u.companyId, c.req.param('jobId'))
    if (!v) return fail(c, 404, 'Job not found')
    const b: any = await c.req.json().catch(() => ({}))
    const id = b?.statusId === null || b?.statusId === '' ? null : String(b?.statusId || '')
    if (id && !v.choices.some((s) => s.id === id)) return fail(c, 400, 'That status is not one of this milestone’s for this kind of job.', 'validation_failed', { statusId: 'Pick one of the list' })
    await db.update(job).set({ roofStatusId: id, roofStatusChecks: id === v.current?.id ? (v.checks as any) : {}, updatedAt: new Date() } as any).where(eq(job.id, v.jobId))
    return one(c, (await jobStatusView(u.companyId, v.jobId))!)
  })
  app.put('/jobs/:jobId/checks', d.permissions.requirePermission('jobs:update'), async (c) => {
    if (!(await statusesOn(c))) return fail(c, 404, 'Not found')
    const u = c.get('user')
    const v = await jobStatusView(u.companyId, c.req.param('jobId'))
    if (!v) return fail(c, 404, 'Job not found')
    if (!v.current) return fail(c, 409, 'Pick the job’s status first.')
    const b: any = await c.req.json().catch(() => ({}))
    if (!v.current.checklist.some((x) => x.id === b?.itemId)) return fail(c, 400, 'That item is not on this status’s checklist.')
    const checks = { ...(v.checks as Record<string, any>) }
    if (b?.done === true) checks[b.itemId] = { at: new Date().toISOString(), by: u.userId }
    else delete checks[b.itemId]
    await db.update(job).set({ roofStatusChecks: checks, updatedAt: new Date() } as any).where(eq(job.id, v.jobId))
    return one(c, (await jobStatusView(u.companyId, v.jobId))!)
  })

  // ---- row 19: the company's own boards ----
  const boardsOn = (c: any) => d.features.isFeatureEnabled(c.get('user').companyId, CUSTOM_BOARDS).catch(() => false)
  const mayManage = async (c: any) => {
    const u = c.get('user')
    try { return d.permissions.hasPermission(u.role, 'company:update', await d.permissions.getExtraPermissions(u.userId)) } catch { return false }
  }
  app.get('/boards', d.permissions.requirePermission('jobs:read'), async (c) => {
    if (!(await boardsOn(c))) return fail(c, 404, 'Not found')
    const u = c.get('user')
    const rows = await db.select().from(roofPipelineBoard).where(eq(roofPipelineBoard.companyId, u.companyId)).orderBy(asc(roofPipelineBoard.sortOrder), asc(roofPipelineBoard.createdAt))
    const manage = await mayManage(c)
    return one(c, { data: rows.map(shapeBoard).filter((b: CustomBoard) => boardVisibleTo(b, u)).map((b: CustomBoard) => ({ ...b, mayEdit: manage || b.ownerId === u.userId })) })
  })
  // Anyone who reads jobs may make a board for themselves ("Just me"); a board for everyone or for roles is the office's (company:update).
  app.post('/boards', d.permissions.requirePermission('jobs:read'), async (c) => {
    if (!(await boardsOn(c))) return fail(c, 404, 'Not found')
    const u = c.get('user')
    const read = readBoard(await c.req.json().catch(() => ({})))
    if ('problem' in read) return fail(c, 400, read.problem, 'validation_failed', { [read.field]: read.problem })
    if (read.board.visibility !== 'me' && !(await mayManage(c))) return fail(c, 403, 'A board for everyone or for roles is set up by the office. Make it “Just me” instead.')
    const count = (await db.select({ id: roofPipelineBoard.id }).from(roofPipelineBoard).where(eq(roofPipelineBoard.companyId, u.companyId))).length
    if (count >= MAX_BOARDS) return fail(c, 409, `A company can have ${MAX_BOARDS} boards. Delete one first.`)
    const [row] = await db.insert(roofPipelineBoard).values({ companyId: u.companyId, ownerId: u.userId, sortOrder: count, ...read.board } as any).returning()
    return one(c, shapeBoard(row), 201)
  })
  const ownBoard = async (c: any) => {
    const u = c.get('user')
    const [row] = await db.select().from(roofPipelineBoard).where(and(eq(roofPipelineBoard.id, c.req.param('id')), eq(roofPipelineBoard.companyId, u.companyId))).limit(1)
    if (!row || !boardVisibleTo(shapeBoard(row), u)) return { error: fail(c, 404, 'Board not found') }
    if (row.ownerId !== u.userId && !(await mayManage(c))) return { error: fail(c, 403, 'Only its owner or the office can change this board.') }
    return { row }
  }
  app.put('/boards/:id', d.permissions.requirePermission('jobs:read'), async (c) => {
    if (!(await boardsOn(c))) return fail(c, 404, 'Not found')
    const found = await ownBoard(c)
    if ('error' in found) return found.error
    const read = readBoard(await c.req.json().catch(() => ({})))
    if ('problem' in read) return fail(c, 400, read.problem, 'validation_failed', { [read.field]: read.problem })
    if (read.board.visibility !== 'me' && !(await mayManage(c))) return fail(c, 403, 'A board for everyone or for roles is set up by the office.')
    const [row] = await db.update(roofPipelineBoard).set({ ...read.board, updatedAt: new Date() } as any).where(eq(roofPipelineBoard.id, found.row.id)).returning()
    return one(c, shapeBoard(row))
  })
  app.delete('/boards/:id', d.permissions.requirePermission('jobs:read'), async (c) => {
    if (!(await boardsOn(c))) return fail(c, 404, 'Not found')
    const found = await ownBoard(c)
    if ('error' in found) return found.error
    await db.delete(roofPipelineBoard).where(eq(roofPipelineBoard.id, found.row.id))
    return one(c, { id: found.row.id, deleted: true })
  })

  // The names, for any seat that reads jobs: the pipeline, the jobs list, the job page and the phone all draw them.
  const namesOn = (c: any) => d.features.isFeatureEnabled(c.get('user').companyId, 'pipeline_boards').catch(() => false)
  app.get('/', d.permissions.requirePermission('jobs:read'), async (c) => {
    if (!(await namesOn(c))) return fail(c, 404, 'Not found')
    return one(c, describePipeline(await loadPipelineConfig(db, c.get('user').companyId)))
  })

  // Change the names. A name is the company's (everywhere) or a board's (that board's jobs). Display only: no job, text or
  // rule reads it. Whoever may change the company may change them (company:update, as the other roofing settings).
  app.put('/', d.permissions.requirePermission('company:update'), async (c) => {
    if (!(await namesOn(c))) return fail(c, 404, 'Not found')
    const me = c.get('user')
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const patch = parsed.data
    const cfg = await loadPipelineConfig(db, me.companyId)

    if (patch.stageLabels) {
      const bad = applyLabels(cfg.stageLabels, patch.stageLabels, 'The pipeline')
      if (bad) return fail(c, 400, bad, 'validation_failed')
    }
    for (const id of BOARD_IDS) {
      const b = patch.boards?.[id]
      if (!b) continue
      if (b.name !== undefined) {
        const name = stripHtml(b.name).trim()
        if (name.length > MAX_BOARD_NAME) return fail(c, 400, `A board name must be ${MAX_BOARD_NAME} characters or fewer.`, 'validation_failed', { [`boards.${id}.name`]: 'too long' })
        if (!name || name === DEFAULT_BOARD_NAMES[id]) delete cfg.boards[id].name
        else cfg.boards[id].name = name
      }
      if (b.stageLabels) {
        const bad = applyLabels(cfg.boards[id].stageLabels, b.stageLabels, `The ${DEFAULT_BOARD_NAMES[id]} board`)
        if (bad) return fail(c, 400, bad, 'validation_failed')
      }
    }
    // Names are checked as they will be read: company-wide, and on each board once its own are laid over.
    const clash = duplicate(resolved(cfg)) ?? BOARD_IDS.map((id) => duplicate(resolved(cfg, id))).find(Boolean)
    if (clash) return fail(c, 400, clash, 'duplicate_stage_name')
    const names = BOARD_IDS.map((id) => (cfg.boards[id].name ?? DEFAULT_BOARD_NAMES[id]).toLowerCase())
    if (names[0] === names[1]) return fail(c, 400, 'The two boards need different names.', 'duplicate_board_name')

    await db.insert(roofPipelineConfig).values({ companyId: me.companyId, config: cfg } as any)
      .onConflictDoUpdate({ target: roofPipelineConfig.companyId, set: { config: cfg, updatedAt: new Date() } as any })
    return one(c, describePipeline(cfg))
  })

  return app
}
