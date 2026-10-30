/**
 * What a roofing company calls its pipeline stages, on the phone (roofing depth, gap 8). Pure, so a test runs it.
 *
 * The names come from GET /api/roof-pipeline (apps/unified/server/crm/roof/pipeline.ts) — the same route the desktop's
 * Settings page and boards read. They are DISPLAY NAMES over the same stage keys a job is stored with; nothing on the phone
 * decides anything by a name. With the feature off the route is shut and every screen keeps its own standard words.
 */
export interface PipelineNames {
  /** The company's name for every stage. */
  stageLabels: Record<string, string>
  boards: Array<{ id: 'retail' | 'insurance'; name: string; stageLabels: Record<string, string> }>
}

/** The reply, or null when it is not one (an older server, a refused request). */
export function parseNames(data: any): PipelineNames | null {
  if (!data || typeof data !== 'object' || !data.stageLabels || typeof data.stageLabels !== 'object' || !Array.isArray(data.boards)) return null
  const boards = data.boards
    .filter((b: any) => b && (b.id === 'retail' || b.id === 'insurance') && b.stageLabels && typeof b.stageLabels === 'object')
    .map((b: any) => ({ id: b.id, name: String(b.name || (b.id === 'retail' ? 'Retail' : 'Insurance')), stageLabels: b.stageLabels }))
  return { stageLabels: data.stageLabels, boards }
}

/** The board a job of this type is on: insurance jobs on Insurance, every other type on Retail. */
export const boardOf = (jobType: string | null | undefined): 'retail' | 'insurance' => (jobType === 'insurance' ? 'insurance' : 'retail')

/**
 * A stage's name: the job's (or the board's) own, else the company's. Undefined where there is no name for it — the caller
 * keeps its standard words. Pass a job's type for a job, a board id for a board, nothing for "everywhere".
 */
export function stageName(names: PipelineNames | null | undefined, stage: string, jobTypeOrBoard?: string | null): string | undefined {
  if (!names) return undefined
  const board = jobTypeOrBoard ? names.boards.find((b) => b.id === boardOf(jobTypeOrBoard)) : undefined
  return board?.stageLabels[stage] ?? names.stageLabels[stage]
}
