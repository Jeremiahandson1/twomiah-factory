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
import { raiseAlert, clearAlert, raiseIfAiAccountProblem } from './alerts'
import crypto from 'node:crypto'
import type { ComposerInput, SiteResult } from './sectionComposer'
import { composeInstant, heldToOwnerFacts, toComposition } from './instantComposer'

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
 * The composer's input from the signup's answers — exactly the fields the twomiah.com signup sends (signup.html
 * getFormData): name, trade, town, phone and email, the services they ticked or typed, their goals (bookings), the
 * owner's name, their photo once stored (storeSignupPhoto), and — optional — "About your business" in their own words
 * (description, owner's decision 2026-10-25): their About page and the AI's copy start from it, the facts policy holding
 * both to what they said. None of the intake's other optional facts are asked, so none are read here.
 */
export function signupComposerInput(body: any, extra: { services: string[]; goals: string[]; photos?: ComposerInput['customerPhotos'] }): ComposerInput {
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
    ...(owner ? { ownerName: owner } : {}),
    ...(text(body?.description, 2000) ? { description: text(body.description, 2000) } : {}),
    ...(extra.photos?.length ? { customerPhotos: extra.photos } : {}),
  }
}

// ─── The owner's photo ──────────────────────────────────────────────────────
//
// The signup's "A real photo of your team, your place or your work. It becomes the big picture at the top of your
// website" arrives as a data URL (signup.html shrinks it to a 2000px JPEG: body.branding.heroPhoto). A data URL is
// never put in a composition: it is decoded, checked, stored with the intake's assets (factoryStorage.ts
// uploadIntakeAsset — R2 in production), and the site refers to it by a lasting Factory address that hands out a fresh
// signed link on each request (/public/signup-photo/:slug/:file, routes/factory/intake.ts). After the build the same
// stored file is seeded into the business's own photo library (deploy.ts seedIntakePhotosIfPremium, intake_data.photos).

/** The largest decoded photo taken (signup.html sends a 2000px JPEG; the intake form's own ceiling is 8 MB). */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024
const PHOTO_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** A photo data URL decoded and checked: a JPEG, PNG or WebP whose bytes ARE that format, within the size limit. */
export function decodeSignupPhoto(dataUrl: unknown): { bytes: Buffer; mime: string; ext: string } | null {
  if (typeof dataUrl !== 'string') return null
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!m) return null
  const bytes = Buffer.from(m[2], 'base64')
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return null
  const mime = m[1]
  const is = {
    'image/jpeg': bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    'image/png': bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/webp': bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP',
  } as Record<string, boolean>
  return is[mime] ? { bytes, mime, ext: PHOTO_EXT[mime] } : null
}

/** The stored signup photo's file name, as the lasting address names it: "<timestamp>-hero.<ext>". */
export const SIGNUP_PHOTO_FILE = /^\d{10,16}-hero\.(?:jpg|png|webp)$/

/**
 * Stores the signup's photo and returns its lasting address and storage record, or null when there is none or it is
 * not a usable image (never a reason to fail the signup).
 */
export async function storeSignupPhoto(
  dataUrl: unknown, slug: string,
  deps: { upload: (bytes: Buffer, filename: string, contentType: string, slug: string) => Promise<{ storageKey: string; storageType: 's3' | 'local' }>; factoryUrl: string },
): Promise<{ url: string; storageKey: string; storageType: 's3' | 'local' } | null> {
  const photo = decodeSignupPhoto(dataUrl)
  if (!photo || !deps.factoryUrl) return null
  const stored = await deps.upload(photo.bytes, 'hero.' + photo.ext, photo.mime, slug)
  const file = stored.storageKey.split(/[\\/]/).pop() || ''
  if (!SIGNUP_PHOTO_FILE.test(file)) throw new Error('unexpected stored name ' + file)
  return { url: deps.factoryUrl.replace(/\/+$/, '') + '/api/v1/factory/public/signup-photo/' + slug + '/' + file, ...stored }
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
    // The AI's site is held to the template composer's rules for "What we do" and the About story before it is stored.
    const site = heldToOwnerFacts(await deps.compose({ ...state.input, ...(stock.length ? { stockPhotos: stock } : {}) }) as any, state.input)
    const home = (site.pages as any)?.home?.sections
    if (!Array.isArray(home) || !home.length) throw new Error('the AI composition has no home page')
    const kept = await writeIfCurrent(db, tenantId, attemptId, () => ({
      ...site, composer: 'ai', composedAt: new Date(now()).toISOString(),
      aiCompose: { ...started, status: 'done', attemptId: null, doneAt: new Date(now()).toISOString() } satisfies AiComposeState,
    }))
    clearAlert('ai:credit'); clearAlert('ai:auth'); clearAlert('ai-site:' + tenantId)
    console.log('[SignupSite]', tenantId, kept ? 'AI composition stored (attempt ' + started.attempts + ')' : 'AI composition dropped: the build already went ahead, or a newer attempt replaced this one')
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 500)
    console.warn('[SignupSite]', tenantId, 'AI compose attempt', started.attempts, 'failed:', msg)
    // Out of Anthropic credit (or the key refused) is the whole builder down, not this business: say so at once.
    // Anything else is told once the attempts run out and the template site stands.
    const business = (state.input as any)?.businessName || null
    if (!raiseIfAiAccountProblem(e, business, tenantId) && started.attempts >= MAX_ATTEMPTS) {
      void raiseAlert({ key: 'ai-site:' + tenantId, what: 'The AI site builder failed — the template site is used instead', business, detail: msg, tenantId })
    }
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
      void raiseAlert({ key: 'ai-site:' + tenantId, what: 'The AI site builder failed — the template site is used instead', business: (state.input as any)?.businessName, detail: state.lastError || 'the last attempt stopped with its process', tenantId })
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
    void raiseAlert({ key: 'ai-site:' + tenantId, what: 'The AI site was not ready in time — the template site is used instead', business: (state.input as any)?.businessName, detail: `not ready after ${Math.round(waitMs / 1000)}s`, tenantId })
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
