/**
 * A signup's website, written by the AI builder (sectionComposer.ts composeSite) — the per-trade site the owner
 * approved — with the per-trade TEMPLATE composer (instantComposer.ts composeInstant) as the site whenever the AI's
 * isn't ready. (Owner's decision, 2026-10-25: every signup used to get the instant skeleton, which the facts policy
 * cut to one page with an empty menu.)
 *
 * The sequence, and why each step is where it is:
 *   1. At signup the template composition is stored in tenants.preview_premium_pages at once — no model call, so the
 *      signup and the checkout never wait — with `aiCompose: { status: 'pending', input }` beside it: the answers the
 *      AI composes from, kept on the row so a compose can be redone after a restart without the request that carried
 *      them. The AI compose is then started in the background.
 *   2. The build (unified/factory.ts deployUnifiedTenant; routes/factory/deploy.ts runDeploy for a premium template
 *      site) calls settleSignupSite before it seeds the site: it waits for a compose already running, starts one that
 *      is pending or was lost with a restart, and gives up at its deadline. The unified build overlaps that wait with
 *      the database and service it is making, so a compose that finishes inside the build costs no time.
 *   3. Whatever stands at that moment is the site: the AI's composition, or the template one stored at signup.
 *
 * A restart mid-compose: each attempt is written on the row (attempts, attemptId, lastAttemptAt) before the model is
 * called. One that began before this process booted is dead — the process that ran it is gone — so the next settle or
 * the preview sweep (services/scheduler.ts) runs it again, up to MAX_ATTEMPTS. A late result is written only while its
 * attemptId is still the row's: once the build has gone ahead with the template site (timed out) or a newer attempt has
 * started, the old one's result is dropped — the stored composition never differs from the one the site was seeded with.
 *
 * Everything outside goes through `deps`, so the whole sequence runs against fakes (tests/unified/factory/signup-site.test.ts).
 */
import crypto from 'node:crypto'
import type { ComposerInput, SiteResult } from './sectionComposer'
import { composeInstant, toComposition } from './instantComposer'

export const MAX_ATTEMPTS = 2
/** How long a build waits for the AI's site before it goes ahead with the template one. */
export const DEFAULT_WAIT_MS = 12 * 60_000
/** An attempt older than this is treated as lost even inside this process's lifetime (a hung stream). */
export const STALE_MS = 20 * 60_000

export type ComposeStatus = 'pending' | 'composing' | 'done' | 'failed' | 'timed_out'
export interface AiComposeState {
  status: ComposeStatus
  attempts: number
  attemptId?: string | null
  lastAttemptAt?: string
  lastError?: string
  doneAt?: string
  /** The signup's answers, as the composer takes them. */
  input: ComposerInput
}

export interface SignupSiteDeps {
  /** The Factory database (Supabase client, or a stand-in with the same from().select/update/eq chain). */
  db: any
  /** The AI builder: composeSite. */
  compose: (input: ComposerInput) => Promise<SiteResult>
  /** Licensed stock photos for the compose (Unsplash+), when configured. */
  stockPhotos?: (input: ComposerInput) => Promise<Array<{ url: string; tag?: string; alt?: string }>>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** When this process started: an attempt begun before it died with the process that ran it. */
  bootedAt?: number
}

const BOOTED_AT = Date.now()
/** Composes running in this process, by tenant. */
const RUNNING = new Map<string, Promise<void>>()

const TERMINAL = new Set<ComposeStatus>(['done', 'failed', 'timed_out'])

// ─── At signup ─────────────────────────────────────────────────────────────

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

/**
 * The composer's input from the signup's answers. Everything here is the owner's own: name, trade, town, contact
 * details, the services they ticked or typed, their goals (bookings), their name, and — when the signup form sends
 * them — a description and the intake's optional facts. Photos are not taken: the signup carries them only as data
 * URLs, which the composer cannot use as image addresses.
 */
export function signupComposerInput(body: any, extra: { services: string[]; goals: string[]; facts?: ComposerInput['facts'] }): ComposerInput {
  const owner = [text(body?.owner_first_name, 80), text(body?.owner_last_name, 80)].filter(Boolean).join(' ')
  return {
    businessName: String(body?.name || '').trim(),
    businessType: text(body?.industry, 80) || 'other',
    ...(text(body?.city, 120) ? { city: text(body.city, 120) } : {}),
    ...(text(body?.state, 80) ? { state: text(body.state, 80) } : {}),
    ...(text(body?.phone, 40) ? { phone: text(body.phone, 40) } : {}),
    ...(text(body?.email, 200) ? { email: text(body.email, 200) } : {}),
    services: extra.services,
    goals: extra.goals,
    ...(text(body?.description, 2000) ? { description: text(body.description, 2000) } : {}),
    ...(owner ? { ownerName: owner } : {}),
    ...(extra.facts ? { facts: extra.facts } : {}),
  }
}

/**
 * What the signup stores in tenants.preview_premium_pages: the template composition, ready now, and — when the AI is
 * to write the site — the pending compose and the answers it composes from.
 */
export function signupComposition(input: ComposerInput, opts: { ai: boolean }, now = new Date()): Record<string, any> {
  return {
    ...toComposition(composeInstant(input)),
    composer: 'template',
    composedAt: now.toISOString(),
    ...(opts.ai ? { aiCompose: { status: 'pending', attempts: 0, input } satisfies AiComposeState } : {}),
  }
}

// ─── The rule ────────────────────────────────────────────────────────────────

export type Decision = 'none' | 'compose' | 'wait' | 'give_up'

/**
 * What to do with a tenant's compose. Pure, so the rule is testable without a database.
 *   none     nothing pending (no AI compose asked for, or it is finished one way or the other);
 *   compose  pending, or an attempt that died with its process (or hung) and attempts remain;
 *   wait     an attempt is running — here, or in another process that booted after this one;
 *   give_up  an attempt died and none remain.
 */
export function composeDecision(state: AiComposeState | null | undefined, o: { now: number; bootedAt: number; runningHere: boolean }): Decision {
  if (!state || TERMINAL.has(state.status)) return 'none'
  if (o.runningHere) return 'wait'
  if (state.status === 'pending') return (state.attempts || 0) >= MAX_ATTEMPTS ? 'give_up' : 'compose'
  const last = Date.parse(state.lastAttemptAt || '') || 0
  const dead = last < o.bootedAt || o.now - last > STALE_MS
  if (!dead) return 'wait'
  return (state.attempts || 0) >= MAX_ATTEMPTS ? 'give_up' : 'compose'
}

// ─── The compose ─────────────────────────────────────────────────────────────

async function readComposition(db: any, tenantId: string): Promise<Record<string, any> | null> {
  const { data } = await db.from('tenants').select('preview_premium_pages').eq('id', tenantId).maybeSingle()
  const c = data?.preview_premium_pages
  return c && typeof c === 'object' ? c : null
}

/**
 * Writes `next` as the tenant's composition only while `attemptId` is still the attempt the row records — a result
 * from an attempt the build gave up on, or one a newer attempt replaced, is dropped. (Read then write: a single Factory
 * process composes a tenant at a time, and the attemptId closes the window a deploy rollover's two processes open.)
 */
async function writeIfCurrent(db: any, tenantId: string, attemptId: string, next: (current: Record<string, any>) => Record<string, any>): Promise<boolean> {
  const current = await readComposition(db, tenantId)
  if (!current || current.aiCompose?.attemptId !== attemptId) return false
  const { error } = await db.from('tenants').update({ preview_premium_pages: next(current) }).eq('id', tenantId)
  if (error) throw new Error('could not save the composition: ' + error.message)
  return true
}

async function attempt(tenantId: string, deps: SignupSiteDeps): Promise<void> {
  const { db } = deps
  const now = deps.now || Date.now
  const current = await readComposition(db, tenantId)
  const state = current?.aiCompose as AiComposeState | undefined
  if (composeDecision(state, { now: now(), bootedAt: deps.bootedAt ?? BOOTED_AT, runningHere: false }) !== 'compose' || !state || !current) return

  const attemptId = crypto.randomBytes(8).toString('hex')
  const started: AiComposeState = { ...state, status: 'composing', attempts: (state.attempts || 0) + 1, attemptId, lastAttemptAt: new Date(now()).toISOString() }
  const { error } = await db.from('tenants').update({ preview_premium_pages: { ...current, aiCompose: started } }).eq('id', tenantId)
  if (error) throw new Error('could not record the compose attempt: ' + error.message)

  try {
    const stock = deps.stockPhotos ? await deps.stockPhotos(state.input).catch(() => []) : []
    const site = await deps.compose({ ...state.input, ...(stock.length ? { stockPhotos: stock } : {}) })
    const home = (site.pages as any)?.home?.sections
    if (!Array.isArray(home) || !home.length) throw new Error('the AI composition has no home page')
    const kept = await writeIfCurrent(db, tenantId, attemptId, () => ({
      ...site, composer: 'ai', composedAt: new Date(now()).toISOString(),
      aiCompose: { ...started, status: 'done', attemptId: null, doneAt: new Date(now()).toISOString() } satisfies AiComposeState,
    }))
    console.log('[SignupSite]', tenantId, kept ? 'AI composition stored (attempt ' + started.attempts + ')' : 'AI composition dropped: the build already went ahead, or a newer attempt replaced this one')
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 500)
    console.warn('[SignupSite]', tenantId, 'AI compose attempt', started.attempts, 'failed:', msg)
    // Attempts left: back to pending, so the next settle or sweep tries again. None: the template site stands.
    await writeIfCurrent(db, tenantId, attemptId, (c) => ({
      ...c, aiCompose: { ...started, status: started.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attemptId: null, lastError: msg } satisfies AiComposeState,
    })).catch((w: any) => console.warn('[SignupSite]', tenantId, 'could not record the failure:', w?.message))
  }
}

/** One AI compose of the tenant's site, if one is due; joins the one already running in this process. Never throws. */
export function composeSignupSite(tenantId: string, deps: SignupSiteDeps): Promise<void> {
  const running = RUNNING.get(tenantId)
  if (running) return running
  const p = attempt(tenantId, deps)
    .catch((e: any) => console.warn('[SignupSite]', tenantId, 'compose could not run:', e?.message))
    .finally(() => { RUNNING.delete(tenantId) })
  RUNNING.set(tenantId, p)
  return p
}

/** What a settle ended with: the AI's composition, the template one, or no compose was ever asked for. */
export type Settled = 'ai' | 'template' | 'none'

/**
 * Before a build seeds the site: let a running compose finish, run one that is due (up to MAX_ATTEMPTS), and stop at
 * `waitMs` — then the template composition stands, and any later AI result for this tenant is dropped (timed_out).
 */
export async function settleSignupSite(tenantId: string, deps: SignupSiteDeps, waitMs: number = DEFAULT_WAIT_MS): Promise<Settled> {
  const now = deps.now || Date.now
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const deadline = now() + waitMs
  for (;;) {
    const current = await readComposition(deps.db, tenantId)
    const state = current?.aiCompose as AiComposeState | undefined
    if (!state) return 'none'
    if (state.status === 'done') return 'ai'
    if (TERMINAL.has(state.status)) return 'template'
    const left = deadline - now()
    if (left <= 0) break
    const d = composeDecision(state, { now: now(), bootedAt: deps.bootedAt ?? BOOTED_AT, runningHere: RUNNING.has(tenantId) })
    if (d === 'give_up') {
      await deps.db.from('tenants').update({ preview_premium_pages: { ...current, aiCompose: { ...state, status: 'failed', attemptId: null, lastError: state.lastError || 'the last attempt stopped with its process' } } }).eq('id', tenantId)
      return 'template'
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    // Not unref'd: the wait is bounded and cleared below, and an unref'd timer is the only thing a caller awaits here.
    const timeout = new Promise<void>((r) => { timer = setTimeout(r, left) })
    if (d === 'compose' || RUNNING.has(tenantId)) {
      await Promise.race([composeSignupSite(tenantId, deps), timeout])
      // An attempt that could not even be recorded (the database refused the write) leaves the row as it was: pause
      // before the next look rather than asking again at once.
      const after = (await readComposition(deps.db, tenantId))?.aiCompose as AiComposeState | undefined
      if (after && after.status === state.status && (after.attempts || 0) === (state.attempts || 0) && !RUNNING.has(tenantId)) {
        await Promise.race([sleep(Math.min(5_000, Math.max(0, deadline - now()))), timeout])
      }
    } else await Promise.race([sleep(Math.min(10_000, left)), timeout]) // another process is composing: look again shortly
    clearTimeout(timer)
  }
  // Out of time: the build goes ahead with the template site, and the attempt still running is told so.
  const current = await readComposition(deps.db, tenantId)
  const state = current?.aiCompose as AiComposeState | undefined
  if (state?.status === 'done') return 'ai'
  if (current && state && !TERMINAL.has(state.status)) {
    const { error } = await deps.db.from('tenants').update({ preview_premium_pages: { ...current, aiCompose: { ...state, status: 'timed_out', attemptId: null } } }).eq('id', tenantId)
    if (error) console.warn('[SignupSite]', tenantId, 'could not record the time-out:', error.message)
    console.warn('[SignupSite]', tenantId, 'the AI site was not ready in', Math.round(waitMs / 1000) + 's — building with the template site')
  }
  return 'template'
}

/**
 * The preview sweep's part (routes/factory/intake.ts /internal/preview-sweep): signups not yet built whose AI compose
 * is due — pending, or lost with a restart — composed now, a few per sweep, so the AI site is usually ready before the
 * owner pays. The build settles whatever is left.
 */
export async function resumeSignupComposes(deps: SignupSiteDeps, opts: { limit?: number; windowMs?: number } = {}): Promise<string[]> {
  const now = deps.now || Date.now
  const { data: rows, error } = await deps.db.from('tenants').select('id, created_at, preview_premium_pages')
    .eq('status', 'pending').gte('created_at', new Date(now() - (opts.windowMs ?? 3 * 24 * 60 * 60_000)).toISOString())
    .order('created_at', { ascending: true }).limit(50)
  if (error) throw new Error(error.message)
  const due = (rows || []).filter((r: any) =>
    composeDecision(r.preview_premium_pages?.aiCompose, { now: now(), bootedAt: deps.bootedAt ?? BOOTED_AT, runningHere: RUNNING.has(r.id) }) === 'compose')
  const done: string[] = []
  for (const r of due.slice(0, opts.limit ?? 2)) { await composeSignupSite(r.id, deps); done.push(r.id) }
  return done
}

/** The Factory's own deps: Supabase, composeSite and Unsplash+. */
export async function liveSignupSiteDeps(): Promise<SignupSiteDeps> {
  const [{ supabase }, { composeSite }, unsplash] = await Promise.all([
    import('../middleware/auth'), import('./sectionComposer'), import('./unsplashPlus'),
  ])
  return {
    db: supabase,
    compose: composeSite,
    stockPhotos: async (input) => {
      const photos = await unsplash.searchStockPhotosForBusiness(input.businessType, input.services, input.city, input.description, input.businessName)
      for (const p of photos as any[]) if (p.unsplashId) unsplash.trackDownload(p.unsplashId).catch(() => {})
      return (photos || []).map((p: any) => ({ url: p.url, tag: p.tag, alt: p.alt }))
    },
  }
}
