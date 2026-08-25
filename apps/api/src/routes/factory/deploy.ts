import { supabase, requireRole } from '../../middleware/auth'
import { generate, cleanOldBuilds, type GenerateConfig } from '../../services/generator'
import { isConfigured, getMissingConfig, deployCustomer, checkDeployStatus, redeployCustomer, updateCustomerCode, updateRenderServiceSettings, findRenderServicesBySlug, wireDomainInfrastructure } from '../../services/deploy'
import factoryStripe from '../../services/factoryStripe'
import { getZipDownloadUrl } from '../../services/factoryStorage'
import { notifyDeployComplete, notifyDeployFailed, notifyStillWorking } from '../../services/email'
import fs from 'fs'
import path from 'path'
import { getProductDefaults } from '../../config/pricing'
import { hardDeleteTestTenant, cleanupOrphanTestTenants } from '../../services/testCleanup'
import { type FactoryApp, UUID_RE, checkCronSecret, secureEquals, logTenantAudit } from './shared'

export function registerDeployRoutes(factory: FactoryApp) {
factory.post('/customers/:id/deploy', requireRole('owner', 'admin'), async (c) => {
  try {
    if (!isConfigured()) {
      return c.json({ error: 'Deploy not configured', missing: getMissingConfig() }, 400)
    }

    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    console.log('[Deploy] Looking up tenant:', tenantId)

    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) {
      console.log('[Deploy] Tenant not found:', tenantErr?.message)
      return c.json({ error: tenantErr?.code === 'PGRST116' ? 'Tenant not found' : (tenantErr?.message || 'Tenant not found'), id: tenantId }, tenantErr && tenantErr.code !== 'PGRST116' ? 500 : 404)
    }

    console.log('[Deploy] Found tenant:', tenant.name, tenant.slug)

    // Get latest factory job for this tenant
    const { data: job, error: jobErr } = await supabase.from('factory_jobs').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!job) {
      console.log('[Deploy] No job found for tenant:', jobErr?.message)
      return c.json({ error: 'No build found. Generate a package first.' }, 400)
    }

    console.log('[Deploy] Found job:', job.id, 'status:', job.status, 'zip:', job.zip_name)

    // Check if a deploy is already in progress for this tenant
    const { data: activeJobs } = await supabase.from('factory_jobs').select('id').eq('tenant_id', tenant.id).eq('status', 'deploying')
    if (activeJobs?.length) {
      return c.json({ error: 'A deployment is already in progress for this tenant' }, 409)
    }

    // Parse deploy options from request body
    const body = await c.req.json().catch(() => ({}))
    const deployOptions = { region: body.region, plan: body.plan, dbPlan: body.dbPlan }

    // Update status to deploying
    const { error: statusErr } = await supabase.from('factory_jobs').update({ status: 'deploying' }).eq('id', job.id)
    if (statusErr) {
      console.error('[Deploy] Failed to set deploying status:', statusErr.message)
      return c.json({ error: 'Failed to update job status' }, 500)
    }

    // Run deploy in background
    runDeploy(tenant, job, deployOptions).catch(err => console.error('[Deploy] Background error:', err.message))

    return c.json({ success: true, message: 'Deployment started', status: 'deploying' })
  } catch (err: any) {
    console.error('[Deploy] endpoint error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// ─── Deploy Status ────────────────────────────────────────────────────────────
factory.get('/customers/:id/deploy/status', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
  const { data: job } = await supabase.from('factory_jobs').select('*').eq('tenant_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!job) return c.json({ status: 'not_deployed', services: {} })
  const serviceIds = job.render_service_ids
  if (!serviceIds || Object.keys(serviceIds).length === 0) {
    return c.json({ status: job.status, services: {} })
  }
  const result = await checkDeployStatus({ renderServiceIds: serviceIds })
  return c.json(result)
})


// ─── Deploy Status SSE ───────────────────────────────────────────────────────
factory.get('/customers/:id/deploy/stream', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)

  // Auth via query param (EventSource can't send headers)
  const token = c.req.query('token')
  if (token) {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return c.json({ error: 'Unauthorized' }, 401)
  } else {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return new Response(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const send = (data: any) => {
          try { controller.enqueue(encoder.encode('data: ' + JSON.stringify(data) + '\n\n')) } catch (_e) { /* closed */ }
        }

        let done = false
        for (let tick = 0; tick < 120 && !done; tick++) {
          const { data: job } = await supabase.from('factory_jobs').select('status, render_service_ids, github_repo, render_url')
            .eq('tenant_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()

          if (!job) { send({ status: 'not_found' }); break }

          if (job.status === 'deploying' && job.render_service_ids) {
            const liveStatus = await checkDeployStatus({ renderServiceIds: job.render_service_ids })
            send({ status: 'deploying', jobStatus: job.status, services: liveStatus.services, overallStatus: liveStatus.overallStatus, repoUrl: job.github_repo, deployedUrl: job.render_url })
            if (liveStatus.overallStatus === 'live') done = true
          } else if (job.status === 'complete' || job.status === 'failed') {
            send({ status: job.status, repoUrl: job.github_repo, deployedUrl: job.render_url })
            done = true
          } else {
            send({ status: job.status })
          }

          if (!done) await new Promise(r => setTimeout(r, 10000))
        }

        send({ status: 'stream_end' })
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } }
  )
})


// ─── Flip website → CRM ───────────────────────────────────────────────────────
// Deploy a website-only tenant's crm-rv and copy the site's inventory into it.
// Long-running (deploys a CRM + DB ~10min), so it runs in the background; the
// caller polls the tenant (products gains 'crm' when done).
factory.post('/customers/:id/flip-to-crm', requireRole('owner', 'admin'), async (c) => {
  const tenantId = c.req.param('id')
  if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
  const { data: tenant } = await supabase.from('tenants').select('id, slug, products, industry').eq('id', tenantId).maybeSingle()
  if (!tenant) return c.json({ error: 'Tenant not found' }, 404)
  const products: string[] = tenant.products || []
  if (!products.some((p: string) => p === 'website' || p.startsWith('website'))) return c.json({ error: 'Tenant has no website to flip' }, 400)
  if (products.some((p: string) => p === 'crm' || p.startsWith('crm-'))) return c.json({ error: 'Tenant already has a CRM' }, 409)
  if (!tenant.industry) return c.json({ error: 'Tenant has no industry set' }, 400)

  const { flipWebsiteToCrm } = await import('../../services/flipWebsiteToCrm')
  flipWebsiteToCrm(tenantId)
    .then((r) => console.log('[Flip] Result for', tenantId, ':', JSON.stringify(r)))
    .catch((e: any) => console.error('[Flip] Background flip threw:', e?.message))

  return c.json({ started: true, message: 'Flipping to CRM — deploying the CRM and copying inventory. This takes ~10 minutes; the tenant will show the CRM product when done.' })
})

// ─── Redeploy ─────────────────────────────────────────────────────────────────
factory.post('/customers/:id/redeploy', requireRole('owner', 'admin'), async (c) => {
  if (!isConfigured()) return c.json({ error: 'Deploy not configured' }, 400)
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)

  const { data: tenant } = await supabase.from('tenants').select('slug').eq('id', id).maybeSingle()
  const { data: job } = await supabase.from('factory_jobs').select('*').eq('tenant_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!job) return c.json({ error: 'No deployed services found' }, 400)

  let serviceIds = job.render_service_ids
  // Fallback: look up services on Render by tenant slug if IDs weren't saved
  if ((!serviceIds || Object.keys(serviceIds).length === 0) && tenant?.slug) {
    console.log('[Redeploy] No stored service IDs, looking up by slug:', tenant.slug)
    serviceIds = await findRenderServicesBySlug(tenant.slug)
    // Save discovered IDs back to the job for next time
    if (Object.keys(serviceIds).length > 0) {
      await supabase.from('factory_jobs').update({ render_service_ids: serviceIds }).eq('id', job.id)
    }
  }

  if (!serviceIds || Object.keys(serviceIds).length === 0) {
    return c.json({ error: 'No Render services found for this customer.' }, 400)
  }
  const result = await redeployCustomer({ renderServiceIds: serviceIds })
  return c.json(result)
})


// ─── Update Code (safe — no data loss) ──────────────────────────────────────
// Regenerates code from template and pushes to existing repo + redeploys.
// Does NOT touch the database, does NOT recreate services.
factory.post('/customers/:id/update-code', requireRole('owner', 'admin'), async (c) => {
  if (!isConfigured()) return c.json({ error: 'Deploy not configured' }, 400)
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)

  const { data: tenant } = await supabase.from('tenants').select('*').eq('id', id).single()
  if (!tenant) return c.json({ error: 'Tenant not found' }, 404)

  const { data: job } = await supabase.from('factory_jobs').select('*').eq('tenant_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()

  // Get service IDs for redeploy trigger
  let serviceIds = job?.render_service_ids || {}
  if (Object.keys(serviceIds).length === 0 && tenant.slug) {
    serviceIds = await findRenderServicesBySlug(tenant.slug)
  }

  // Regenerate the code from template using existing config
  const config = (tenant.config || job?.config || {}) as GenerateConfig
  const { zipPath } = await generate(config)

  // Push code update — safe, no destructive operations
  const result = await updateCustomerCode(
    { id: tenant.id, slug: tenant.slug, name: tenant.name, renderServiceIds: serviceIds },
    zipPath,
  )

  // Cleanup zip
  try { fs.unlinkSync(zipPath) } catch {}

  return c.json(result)
})

// ─── Update Service Settings ─────────────────────────────────────────────────
factory.patch('/customers/:id/service/:role', requireRole('owner', 'admin'), async (c) => {
  if (!isConfigured()) return c.json({ error: 'Deploy not configured' }, 400)
  const id = c.req.param('id')
  const role = c.req.param('role') // 'frontend', 'backend', 'site'
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
  const { data: job } = await supabase.from('factory_jobs').select('*').eq('tenant_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!job) return c.json({ error: 'No deployed services found' }, 400)
  const serviceId = job.render_service_ids?.[role]
  if (!serviceId) return c.json({ error: 'No service ID for role: ' + role }, 400)
  const body = await c.req.json() as { rootDir?: string; buildCommand?: string; startCommand?: string; publishPath?: string; redeploy?: boolean }
  const ok = await updateRenderServiceSettings(serviceId, body)
  if (!ok) return c.json({ error: 'Failed to update service' }, 500)
  if (body.redeploy) {
    const { redeployCustomer } = await import('../../services/deploy')
    await redeployCustomer({ renderServiceIds: { [role]: serviceId } })
  }
  return c.json({ success: true, serviceId, updated: Object.keys(body).filter(k => k !== 'redeploy') })
})

// ─── Cleanup ──────────────────────────────────────────────────────────────────
// ─── Test-tenant cleanup ─────────────────────────────────────────────────
// Hard-delete a single test tenant — Render services, Render DB, Cloudflare
// zone, Stripe sub, Supabase row, etc. Refuses on real customers (the
// is_test_tenant flag is the gate, enforced inside hardDeleteTestTenant).
factory.post('/test/cleanup-tenant/:id', requireRole('owner', 'admin'), async (c) => {
  const tenantId = c.req.param('id')
  if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID' }, 400)
  const result = await hardDeleteTestTenant(tenantId)
  return c.json(result, result.success ? 200 : 500)
})

// Cron-triggered orphan sweep. Finds test tenants older than `maxAgeHours`
// (default 6h) and hard-deletes them. Catches the case where a test run
// crashes before its in-script cleanup fires.
factory.post('/test/cleanup-orphans', async (c) => {
  if (!checkCronSecret(c)) {
    return c.json({ error: 'Invalid cron secret' }, 401)
  }
  const body = await c.req.json().catch(() => ({})) as { maxAgeHours?: number }
  const maxAgeMs = (body.maxAgeHours ?? 6) * 60 * 60 * 1000
  const summary = await cleanupOrphanTestTenants({ maxAgeMs })
  console.log('[Test cleanup] Scanned', summary.scanned, 'orphans, deleted', summary.deleted, 'failed', summary.failed)
  return c.json(summary)
})

factory.post('/cleanup', async (c) => {
  // Auth: require CRON_SECRET header or valid Supabase session
  const cronSecret = c.req.header('x-cron-secret')
  const authHeader = c.req.header('Authorization')
  if (cronSecret) {
    if (!secureEquals(cronSecret, process.env.CRON_SECRET || '')) return c.json({ error: 'Invalid cron secret' }, 401)
  } else if (authHeader) {
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401)
  } else {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const { maxAge } = await c.req.json().catch(() => ({}))
  const cleaned = cleanOldBuilds(maxAge || 24 * 60 * 60 * 1000)

  // Reset stale "deploying" jobs (stuck for >30 minutes)
  const staleThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { data: staleJobs } = await supabase.from('factory_jobs')
    .select('id')
    .eq('status', 'deploying')
    .lt('created_at', staleThreshold)
  let resetCount = 0
  if (staleJobs?.length) {
    const ids = staleJobs.map((j: any) => j.id)
    await supabase.from('factory_jobs').update({ status: 'failed' }).in('id', ids)
    resetCount = ids.length
    console.log('[Cleanup] Reset', resetCount, 'stale deploying jobs')
  }

  // Clean up orphaned DB records whose zip files no longer exist
  const jobMaxAge = maxAge || 24 * 60 * 60 * 1000
  const jobThreshold = new Date(Date.now() - jobMaxAge).toISOString()
  const { data: oldJobs } = await supabase.from('factory_jobs')
    .select('id')
    .in('status', ['complete', 'failed'])
    .lt('created_at', jobThreshold)
  let deletedJobs = 0
  if (oldJobs?.length) {
    const ids = oldJobs.map((j: any) => j.id)
    await supabase.from('factory_jobs').delete().in('id', ids)
    deletedJobs = ids.length
    console.log('[Cleanup] Deleted', deletedJobs, 'old job records')
  }

  return c.json({ cleaned, staleJobsReset: resetCount, oldJobsDeleted: deletedJobs, message: 'Removed ' + cleaned + ' old builds, reset ' + resetCount + ' stale jobs, deleted ' + deletedJobs + ' old job records' })
})


// ─── Regenerate ──────────────────────────────────────────────────────────────
factory.post('/customers/:id/regenerate', requireRole('owner', 'admin', 'editor'), async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: tenantErr?.message || 'Tenant not found' }, tenantErr && tenantErr.code !== 'PGRST116' ? 500 : 404)

    const { data: job } = await supabase.from('factory_jobs').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!job) return c.json({ error: 'No previous build found. Generate a package first.' }, 400)

    const config: GenerateConfig = job.config || buildConfigFromTenantAndJob(tenant, job)

    console.log('[Factory] Regenerating for', tenant.slug)
    const result = await generate(config)

    const jobRecord: Record<string, any> = {
      tenant_id: tenantId,
      template: job.template,
      deployment_model: 'owned',
      status: 'pending',
      features: job.features || [],
      branding: job.branding,
      build_id: result.buildId,
      zip_name: result.zipName,
    }
    const { error: insertErr } = await supabase.from('factory_jobs').insert({ ...jobRecord, config })
    if (insertErr) {
      console.error('[Factory] Regenerate job insert error:', insertErr.message, insertErr.code)
      if (insertErr.code === '42703') {
        const { error: fallbackErr } = await supabase.from('factory_jobs').insert(jobRecord)
        if (fallbackErr) console.error('[Factory] Regenerate job fallback error:', fallbackErr.message, fallbackErr.code)
      }
    }

    // If deploy is configured, auto-deploy
    if (isConfigured()) {
      // Reset any stale "deploying" jobs for this tenant (stuck > 5 min) so they don't block
      await supabase.from('factory_jobs')
        .update({ status: 'failed' })
        .eq('tenant_id', tenantId)
        .eq('status', 'deploying')
        .lt('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())

      const { data: freshJob } = await supabase.from('factory_jobs').select('*').eq('build_id', result.buildId).maybeSingle()
      if (freshJob && freshJob.status !== 'deploying') {
        const { error: deployStatusErr } = await supabase.from('factory_jobs').update({ status: 'deploying' }).eq('id', freshJob.id)
        if (deployStatusErr) console.error('[Deploy] Failed to set deploying status:', deployStatusErr.message)
        else runDeploy(tenant, freshJob).catch(err => console.error('[Deploy] Background error:', err.message))
      }
    }

    return c.json({ success: true, buildId: result.buildId, zipName: result.zipName, message: 'Regenerated and deploying' })
  } catch (err: any) {
    console.error('[Factory] Regenerate failed:', err)
    return c.json({ error: err.message }, 500)
  }
})


// ─── Resync shared code (tenant-ui + tenant-backend) ────────────────────────
// Pushes the latest packages/tenant-ui + packages/tenant-backend into an
// existing tenant's repo so they pick up bug fixes to shared components.
// For V1 this re-runs the full generate + push pipeline (the generator always
// vendors shared code under src/shared/). A future optimization could diff
// only src/shared/ to avoid churn on unchanged template files.
factory.post('/customers/:id/resync-shared-code', requireRole('owner', 'admin'), async (c) => {
  if (!isConfigured()) return c.json({ error: 'Deploy not configured' }, 400)
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)

    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: tenantErr?.message || 'Tenant not found' }, tenantErr && tenantErr.code !== 'PGRST116' ? 500 : 404)

    const { data: job } = await supabase.from('factory_jobs').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!job) return c.json({ error: 'No previous build found for this tenant.' }, 400)

    let serviceIds = job?.render_service_ids || {}
    if (Object.keys(serviceIds).length === 0 && tenant.slug) {
      serviceIds = await findRenderServicesBySlug(tenant.slug)
    }

    const config = (job.config || tenant.config || buildConfigFromTenantAndJob(tenant, job)) as GenerateConfig
    console.log('[Factory] Resync-shared-code regenerating for', tenant.slug)
    const { zipPath } = await generate(config)

    const result = await updateCustomerCode(
      { id: tenant.id, slug: tenant.slug, name: tenant.name, renderServiceIds: serviceIds },
      zipPath,
    )

    try { fs.unlinkSync(zipPath) } catch {}

    return c.json({ success: result.success, steps: result.steps, errors: result.errors })
  } catch (err: any) {
    console.error('[Factory] Resync shared code failed:', err)
    return c.json({ error: err.message }, 500)
  }
})
}

function buildConfigFromTenantAndJob(tenant: any, job: any): GenerateConfig {
  return {
    tenant_id: tenant.id,
    products: (job.template?.split('+') || tenant.products || ['crm']).map((p: string) => p.toLowerCase()),
    company: {
      name: tenant.name,
      email: tenant.email || undefined,
      adminEmail: tenant.admin_email || undefined,
      phone: tenant.phone || undefined,
      address: tenant.address || undefined,
      city: tenant.city || undefined,
      state: tenant.state || undefined,
      zip: tenant.zip || undefined,
      domain: tenant.domain || undefined,
      industry: tenant.industry || undefined,
      plan: tenant.plan || 'starter',
      defaultPassword: tenant.admin_password || undefined,
      siteUrl: tenant.website_url || undefined,
    },
    branding: job.branding || {
      primaryColor: tenant.primary_color || '#f97316',
      secondaryColor: tenant.secondary_color || '#1e3a5f',
    },
    features: {
      crm: tenant.features || job.features || [],
    },
  } as GenerateConfig
}

export async function runDeploy(tenant: any, job: any, options: { region?: string; plan?: string; dbPlan?: string } = {}) {
  // Fire a "still working" email if the deploy hasn't completed in 15 minutes.
  // Cleared on every exit path so we never double-send.
  const stillWorkingTimer = setTimeout(() => {
    notifyStillWorking(tenant).catch(e => console.warn('[Email] Still-working notification failed:', e.message))
  }, 15 * 60 * 1000)
  try {
    // Use stored config if available, otherwise reconstruct from tenant + job
    const config: GenerateConfig = job.config || buildConfigFromTenantAndJob(tenant, job)

    // Always override features with the latest from the tenant record —
    // job.config may have stale features from a previous generation
    if (tenant.features?.length) {
      config.features = { ...config.features, crm: tenant.features }
    }

    // Store storefront content: website-store otherwise deploys the template's
    // skeleton copy ("Quality products, delivered"). Compose real content
    // (hero, product categories, on-theme imagery) from the intake so the
    // deployed storefront matches the brand. Non-blocking — a compose failure
    // deploys the skeleton rather than failing the whole deploy.
    try {
      const { verticalFor } = await import('../../config/industryRouting')
      const wantsWebsite = (config.products || []).includes('website')
      if (verticalFor(tenant.industry) === 'store' && wantsWebsite && !config.content?.aiGenerated) {
        const intake = tenant.intake_data?.intake || {}
        const { generateWebsiteContent } = await import('../../services/contentGenerator')
        const aiGenerated = await generateWebsiteContent({
          businessName: tenant.name,
          businessType: tenant.industry,
          location: { city: tenant.city || intake.city || '', state: tenant.state || intake.state || '', stateFull: intake.stateFull || '' },
          services: Array.isArray(intake.services) ? intake.services : [],
          description: intake.description || tenant.notes || '',
          serviceRegion: intake.serviceRegion,
          nearbyCities: intake.nearbyCities || [],
          phone: tenant.phone || intake.phone,
          email: tenant.admin_email || tenant.email,
          ownerName: intake.ownerName,
          domain: tenant.domain || undefined,
        })
        config.content = { ...config.content, aiGenerated }
        console.log('[Deploy] Composed store storefront content for', tenant.slug)
      }
    } catch (e: any) {
      console.warn('[Deploy] Store content compose failed (non-blocking, deploying skeleton):', e?.message)
    }

    console.log('[Deploy] Regenerating fresh zip for', tenant.slug)
    const genResult = await generate(config)
    const OUTPUT_DIR = process.env.FACTORY_OUTPUT_DIR || path.resolve(process.cwd(), '..', '..', 'generated')
    const zipPath = path.join(OUTPUT_DIR, genResult.zipName)
    if (!fs.existsSync(zipPath)) throw new Error('Regenerated zip not found at ' + zipPath)

    console.log('[Deploy] Using freshly generated zip:', zipPath)

    const result = await deployCustomer(
      { id: tenant.id, slug: tenant.slug, name: tenant.name, industry: tenant.industry, products: job.template?.split('+') || ['crm'], config: config, planId: tenant.plan },
      zipPath, options
    )

    console.log('[Deploy] Result steps:', JSON.stringify(result.steps))
    console.log('[Deploy] Errors:', JSON.stringify(result.errors))

    // Build render_service_ids map from deploy result
    const renderServiceIds: Record<string, string> = {}
    if (result.services.backend?.id) renderServiceIds.backend = result.services.backend.id
    if (result.services.frontend?.id) renderServiceIds.frontend = result.services.frontend.id
    if (result.services.site?.id) renderServiceIds.site = result.services.site.id
    if (result.services.database?.id) renderServiceIds.database = result.services.database.id
    if (result.services.vision?.id) renderServiceIds.vision = result.services.vision.id

    const jobUpdate: Record<string, any> = {
      status: result.success ? 'complete' : 'failed',
      github_repo: result.repoUrl || null,
      render_url: result.deployedUrl || result.siteUrl || result.visionUrl || null,
    }
    if (Object.keys(renderServiceIds).length > 0) jobUpdate.render_service_ids = renderServiceIds

    const { error: updateErr } = await supabase.from('factory_jobs').update(jobUpdate).eq('id', job.id)
    if (updateErr) {
      console.error('[Deploy] Job update error:', updateErr.message, updateErr.code)
      // If render_service_ids column doesn't exist, retry without it
      if (updateErr.code === '42703') {
        delete jobUpdate.render_service_ids
        const { error: retryErr } = await supabase.from('factory_jobs').update(jobUpdate).eq('id', job.id)
        if (retryErr) console.error('[Deploy] Job update retry also failed:', retryErr.message)
      }
    }

    if (result.repoUrl) {
      // Critical fields — must be saved even if optional columns fail
      const criticalUpdate: Record<string, any> = { status: 'active' }
      if (result.deployedUrl) criticalUpdate.render_frontend_url = result.deployedUrl
      if (result.apiUrl) criticalUpdate.render_backend_url = result.apiUrl
      if (result.supabaseProjectRef) criticalUpdate.supabase_project_ref = result.supabaseProjectRef
      if (result.dbConnectionString) criticalUpdate.database_url = result.dbConnectionString
      if (result.factorySyncKey) criticalUpdate.factory_sync_key = result.factorySyncKey
      // Plaintext passwords are never persisted (see scrub below) — the CRM DB
      // holds the bcrypt hash, and recovery goes through each app's Forgot
      // password flow, not the platform UI.
      // Same for admin_email — fall back to email if admin_email isn't already set.
      if (!tenant.admin_email && tenant.email) {
        criticalUpdate.admin_email = tenant.email
      }

      const { error: criticalErr } = await supabase.from('tenants').update(criticalUpdate).eq('id', tenant.id)
      if (criticalErr) {
        console.error('[Deploy] CRITICAL tenant update failed:', criticalErr.message, JSON.stringify(criticalUpdate))
      } else {
        console.log('[Deploy] Critical tenant fields saved (status, urls, database_url) for', tenant.slug)
        // Audit log for deploy — mask sensitive fields
        const auditChanges: Record<string, { old: any; new: any }> = {}
        if (criticalUpdate.status) auditChanges.status = { old: tenant.status, new: criticalUpdate.status }
        if (criticalUpdate.render_frontend_url) auditChanges.render_frontend_url = { old: tenant.render_frontend_url || null, new: criticalUpdate.render_frontend_url }
        if (criticalUpdate.render_backend_url) auditChanges.render_backend_url = { old: tenant.render_backend_url || null, new: criticalUpdate.render_backend_url }
        if (criticalUpdate.database_url) auditChanges.database_url = { old: tenant.database_url ? '***masked***' : null, new: '***masked***' }
        await logTenantAudit(tenant.id, 'deploy', auditChanges, 'system', `Deploy completed for ${tenant.slug}`)
      }

      // Sync features from config to tenant record so Feature Management shows correct state
      const deployedFeatures = config.features?.crm || job.features || []
      if (deployedFeatures.length > 0) {
        const { error: featErr } = await supabase.from('tenants').update({ features: deployedFeatures }).eq('id', tenant.id)
        if (featErr) console.warn('[Deploy] Features sync failed (non-blocking):', featErr.message)
        else console.log('[Deploy] Synced', deployedFeatures.length, 'features to tenant record for', tenant.slug)
      }

      // Sync features to the running CRM via HTTP API
      const syncKey = result.factorySyncKey || tenant.factory_sync_key
      const backendUrl = result.apiUrl || tenant.render_backend_url
      if (syncKey && backendUrl && deployedFeatures.length > 0) {
        try {
          const syncUrl = backendUrl.replace(/\/$/, '') + '/api/internal/sync-features'
          const syncRes = await fetch(syncUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Factory-Key': syncKey },
            body: JSON.stringify({ features: deployedFeatures }),
          })
          if (syncRes.ok) {
            console.log('[Deploy] Synced features to running CRM for', tenant.slug)
          } else {
            console.warn('[Deploy] CRM feature sync HTTP failed:', syncRes.status)
          }
        } catch (syncErr: any) {
          console.warn('[Deploy] CRM feature sync failed (CRM may still be starting):', syncErr.message)
        }
      }

      // Optional fields — save separately so a missing column doesn't block critical data
      const optionalUpdate: Record<string, any> = {}
      if (result.siteUrl) optionalUpdate.website_url = result.siteUrl
      if (result.adsUrl) optionalUpdate.ads_url = result.adsUrl
      if (result.r2BucketName) optionalUpdate.r2_bucket_name = result.r2BucketName

      if (Object.keys(optionalUpdate).length > 0) {
        const { error: optErr } = await supabase.from('tenants').update(optionalUpdate).eq('id', tenant.id)
        if (optErr) console.warn('[Deploy] Optional tenant fields failed (non-blocking):', optErr.message)
      }

      // NOTE (pay-then-deploy, 2026-07): deploys must NEVER create billing.
      // The legacy block here auto-created a Stripe subscription for any SaaS
      // tenant without one — correct under the old "deploy on signup, bill
      // automatically" trial model, but under pay-then-deploy every real
      // customer already HAS a subscription (checkout completed before the
      // deploy fired), so the only tenants this could hit are unpaid ones:
      // staff/manual deploys and comp/test tenants — where it minted phantom
      // live-mode subscriptions. Billing state is owned exclusively by the
      // Stripe webhook (checkout.session.completed) and admin billing actions.
    }

    console.log('[Deploy] Complete for', tenant.slug, '- status:', result.status)

    // ─── Domain infrastructure wiring (non-fatal) ───────────────────────────
    // Runs after Render services are known. Creates Cloudflare zone, writes
    // DNS/SPF/DMARC/SendGrid auth records, enables Email Routing, attaches
    // custom domains to Render. Failures here don't kill the deploy — admin
    // can re-trigger via /customers/:id/domain once the issue is resolved.
    if (tenant.domain && result.success) {
      try {
        const domainResult = await wireDomainInfrastructure({
          domain: tenant.domain,
          backendSlug: result.services.backend?.slug,
          siteSlug: result.services.site?.slug,
          backendServiceId: result.services.backend?.id,
          siteServiceId: result.services.site?.id,
          adminEmailForDmarc: tenant.admin_email || tenant.email,
          existingCloudflareZoneId: tenant.cloudflare_zone_id || undefined,
          existingSendgridDomainAuthId: tenant.sendgrid_domain_auth_id || undefined,
        })
        // Persist zone id + sendgrid auth id even on partial failure so reruns can reuse
        const domainUpdate: Record<string, any> = {}
        if (domainResult.cloudflareZoneId) domainUpdate.cloudflare_zone_id = domainResult.cloudflareZoneId
        if (domainResult.sendgridDomainAuthId) domainUpdate.sendgrid_domain_auth_id = domainResult.sendgridDomainAuthId
        if (Object.keys(domainUpdate).length > 0) {
          const { error } = await supabase.from('tenants').update(domainUpdate).eq('id', tenant.id)
          if (error && error.code !== '42703') console.warn('[Deploy] Domain infra id persist failed:', error.message)
        }
        console.log('[Deploy] Domain infra:', domainResult.success ? 'OK' : 'partial', 'steps=' + domainResult.steps.length, 'errors=' + domainResult.errors.length)
        if (domainResult.errors.length) console.warn('[Deploy] Domain infra errors:', domainResult.errors.join('; '))
      } catch (domErr: any) {
        console.error('[Deploy] Domain infra wiring threw:', domErr.message)
      }
    }

    // ─── Twomiah subdomain auto-attach (non-fatal) ─────────────────────────
    // Every premium tenant gets a free <slug>.twomiah.app URL alongside any
    // BYOD domain they brought. Works whether or not tenant.domain is set
    // because we control the twomiah.app zone end-to-end. Safe to re-run on
    // redeploy — the Cloudflare helper checks for an existing CNAME with the
    // same target and skips when it matches. The DB update is wrapped in a
    // 42703 check so it works on factories whose tenants table hasn't yet
    // had the twomiah_subdomain column migration applied.
    let twomiahSubdomainUrl: string | null = null
    if (result.success && result.services.site?.id) {
      try {
        const { attachTwomiahSubdomain } = await import('../../services/deploy')
        const siteHost = (result.services.site as any).host || (result.services.site?.slug ? result.services.site.slug + '.onrender.com' : null)
        if (siteHost) {
          const attached = await attachTwomiahSubdomain({
            slug: tenant.slug,
            websiteServiceId: result.services.site.id,
            websiteRenderHost: siteHost,
          })
          if (attached.subdomain) {
            twomiahSubdomainUrl = attached.subdomain
            const { error: subErr } = await supabase
              .from('tenants')
              .update({ twomiah_subdomain: attached.subdomain })
              .eq('id', tenant.id)
            if (subErr && subErr.code !== '42703') console.warn('[Deploy] twomiah_subdomain persist failed:', subErr.message)
            console.log('[Deploy] Twomiah subdomain attached:', attached.subdomain)
          } else if (attached.error) {
            console.warn('[Deploy] Twomiah subdomain skipped:', attached.error)
          }
        }
      } catch (subErr: any) {
        console.error('[Deploy] Twomiah subdomain attach threw:', subErr.message)
      }
    }

    // Send email notification — send credentials email even on partial success if CRM is reachable
    clearTimeout(stillWorkingTimer)
    if (result.success || result.deployedUrl || result.apiUrl) {
      // Merge in the premium-site admin password (generated by deploy.ts
      // when isPremiumSite). For CRM-only deploys this stays undefined
      // and notifyDeployComplete uses the existing tenant.admin_password.
      // twomiahSubdomain flows into the notification so the Ready email can
      // surface the friendly URL alongside the Render-provided one.
      // No password in the email payload — the ready email points at the signup
      // password / Forgot-password flow instead of carrying a credential.
      const emailTenant = { ...tenant, admin_password: undefined, twomiah_subdomain: twomiahSubdomainUrl ?? tenant.twomiah_subdomain }
      notifyDeployComplete(emailTenant, { apiUrl: result.apiUrl, deployedUrl: result.deployedUrl, siteUrl: result.siteUrl, repoUrl: result.repoUrl, adsUrl: result.adsUrl, twomiahSubdomain: twomiahSubdomainUrl ?? undefined }).catch(e => console.warn('[Email] Deploy complete notification failed:', e.message))

      // Scrub plaintext credentials now that seeding is done: the CRM DB holds
      // the bcrypt hash, so the factory keeps no copy at rest — not on the
      // tenant row, not inside the job's stored GenerateConfig.
      const { error: scrubErr } = await supabase.from('tenants').update({ admin_password: null }).eq('id', tenant.id)
      if (scrubErr) console.warn('[Deploy] admin_password scrub failed (non-blocking):', scrubErr.message)
      try {
        if (job.config?.company?.defaultPassword) {
          const scrubbedConfig = { ...job.config, company: { ...job.config.company, defaultPassword: undefined } }
          const { error: cfgErr } = await supabase.from('factory_jobs').update({ config: scrubbedConfig }).eq('id', job.id)
          if (cfgErr) console.warn('[Deploy] job config password scrub failed (non-blocking):', cfgErr.message)
        }
      } catch (e: any) { console.warn('[Deploy] job config scrub failed (non-blocking):', e?.message) }
    } else {
      // Without this the tenant row stays 'deploying' forever — runDeploy never
      // rethrows, so callers' rejection handlers can't do it for us.
      const { error: statusErr } = await supabase.from('tenants').update({ status: 'deploy_failed' }).eq('id', tenant.id)
      if (statusErr) console.error('[Deploy] Failed to mark tenant deploy_failed:', statusErr.message)
      notifyDeployFailed(tenant, result.errors.join('; ') || 'Unknown error').catch(e => console.warn('[Email] Deploy failed notification failed:', e.message))
    }
  } catch (err: any) {
    clearTimeout(stillWorkingTimer)
    console.error('[Deploy] Background deploy failed:', err.message)
    const { error: failErr } = await supabase.from('factory_jobs').update({ status: 'failed' }).eq('id', job.id)
    if (failErr) console.error('[Deploy] Failed to set failed status:', failErr.message)
    const { error: statusErr } = await supabase.from('tenants').update({ status: 'deploy_failed' }).eq('id', tenant.id)
    if (statusErr) console.error('[Deploy] Failed to mark tenant deploy_failed:', statusErr.message)
    notifyDeployFailed(tenant, err.message).catch(e => console.warn('[Email] Deploy failed notification failed:', e.message))
  }
}


// ─── Auto-Deploy after Stripe Checkout ────────────────────────────────────────
export async function triggerAutoDeploy(tenantId: string) {
  if (!isConfigured()) {
    console.warn('[AutoDeploy] Skipping — deploy infrastructure not configured')
    return
  }

  const { data: tenant } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
  if (!tenant) { console.warn('[AutoDeploy] Tenant not found:', tenantId); return }

  // Skip if already deployed or deploying
  if (tenant.render_frontend_url || tenant.render_backend_url) {
    console.log('[AutoDeploy] Tenant already deployed, skipping:', tenant.slug)
    return
  }

  // Check no deploy already in progress
  const { data: activeJobs } = await supabase.from('factory_jobs').select('id').eq('tenant_id', tenantId).eq('status', 'deploying')
  if (activeJobs?.length) {
    console.log('[AutoDeploy] Deploy already in progress for:', tenant.slug)
    return
  }

  // Get latest factory job (must have a generated build)
  const { data: job } = await supabase.from('factory_jobs').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!job) {
    console.warn('[AutoDeploy] No build found for tenant:', tenant.slug, '— skipping auto-deploy')
    return
  }

  console.log('[AutoDeploy] Triggering deploy for', tenant.slug, 'after successful checkout')

  // Set tenant status to deploying
  await supabase.from('tenants').update({ status: 'deploying' }).eq('id', tenantId)

  // Set job status to deploying
  await supabase.from('factory_jobs').update({ status: 'deploying' }).eq('id', job.id)

  // Fire-and-forget — same pattern as admin deploy button. On success
  // for a premium tenant, also push the intake photos into the new
  // tenant's photo library via /api/internal/seed-photos so the photos
  // survive past the 30-day signed-URL window.
  runDeploy(tenant, job, {}).then(
    () => seedIntakePhotosIfPremium(tenantId).catch((e) =>
      console.warn('[AutoDeploy] Post-deploy seed-photos call failed for', tenant.slug, ':', e?.message || e)
    ),
    (err) => {
      console.error('[AutoDeploy] Background deploy failed for', tenant.slug, ':', err.message)
      supabase.from('tenants').update({ status: 'deploy_failed' }).eq('id', tenantId)
        .then(() => {}, () => {})
    }
  )
}

// Posts every intake photo (regenerated as a 30-day signed URL) to the
// new tenant's /api/internal/seed-photos endpoint so they're copied to
// the tenant's own R2 bucket. Skips non-premium tenants — standard
// tenants don't have this endpoint.
async function seedIntakePhotosIfPremium(tenantId: string): Promise<void> {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, slug, products, render_frontend_url, factory_sync_key, intake_data')
    .eq('id', tenantId)
    .single()
  if (!tenant) return
  const products: string[] = Array.isArray(tenant.products) ? tenant.products : []
  if (!products.includes('website-premium')) return
  if (!tenant.render_frontend_url) {
    console.warn('[SeedPhotos] No render_frontend_url for', tenant.slug, '— skipping')
    return
  }
  if (!tenant.factory_sync_key) {
    console.warn('[SeedPhotos] No factory_sync_key for', tenant.slug, '— skipping')
    return
  }

  const intake = tenant.intake_data || {}
  const TTL = 30 * 24 * 60 * 60
  const photos: Array<{ url: string; tag?: string; alt?: string }> = []
  if (intake.logo?.storageKey) {
    const url = await getZipDownloadUrl(intake.logo.storageKey, intake.logo.storageType, TTL).catch(() => null)
    if (url) photos.push({ url, tag: 'misc', alt: (tenant.intake_data?.intake?.businessName || tenant.slug) + ' logo' })
  }
  if (Array.isArray(intake.photos)) {
    for (const ref of intake.photos) {
      if (!ref?.storageKey) continue
      const url = await getZipDownloadUrl(ref.storageKey, ref.storageType, TTL).catch(() => null)
      if (url) photos.push({ url })
    }
  }
  if (photos.length === 0) {
    console.log('[SeedPhotos] No intake photos to seed for', tenant.slug)
    return
  }

  const endpoint = tenant.render_frontend_url.replace(/\/$/, '') + '/api/internal/seed-photos'
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Factory-Key': tenant.factory_sync_key,
      },
      body: JSON.stringify({ photos }),
      signal: AbortSignal.timeout(120_000),  // photo downloads + R2 uploads can take a while
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.warn('[SeedPhotos] Tenant returned', res.status, 'for', tenant.slug, ':', data?.error)
      return
    }
    console.log('[SeedPhotos] Seeded', data.seeded || 0, 'photos into', tenant.slug,
      data.errors?.length ? '(' + data.errors.length + ' failed)' : '')
  } catch (err: any) {
    console.warn('[SeedPhotos] Could not reach', endpoint, ':', err.message)
  }
}
