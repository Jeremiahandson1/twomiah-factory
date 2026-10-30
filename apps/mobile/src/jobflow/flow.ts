/**
 * The tech's one job flow, as a pure rule (no screen, no network): on my way → arrived → checklist → photos → customer
 * signs → complete. Given what the server last said about the job and what is still waiting on the phone to be sent
 * (../offline), it answers which steps are done, which are WAITING TO SEND, which the server refused, and which is next.
 * Tested by tests/mobile/job-flow.test.ts.
 *
 * The job's moves are the shared jobs module's (packages/tenant-backend jobs/jobs.ts): POST /api/jobs/:id/dispatch (on my
 * way), /start (arrived), /complete — jobs:update. Every one is sent with the record key `job:<id>`, so they go in order
 * and a refusal of one holds back the ones after it (../offline/README.md).
 */
import type { ItemView } from '../offline/engine'

export type StepKey = 'on_my_way' | 'arrived' | 'checklist' | 'photos' | 'signature' | 'complete'
export type StepState = 'done' | 'waiting' | 'failed' | 'next' | 'todo'

export interface FlowStep { key: StepKey; label: string; state: StepState; note?: string }

export interface ChecklistInfo {
  /** What is still owed on this job: a checklist not filled in, or one that needs the customer's signature. */
  outstanding: Array<{ templateId: string; name: string; why: string; submissionId?: string | null; required?: boolean }>
  /** The checklists for this job at all (outstanding or not). */
  templates: Array<{ id: string; name: string; requireSignature: boolean; requirePhoto: boolean }>
}

export interface FlowInput {
  jobId: string
  /** The status the server last reported. */
  status: string
  queue: Array<Pick<ItemView, 'path' | 'method' | 'state' | 'recordKey' | 'refusal' | 'lastError'>>
  /** null: the business does not use checklists (or they could not be read) — those steps are left out. */
  checklists: ChecklistInfo | null
  /** null: photos are not counted here. */
  photoCount: number | null
}

export const jobKey = (id: string) => `job:${id}`
const MOVES: Array<{ suffix: string; to: string; from: string[] }> = [
  { suffix: '/dispatch', to: 'dispatched', from: ['scheduled'] },
  { suffix: '/start', to: 'in_progress', from: ['scheduled', 'dispatched'] },
  { suffix: '/complete', to: 'completed', from: ['in_progress'] },
]
const ORDER = ['scheduled', 'dispatched', 'in_progress', 'completed']

/** The queued moves of this job, oldest first, that are still to be sent (waiting or sending, not refused). */
const queuedMoves = (input: FlowInput) =>
  input.queue.filter((q) => q.recordKey === jobKey(input.jobId) && q.method === 'POST')
    .map((q) => ({ q, move: MOVES.find((m) => q.path === `/api/jobs/${input.jobId}${m.suffix}`) }))
    .filter((x): x is { q: typeof x.q; move: typeof MOVES[number] } => !!x.move)

/** The status the job will have once what is waiting is sent. A refused move does not count. */
export function effectiveStatus(input: FlowInput): string {
  let status = input.status
  for (const { q, move } of queuedMoves(input)) {
    if (q.state === 'failed') continue
    if (ORDER.indexOf(move.to) > ORDER.indexOf(status)) status = move.to
  }
  return status
}

export function buildFlow(input: FlowInput): { status: string; steps: FlowStep[]; next: StepKey | null; completeBlockedBy: string | null } {
  const moves = queuedMoves(input)
  const moveState = (suffix: string, doneBy: string): { state: StepState; note?: string } => {
    const queued = moves.find((m) => m.move.suffix === suffix)
    if (queued?.q.state === 'failed') return { state: 'failed', note: queued.q.refusal?.message || queued.q.lastError || "Couldn't send" }
    if (queued) return { state: 'waiting' }
    return ORDER.indexOf(input.status) >= ORDER.indexOf(doneBy) ? { state: 'done' } : { state: 'todo' }
  }
  const steps: FlowStep[] = [
    { key: 'on_my_way', label: 'On my way', ...moveState('/dispatch', 'dispatched') },
    { key: 'arrived', label: "I've arrived", ...moveState('/start', 'in_progress') },
  ]
  const lists = input.checklists
  if (lists && lists.templates.length) {
    const owed = lists.outstanding.filter((o) => o.why !== 'needs the customer to sign')
    steps.push({
      key: 'checklist', label: 'Checklist', state: owed.length ? 'todo' : 'done',
      note: owed.length ? `${owed.map((o) => o.name).join(', ')} not filled in` : undefined,
    })
  }
  if (input.photoCount !== null) {
    steps.push({ key: 'photos', label: 'Photos', state: input.photoCount > 0 ? 'done' : 'todo', note: input.photoCount > 0 ? `${input.photoCount} on the job` : 'Take a photo of the work' })
  }
  if (lists && lists.templates.some((x) => x.requireSignature)) {
    const unsigned = lists.outstanding.filter((o) => o.why === 'needs the customer to sign')
    const owedFill = lists.outstanding.some((o) => o.why !== 'needs the customer to sign' && lists.templates.find((x) => x.id === o.templateId)?.requireSignature)
    steps.push({ key: 'signature', label: 'Customer signs', state: unsigned.length || owedFill ? 'todo' : 'done', note: unsigned.length ? `${unsigned.map((o) => o.name).join(', ')} needs their signature` : undefined })
  }
  steps.push({ key: 'complete', label: 'Complete', ...moveState('/complete', 'completed') })

  // The phone will not offer Complete while a REQUIRED checklist is owed — the same rule the server now holds (crm/field/checklistRoutes.ts
  // createCompletionGate). A checklist of only optional questions is offered, not demanded; an older server that does not say
  // `required` is treated as required, as before.
  const mustDo = lists?.outstanding?.filter((o) => o.required !== false) ?? []
  const owedAny = mustDo.length ? mustDo.map((o) => `${o.name} ${o.why}`).join('; ') : null
  const status = effectiveStatus(input)
  const completeBlockedBy = status === 'completed' ? null : owedAny
  const firstOpen = steps.find((s) => s.state === 'todo' || s.state === 'failed')
  // The next step is the first one still to do, in order; Complete only when nothing before it is owed.
  const next: StepKey | null = firstOpen?.key ?? null
  const withNext = steps.map((s) => (s.key === next && s.state === 'todo' ? { ...s, state: 'next' as StepState } : s))
  return { status, steps: withNext, next, completeBlockedBy }
}
