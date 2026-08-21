/**
 * Nuclear cleanup path for test-only tenants. The "soft" /offboard endpoint
 * leaves a 30-day grace period and cancels Stripe at period-end — perfect
 * for real customers, useless for tests. This deletes everything immediately
 * and idempotently.
 *
 * SAFETY: refuses to touch any row where is_test_tenant !== true. The
 * `force` opt is for the 6h orphan cleanup cron (still requires the flag).
 * There is no escape hatch for real customers; they go through /offboard.
 */
import { supabase } from '../middleware/auth'
import { S3Client, ListBucketsCommand, ListObjectsV2Command, DeleteObjectsCommand, DeleteBucketCommand } from '@aws-sdk/client-s3'
import { deleteZone } from './cloudflare'
import { deleteDomainAuth as deleteSendGridAuth } from './sendgrid'
import factoryStripe from './factoryStripe'

const RENDER_API = 'https://api.render.com/v1'
function renderHeaders() {
  return {
    'Authorization': 'Bearer ' + (process.env.RENDER_API_KEY || ''),
    'Content-Type': 'application/json',
  }
}

export interface CleanupStep {
  step: string
  status: 'ok' | 'warning' | 'skipped' | 'error'
  detail?: string
}

export interface CleanupResult {
  tenantId: string
  slug: string
  steps: CleanupStep[]
  success: boolean  // true if no 'error' steps; warnings are OK
}

// Vertical-aware service-name suffix derivation. Mirrors deploy.ts:763 and
// :928 so the names we look up here match what the deploy actually created.
function deriveServiceNames(slug: string, industry: string | null | undefined): string[] {
  const i = (industry || '').toLowerCase()
  const isHomeCare = i === 'home_care' || i === 'homecare' || i === 'in_home_care' || i === 'senior_care'
  const isFieldService = i === 'field_service' || i === 'hvac' || i === 'plumbing' || i === 'electrical'
  const isAutomotive = i === 'automotive'
  const isRoofing = i === 'roofing' || i === 'roof'
  const isLandscaping = i === 'landscaping' || i === 'lawn_care' || i === 'lawncare'
  const isDispensary = i === 'dispensary' || i === 'cannabis'
  const isRv = i === 'rv' || i === 'rv_dealer' || i === 'rv_dealership' || i === 'rv_sales' || i === 'powersports' || i === 'motorcycle_dealer' || i === 'atv_dealer' || i === 'utv_dealer' || i === 'boat_dealer' || i === 'marine_dealer' || i === 'motorhome'
  const isVet = i === 'veterinary' || i === 'veterinarian' || i === 'vet' || i === 'vet_clinic' || i === 'vet_hospital' || i === 'animal_hospital' || i === 'animal_clinic' || i === 'pet_clinic' || i === 'pet_hospital' || i === 'mobile_vet'
  const isSalon = i === 'salon' || i === 'hair_salon' || i === 'barber' || i === 'barbershop' || i === 'nail_salon' || i === 'spa' || i === 'day_spa' || i === 'med_spa' || i === 'beauty' || i === 'beauty_salon' || i === 'esthetician' || i === 'lash' || i === 'brow_bar' || i === 'waxing'
  const isStore = i === 'store' || i === 'retail' || i === 'ecommerce' || i === 'e_commerce' || i === 'online_store' || i === 'online_shop' || i === 'shop' || i === 'boutique' || i === 'storefront'

  const suffix =
    isHomeCare ? '-care' :
    isFieldService ? '-wrench' :
    isAutomotive ? '-drive' :
    isRoofing ? '-roof' :
    isLandscaping ? '-landscape' :
    isDispensary ? '-leaf' :
    isRv ? '-rv' :
    isVet ? '-vet' :
    isSalon ? '-salon' :
    isStore ? '-shop' :
    ''

  // We don't know which exact vertical the deploy used (it's derived at
  // deploy time too) — generate all plausible candidates so cleanup
  // catches them all. Render returns 404 silently for non-existent IDs,
  // and we use name lookup so missing-name is also fine.
  const candidates = new Set<string>()
  candidates.add(slug)                       // generic web
  candidates.add(slug + '-api')              // generic backend
  candidates.add(slug + '-site')             // premium website service
  if (suffix) {
    candidates.add(slug + suffix)            // vertical-specific web
    candidates.add(slug + suffix + '-api')   // vertical-specific backend
  }
  // Always also try the vertical patterns we know exist, in case industry
  // was mis-classified or the deploy renamed something.
  for (const s of ['-care', '-wrench', '-roof', '-landscape', '-leaf', '-drive', '-rv', '-vet', '-salon', '-shop']) {
    candidates.add(slug + s)
    candidates.add(slug + s + '-api')
  }
  return Array.from(candidates)
}

async function deleteRenderServiceByName(name: string): Promise<{ deleted: boolean; reason?: string }> {
  if (!process.env.RENDER_API_KEY) return { deleted: false, reason: 'RENDER_API_KEY not set' }
  try {
    // Paginate through services to find the one matching this name.
    let cursor = ''
    for (let page = 0; page < 10; page++) {
      const url = RENDER_API + '/services?type=web_service,static_site&limit=100' + (cursor ? '&cursor=' + cursor : '')
      const res = await fetch(url, { headers: renderHeaders(), signal: AbortSignal.timeout(30_000) })
      if (!res.ok) return { deleted: false, reason: 'Render API HTTP ' + res.status }
      const list = await res.json() as any[]
      if (!list.length) return { deleted: false, reason: 'not found' }
      for (const item of list) {
        const svc = item.service || item
        if (svc.name === name) {
          const del = await fetch(RENDER_API + '/services/' + svc.id, { method: 'DELETE', headers: renderHeaders(), signal: AbortSignal.timeout(30_000) })
          if (!del.ok) return { deleted: false, reason: 'Render DELETE HTTP ' + del.status }
          return { deleted: true }
        }
      }
      cursor = list[list.length - 1]?.cursor || ''
      if (!cursor) return { deleted: false, reason: 'not found' }
    }
    return { deleted: false, reason: 'pagination exhausted' }
  } catch (e: any) {
    return { deleted: false, reason: e.message }
  }
}

async function deleteRenderPostgresByName(name: string): Promise<{ deleted: boolean; reason?: string }> {
  if (!process.env.RENDER_API_KEY) return { deleted: false, reason: 'RENDER_API_KEY not set' }
  try {
    // Postgres has a separate list endpoint.
    const res = await fetch(RENDER_API + '/postgres?limit=100', { headers: renderHeaders(), signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return { deleted: false, reason: 'Render postgres list HTTP ' + res.status }
    const list = await res.json() as any[]
    for (const item of list) {
      const db = item.postgres || item
      if (db.name === name) {
        const del = await fetch(RENDER_API + '/postgres/' + db.id, { method: 'DELETE', headers: renderHeaders(), signal: AbortSignal.timeout(30_000) })
        if (!del.ok) return { deleted: false, reason: 'Render postgres DELETE HTTP ' + del.status }
        return { deleted: true }
      }
    }
    return { deleted: false, reason: 'not found' }
  } catch (e: any) {
    return { deleted: false, reason: e.message }
  }
}

/**
 * Delete every R2 bucket belonging to a tenant.
 *
 * Matched by listing rather than by recomputing deploy.ts's vertical suffix
 * mapping (<slug>-care-media, <slug>-roof-media, <slug>-shop-media, ...). That
 * mapping already exists in two places; a third copy would drift, and a drifted
 * copy fails by silently leaving the bucket behind — exactly the bug this is
 * fixing. Matching on the slug boundary covers every suffix, present or future.
 */
async function deleteTenantR2Buckets(slug: string): Promise<{ deleted: string[]; failed: string[] }> {
  const out = { deleted: [] as string[], failed: [] as string[] }
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID) return out

  const s3 = new S3Client({
    region: 'auto',
    endpoint: 'https://' + process.env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })

  const all: any = await s3.send(new ListBucketsCommand({}))
  // The boundary matters: slug "zz-fleet" must not match "zz-fleet-two-media".
  const mine = (all.Buckets || [])
    .map((b: any) => String(b.Name))
    .filter((n: string) => n === slug + '-media' || (n.startsWith(slug + '-') && n.endsWith('-media')))

  for (const bucket of mine) {
    try {
      // A bucket has to be empty before it can be dropped.
      let token: string | undefined
      do {
        const page: any = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }))
        const objects = (page.Contents || []).map((o: any) => ({ Key: o.Key }))
        if (objects.length > 0) {
          await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }))
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (token)

      await s3.send(new DeleteBucketCommand({ Bucket: bucket }))
      out.deleted.push(bucket)
    } catch (e: any) {
      out.failed.push(bucket + ': ' + (e?.name || e?.message || 'unknown'))
    }
  }
  return out
}

export async function hardDeleteTestTenant(tenantId: string): Promise<CleanupResult> {
  const steps: CleanupStep[] = []
  // maybeSingle(), not single(): a tenant that's already gone (e.g. swept by the
  // orphan-cleanup cron, or a double-clicked teardown) returns 0 rows. single()
  // turns that into a cryptic "Cannot coerce the result to a single JSON object"
  // 500; maybeSingle() returns null so we can report it cleanly + idempotently.
  const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle()

  if (tenantErr) {
    return { tenantId, slug: 'unknown', steps: [{ step: 'lookup', status: 'error', detail: tenantErr.message }], success: false }
  }
  if (!tenant) {
    // Already deleted — treat as success so a retry after the cron wins doesn't 500.
    return { tenantId, slug: 'unknown', steps: [{ step: 'lookup', status: 'ok', detail: 'Tenant already gone (nothing to tear down).' }], success: true }
  }

  // ─── SAFETY GATE ─────────────────────────────────────────────────────
  if (!tenant.is_test_tenant) {
    return {
      tenantId,
      slug: tenant.slug,
      steps: [{ step: 'safety_check', status: 'error', detail: 'Tenant is not flagged is_test_tenant. Refusing to hard-delete. Use /offboard for real customers.' }],
      success: false,
    }
  }
  steps.push({ step: 'safety_check', status: 'ok', detail: 'is_test_tenant=true' })

  const slug = tenant.slug

  // ─── 1) Stripe: cancel subscription IMMEDIATELY (not at period end) ──
  if (tenant.stripe_subscription_id) {
    try {
      await factoryStripe.cancelSubscription(tenant.stripe_subscription_id, { atPeriodEnd: false })
      steps.push({ step: 'stripe_cancel', status: 'ok' })
    } catch (e: any) {
      steps.push({ step: 'stripe_cancel', status: 'warning', detail: e.message })
    }
  } else {
    steps.push({ step: 'stripe_cancel', status: 'skipped', detail: 'no subscription' })
  }

  // ─── 2) Render services (web + api, with vertical suffix variants) ──
  const serviceNames = deriveServiceNames(slug, tenant.industry)
  let serviceDeletedCount = 0
  let serviceTryCount = 0
  for (const name of serviceNames) {
    const result = await deleteRenderServiceByName(name)
    serviceTryCount++
    if (result.deleted) serviceDeletedCount++
  }
  steps.push({
    step: 'render_services',
    status: serviceDeletedCount > 0 ? 'ok' : 'skipped',
    detail: `${serviceDeletedCount}/${serviceTryCount} candidate names deleted`,
  })

  // ─── 3) Render Postgres (vertical-suffix DB + premium site DB) ────
  const dbCandidates = new Set<string>([slug + '-db', slug + '-site-db'])
  for (const s of ['-care', '-wrench', '-roof', '-landscape', '-leaf', '-drive', '-rv', '-vet', '-salon', '-shop']) {
    dbCandidates.add(slug + s + '-db')
  }
  let dbDeleted = 0
  for (const name of dbCandidates) {
    const r = await deleteRenderPostgresByName(name)
    if (r.deleted) dbDeleted++
  }
  steps.push({
    step: 'render_postgres',
    status: dbDeleted > 0 ? 'ok' : 'skipped',
    detail: `${dbDeleted} database(s) deleted`,
  })

  // ─── 3.5) GitHub repo ────────────────────────────────────────────────
  // Deleting the Render services leaves the repo behind, and a private repo
  // per throwaway tenant piles up quietly. deploy.ts names it <GITHUB_ORG>/<slug>;
  // tenants.github_repo holds the full name when the deploy recorded it.
  const repoFullName = tenant.github_repo
    || (process.env.GITHUB_ORG ? process.env.GITHUB_ORG + '/' + slug : null)
  if (repoFullName) {
    try {
      const { deleteGitHubRepo } = await import('./deploy')
      const deleted = await deleteGitHubRepo(repoFullName)
      steps.push({
        step: 'github_repo',
        // Already gone is a fine outcome for an idempotent teardown.
        status: deleted === false ? 'warning' : 'ok',
        detail: repoFullName + (deleted === false ? ' (not deleted — check the token has delete_repo scope)' : ''),
      })
    } catch (e: any) {
      steps.push({ step: 'github_repo', status: 'warning', detail: repoFullName + ': ' + e.message })
    }
  } else {
    steps.push({ step: 'github_repo', status: 'skipped', detail: 'no repo name and no GITHUB_ORG' })
  }

  // ─── 3.6) R2 bucket ──────────────────────────────────────────────────
  // Same story as the repo: deleting the services leaves the bucket, and one
  // per throwaway tenant piles up quietly.
  try {
    const buckets = await deleteTenantR2Buckets(slug)
    if (buckets.deleted.length === 0 && buckets.failed.length === 0) {
      steps.push({ step: 'r2_bucket', status: 'ok', detail: 'no buckets for this tenant' })
    } else {
      steps.push({
        step: 'r2_bucket',
        status: buckets.failed.length > 0 ? 'warning' : 'ok',
        detail: [buckets.deleted.join(', '), buckets.failed.join('; ')].filter(Boolean).join(' | '),
      })
    }
  } catch (e: any) {
    steps.push({ step: 'r2_bucket', status: 'warning', detail: e.message })
  }

  // ─── 4) Cloudflare zone (only if we created one) ─────────────────────
  if (tenant.cloudflare_zone_id) {
    try {
      await deleteZone(tenant.cloudflare_zone_id)
      steps.push({ step: 'cloudflare_zone', status: 'ok' })
    } catch (e: any) {
      steps.push({ step: 'cloudflare_zone', status: 'warning', detail: e.message })
    }
  } else {
    steps.push({ step: 'cloudflare_zone', status: 'skipped', detail: 'no zone' })
  }

  // ─── 5) SendGrid domain authentication ───────────────────────────────
  if (tenant.sendgrid_domain_auth_id) {
    try {
      await deleteSendGridAuth(tenant.sendgrid_domain_auth_id)
      steps.push({ step: 'sendgrid_domain_auth', status: 'ok' })
    } catch (e: any) {
      steps.push({ step: 'sendgrid_domain_auth', status: 'warning', detail: e.message })
    }
  } else {
    steps.push({ step: 'sendgrid_domain_auth', status: 'skipped', detail: 'no domain auth' })
  }

  // ─── 6) factory_jobs rows for this tenant ────────────────────────────
  try {
    const { error: jobErr, count } = await supabase.from('factory_jobs').delete({ count: 'exact' }).eq('tenant_id', tenantId)
    if (jobErr) {
      steps.push({ step: 'factory_jobs_delete', status: 'warning', detail: jobErr.message })
    } else {
      steps.push({ step: 'factory_jobs_delete', status: 'ok', detail: `${count ?? 0} rows` })
    }
  } catch (e: any) {
    steps.push({ step: 'factory_jobs_delete', status: 'warning', detail: e.message })
  }

  // ─── 7) intake_feedback rows for this tenant (best-effort) ───────────
  try {
    await supabase.from('intake_feedback').delete().eq('tenant_id', tenantId)
    steps.push({ step: 'intake_feedback_delete', status: 'ok' })
  } catch (e: any) {
    // Table may not exist in older deployments — non-fatal.
    steps.push({ step: 'intake_feedback_delete', status: 'skipped', detail: e.message })
  }

  // ─── 8) Tenant row itself (last, so all prior steps had context) ─────
  try {
    const { error: delErr } = await supabase.from('tenants').delete().eq('id', tenantId)
    if (delErr) {
      steps.push({ step: 'tenant_row_delete', status: 'error', detail: delErr.message })
    } else {
      steps.push({ step: 'tenant_row_delete', status: 'ok' })
    }
  } catch (e: any) {
    steps.push({ step: 'tenant_row_delete', status: 'error', detail: e.message })
  }

  const hasError = steps.some(s => s.status === 'error')
  return { tenantId, slug, steps, success: !hasError }
}

// Orphan sweep — finds test tenants older than `maxAgeMs` and hard-deletes
// them. Defaults to 6h. Designed to be triggered by the existing /cleanup
// cron path so a crashed test run can't leave Render services running.
export async function cleanupOrphanTestTenants(opts: { maxAgeMs?: number } = {}): Promise<{
  scanned: number
  deleted: number
  failed: number
  results: CleanupResult[]
}> {
  const maxAgeMs = opts.maxAgeMs ?? 6 * 60 * 60 * 1000  // 6 hours
  const threshold = new Date(Date.now() - maxAgeMs).toISOString()
  const { data: orphans, error } = await supabase.from('tenants')
    .select('id, slug, created_at')
    .eq('is_test_tenant', true)
    .lt('created_at', threshold)
  if (error) throw error
  const list = orphans || []
  const results: CleanupResult[] = []
  for (const o of list) {
    results.push(await hardDeleteTestTenant(o.id))
  }
  return {
    scanned: list.length,
    deleted: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  }
}
