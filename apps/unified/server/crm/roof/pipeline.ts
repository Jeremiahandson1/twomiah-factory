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
import { asc, eq } from 'drizzle-orm'
import { company, roofPipelineConfig } from '../../db/schema/index.ts'
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

export function createPipelineRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()

  // The names, for any seat that reads jobs: the pipeline, the jobs list, the job page and the phone all draw them.
  app.get('/', d.permissions.requirePermission('jobs:read'), async (c) => one(c, describePipeline(await loadPipelineConfig(db, c.get('user').companyId))))

  // Change the names. A name is the company's (everywhere) or a board's (that board's jobs). Display only: no job, text or
  // rule reads it. Whoever may change the company may change them (company:update, as the other roofing settings).
  app.put('/', d.permissions.requirePermission('company:update'), async (c) => {
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
