import { Hono } from 'hono'
import { authenticate, supabase } from '../middleware/auth'
import { generate, listTemplates, cleanOldBuilds, type GenerateConfig } from '../services/generator'
import { isConfigured, getMissingConfig, deployCustomer, checkDeployStatus, redeployCustomer, addCustomDomain, updateRenderServiceSettings, findRenderServicesBySlug } from '../services/deploy'
import factoryStripe from '../services/factoryStripe'
import { uploadZip, getZipDownloadUrl, deleteZip } from '../services/factoryStorage'
import fs from 'fs'
import path from 'path'
const factory = new Hono()
const FRONTEND_URL = process.env.PLATFORM_URL || (process.env.NODE_ENV === 'production' ? 'https://twomiah-factory-platform.onrender.com' : 'http://localhost:5173')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DOMAIN_RE = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/

async function parseJsonBody(c: any): Promise<{ data: any; error?: undefined } | { data?: undefined; error: Response }> {
  try {
    const body = await c.req.json()
    if (body === null || typeof body !== 'object') return { error: c.json({ error: 'Request body must be a JSON object' }, 400) }
    return { data: body }
  } catch {
    return { error: c.json({ error: 'Invalid or missing JSON in request body' }, 400) }
  }
}

// ─── Auth on all routes except public ones ────────────────────────────────────
factory.use('*', async (c, next) => {
  const pub = ['/templates', '/features', '/health', '/plans']
  if (pub.some(p => c.req.path.endsWith(p)) || c.req.path.includes('/public/') || c.req.path.includes('/stripe/webhook') || c.req.path.includes('/download/') || c.req.path.includes('/deploy/stream') || c.req.path.endsWith('/cleanup') || (c.req.method === 'GET' && c.req.path.includes('/support/kb'))) return next()
  return authenticate(c, next)
})


// ─── Generate ─────────────────────────────────────────────────────────────────
factory.post('/generate', async (c) => {
  try {
    const config = await c.req.json() as GenerateConfig
    if (!config.products?.length) return c.json({ error: 'At least one product must be selected' }, 400)
    if (!config.company?.name) return c.json({ error: 'Company name is required' }, 400)

    const validProducts = ['website', 'cms', 'crm', 'vision']
    const invalid = config.products.filter(p => !validProducts.includes(p))
    if (invalid.length) return c.json({ error: 'Invalid products: ' + invalid.join(', ') }, 400)

    console.log('[Factory] Generating build for "' + config.company.name + '" — products:', config.products.join(', '))
    const startTime = Date.now()

    const result = await generate(config)

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log('[Factory] Build complete in ' + elapsed + 's — ' + result.zipName)

    // Upload to storage (S3/R2 if configured, otherwise stays local)
    const storage = await uploadZip(result.zipPath, result.zipName)

    // Track factory_job in Supabase
    const tenantId = config.tenant_id || (config as any).tenantId
    console.log('[Factory] tenant_id for job insert:', tenantId || 'NONE — skipping insert')
    if (tenantId) {
      const jobRecord: Record<string, any> = {
        tenant_id: tenantId,
        template: config.products.join('+'),
        deployment_model: 'owned',
        status: 'pending',
        features: config.features?.crm || [],
        branding: config.branding,
        build_id: result.buildId,
        zip_name: result.zipName,
        storage_key: storage.storageKey,
        storage_type: storage.storageType,
      }
      // Try with config column first, fall back without it
      const { error: insertErr } = await supabase.from('factory_jobs').insert({ ...jobRecord, config })
      if (insertErr) {
        console.error('[Factory] Job insert error (with config):', insertErr.message, insertErr.code)
        // If the error is about the config column, retry without it
        if (insertErr.code === '42703') {
          const { error: fallbackErr } = await supabase.from('factory_jobs').insert(jobRecord)
          if (fallbackErr) console.error('[Factory] Job insert error (fallback):', fallbackErr.message, fallbackErr.code)
          else console.log('[Factory] Job saved (without config column)')
        }
      } else {
        console.log('[Factory] Job saved with config for tenant', tenantId)
      }
    }

    return c.json({
      success: true,
      buildId: result.buildId,
      zipName: result.zipName,
      slug: result.slug,
      customerId: config.tenant_id || null,
      downloadUrl: '/api/v1/factory/download/' + result.buildId + '/' + result.zipName,
      generatedIn: elapsed + 's',
      defaultPassword: result.defaultPassword,
      adminUrl: config.products.includes('website') || config.products.includes('cms')
        ? 'https://' + result.slug + '-site.onrender.com/admin'
        : null,
    })
  } catch (err: any) {
    console.error('[Factory] Generation failed:', err)
    return c.json({ error: 'Build generation failed', details: err.message }, 500)
  }
})


// ─── Download ─────────────────────────────────────────────────────────────────
factory.get('/download/:buildId/:filename', async (c) => {
  const { buildId, filename } = c.req.param()
  if (!UUID_RE.test(buildId) || !/^[a-zA-Z0-9_-]+\.zip$/.test(filename)) {
    return c.json({ error: 'Invalid download parameters' }, 400)
  }

  // Support token query param for direct browser downloads (links can't send Authorization headers)
  if (!c.get('user')) {
    const token = c.req.query('token')
    if (token) {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
      if (authErr || !user) return c.json({ error: 'Unauthorized' }, 401)
    } else {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }

  // Validate buildId exists in database and filename matches
  const { data: job } = await supabase.from('factory_jobs').select('zip_name, storage_key, storage_type').eq('build_id', buildId).maybeSingle()
  if (!job) return c.json({ error: 'Build not found' }, 404)
  if (job.zip_name && job.zip_name !== filename) return c.json({ error: 'Filename mismatch' }, 400)

  // Try storage service first (supports S3/R2 and local)
  const storageKey = job.storage_key
  const storageType = job.storage_type || 'local'
  if (storageKey) {
    if (storageType === 's3') {
      const url = await getZipDownloadUrl(storageKey, storageType)
      if (url) return c.redirect(url)
    } else if (fs.existsSync(storageKey)) {
      const fileData = fs.readFileSync(storageKey)
      return new Response(fileData, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="' + filename + '"',
          'Content-Length': String(fileData.length),
        },
      })
    }
  }

  // Fallback: look in output dir by filename
  const OUTPUT_DIR = process.env.FACTORY_OUTPUT_DIR || path.resolve(process.cwd(), '..', '..', 'generated')
  const zipPath = path.join(OUTPUT_DIR, filename)
  if (!fs.existsSync(zipPath)) {
    return c.json({ error: 'Build not found or expired' }, 404)
  }

  const fileData = fs.readFileSync(zipPath)
  return new Response(fileData, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Content-Length': String(fileData.length),
    },
  })
})


// ─── Generate Content with AI ─────────────────────────────────────────────────
factory.post('/generate-content', async (c) => {
  try {
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const { companyName, city, state, industry, services, serviceRegion, ownerName } = parsed.data
    if (!companyName) return c.json({ error: 'companyName is required' }, 400)
    if (!process.env.ANTHROPIC_API_KEY) return c.json({ error: 'AI content generation not configured (missing ANTHROPIC_API_KEY)' }, 503)

    const isHomeCare = industry === 'home_care'
    const location = [city, state].filter(Boolean).join(', ') || 'your area'
    const region = serviceRegion || city || 'the area'

    const prompt = 'You are writing website copy for a ' + (isHomeCare ? 'home care' : 'home improvement contractor') + ' company.\n\n' +
      'Company: ' + companyName + '\nLocation: ' + location + '\nService region: ' + region + '\n' +
      (ownerName ? 'Owner: ' + ownerName + '\n' : '') +
      'Services: ' + (services || []).join(', ') + '\n\n' +
      'Write the following in JSON format:\n' +
      '{\n  "heroTagline": "short 3-6 word badge text",\n  "aboutText": "2-3 sentence paragraph about this company",\n  "ctaText": "one sentence call-to-action"\n}\n' +
      'Return ONLY valid JSON. No markdown, no explanation.'

    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const message = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = message.content.find((b: any) => b.type === 'text')
    if (!textBlock) return c.json({ error: 'AI returned no text content' }, 500)
    const raw = (textBlock as any).text.trim()
    const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
    try {
      return c.json(JSON.parse(cleaned))
    } catch {
      console.error('[Factory] AI returned invalid JSON:', cleaned.substring(0, 200))
      return c.json({ error: 'AI returned invalid JSON response' }, 500)
    }
  } catch (err: any) {
    console.error('[Factory] generate-content error:', err.message)
    return c.json({ error: 'Content generation failed', details: err.message }, 500)
  }
})


// ─── Templates & Features ─────────────────────────────────────────────────────
factory.get('/templates', (c) => {
  return c.json({ templates: listTemplates() })
})

factory.get('/features', (c) => {
  return c.json({
    website: [
      { category: 'Content', features: [
        { id: 'blog', name: 'Blog', description: 'Blog with categories and SEO' },
        { id: 'gallery', name: 'Gallery', description: 'Photo gallery with lightbox' },
        { id: 'testimonials', name: 'Testimonials', description: 'Customer testimonials section' },
        { id: 'services_pages', name: 'Service Pages', description: 'Individual service pages with SEO' },
      ]},
      { category: 'Lead Generation', features: [
        { id: 'contact_form', name: 'Contact Form', description: 'Lead capture with email notifications' },
        { id: 'service_area', name: 'Service Area Pages', description: 'Geo-targeted landing pages' },
        { id: 'financing_widget', name: 'Financing Widget', description: 'Embedded financing calculator' },
      ]},
      { category: 'SEO & Analytics', features: [
        { id: 'sitemap', name: 'XML Sitemap', description: 'Auto-generated sitemap' },
        { id: 'schema_markup', name: 'Schema Markup', description: 'Structured data for search' },
        { id: 'analytics', name: 'Analytics Integration', description: 'GA4, GTM, Facebook Pixel' },
      ]},
      { category: 'Tools', features: [
        { id: 'visualizer', name: 'Home Visualizer', description: 'AI-powered renovation visualizer' },
        { id: 'reviews_widget', name: 'Reviews Widget', description: 'Google reviews integration' },
      ]},
    ],
    crm: [
      { category: 'Core', features: [
        { id: 'contacts', name: 'Contacts', description: 'Client, lead, vendor management', core: true },
        { id: 'jobs', name: 'Jobs', description: 'Job tracking and management', core: true },
        { id: 'quotes', name: 'Quotes', description: 'Professional estimates and quotes', core: true },
        { id: 'invoices', name: 'Invoices', description: 'Invoice generation and tracking', core: true },
        { id: 'scheduling', name: 'Scheduling', description: 'Calendar and job scheduling', core: true },
        { id: 'team', name: 'Team', description: 'Team member management', core: true },
        { id: 'dashboard', name: 'Dashboard', description: 'Overview dashboard', core: true },
      ]},
      { category: 'Construction', features: [
        { id: 'projects', name: 'Projects', description: 'Multi-phase project management' },
        { id: 'rfis', name: 'RFIs', description: 'Request for information tracking' },
        { id: 'change_orders', name: 'Change Orders', description: 'Change order management' },
        { id: 'punch_lists', name: 'Punch Lists', description: 'Punch list tracking' },
        { id: 'daily_logs', name: 'Daily Logs', description: 'Field daily log reports' },
        { id: 'inspections', name: 'Inspections', description: 'Quality inspections' },
        { id: 'bid_management', name: 'Bid Management', description: 'Bid tracking and submission' },
        { id: 'takeoff_tools', name: 'Takeoff Tools', description: 'Material takeoff calculations' },
        { id: 'selections', name: 'Selections', description: 'Client material selections portal' },
      ]},
      { category: 'Service Trade', features: [
        { id: 'drag_drop_calendar', name: 'Drag & Drop Calendar', description: 'Visual job scheduling' },
        { id: 'recurring_jobs', name: 'Recurring Jobs', description: 'Automated recurring job creation' },
        { id: 'route_optimization', name: 'Route Optimization', description: 'Optimize daily service routes' },
        { id: 'online_booking', name: 'Online Booking', description: 'Customer self-scheduling' },
        { id: 'service_dispatch', name: 'Service Dispatch', description: 'Real-time dispatch board' },
        { id: 'service_agreements', name: 'Service Agreements', description: 'Maintenance agreement management' },
        { id: 'warranties', name: 'Warranties', description: 'Warranty tracking' },
        { id: 'pricebook', name: 'Pricebook', description: 'Standardized pricing catalog' },
      ]},
      { category: 'Field Operations', features: [
        { id: 'time_tracking', name: 'Time Tracking', description: 'Clock in/out with GPS' },
        { id: 'gps_tracking', name: 'GPS Tracking', description: 'Real-time crew location' },
        { id: 'photo_capture', name: 'Photo Capture', description: 'Job site photo documentation' },
        { id: 'equipment_tracking', name: 'Equipment', description: 'Equipment and tool tracking' },
        { id: 'fleet', name: 'Fleet Management', description: 'Vehicle fleet tracking' },
      ]},
      { category: 'Finance', features: [
        { id: 'online_payments', name: 'Online Payments', description: 'Stripe payment processing' },
        { id: 'expense_tracking', name: 'Expense Tracking', description: 'Expense logging and receipts' },
        { id: 'job_costing', name: 'Job Costing', description: 'Detailed job cost analysis' },
        { id: 'consumer_financing', name: 'Consumer Financing', description: 'Wisetack financing integration' },
        { id: 'quickbooks', name: 'QuickBooks', description: 'QuickBooks sync' },
      ]},
      { category: 'Communication', features: [
        { id: 'two_way_texting', name: 'Two-Way Texting', description: 'SMS communication with clients' },
        { id: 'call_tracking', name: 'Call Tracking', description: 'Inbound call tracking and recording' },
        { id: 'client_portal', name: 'Client Portal', description: 'Customer-facing project portal' },
      ]},
      { category: 'Marketing', features: [
        { id: 'paid_ads', name: 'Paid Ads Hub (Google + Meta)', description: 'Google & Meta campaign management, lead tracking, monthly ROI reports' },
        { id: 'google_reviews', name: 'Google Reviews', description: 'Review request automation' },
        { id: 'email_marketing', name: 'Email Marketing', description: 'Drip campaigns and newsletters' },
        { id: 'referral_program', name: 'Referral Program', description: 'Customer referral tracking' },
      ]},
      { category: 'Advanced', features: [
        { id: 'inventory', name: 'Inventory', description: 'Warehouse and material inventory' },
        { id: 'documents', name: 'Documents', description: 'Document management and storage' },
        { id: 'reports', name: 'Reports', description: 'Custom reporting dashboard' },
        { id: 'custom_dashboards', name: 'Custom Dashboards', description: 'Drag-and-drop widget dashboards' },
        { id: 'ai_receptionist', name: 'AI Receptionist', description: 'AI-powered call handling' },
        { id: 'map_view', name: 'Map View', description: 'Map-based job visualization' },
      ]},
    ],
  })
})


// ─── Deploy ───────────────────────────────────────────────────────────────────
factory.get('/deploy/config', (c) => {
  return c.json({ configured: isConfigured() })
})

factory.post('/customers/:id/deploy', async (c) => {
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

function buildConfigFromTenantAndJob(tenant: any, job: any): GenerateConfig {
  return {
    tenant_id: tenant.id,
    products: job.template?.split('+') || tenant.products || ['crm'],
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
      defaultPassword: tenant.admin_password || undefined,
    },
    branding: job.branding || {
      primaryColor: tenant.primary_color || '#f97316',
      secondaryColor: tenant.secondary_color || '#1e3a5f',
    },
    features: {
      crm: job.features || tenant.features || [],
    },
  } as GenerateConfig
}

async function runDeploy(tenant: any, job: any, options: { region?: string; plan?: string; dbPlan?: string } = {}) {
  try {
    // Use stored config if available, otherwise reconstruct from tenant + job
    const config: GenerateConfig = job.config || buildConfigFromTenantAndJob(tenant, job)

    console.log('[Deploy] Regenerating fresh zip for', tenant.slug)
    const genResult = await generate(config)
    const OUTPUT_DIR = process.env.FACTORY_OUTPUT_DIR || path.resolve(process.cwd(), '..', '..', 'generated')
    const zipPath = path.join(OUTPUT_DIR, genResult.zipName)
    if (!fs.existsSync(zipPath)) throw new Error('Regenerated zip not found at ' + zipPath)

    console.log('[Deploy] Using freshly generated zip:', zipPath)

    const result = await deployCustomer(
      { id: tenant.id, slug: tenant.slug, name: tenant.name, industry: tenant.industry, products: job.template?.split('+') || ['crm'], config: config },
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
      const tenantUpdate: Record<string, any> = { status: 'active' }
      if (result.deployedUrl) tenantUpdate.render_frontend_url = result.deployedUrl
      if (result.apiUrl) tenantUpdate.render_backend_url = result.apiUrl
      if (result.siteUrl) tenantUpdate.website_url = result.siteUrl

      // Auto-create Stripe subscription if tenant doesn't already have one
      if (!tenant.stripe_subscription_id && tenant.deployment_model === 'saas') {
        try {
          const subResult = await factoryStripe.createAutoSubscription({
            id: tenant.id, email: tenant.email, name: tenant.name,
            phone: tenant.phone, stripeCustomerId: tenant.stripe_customer_id,
            plan: tenant.plan, monthlyAmount: tenant.monthly_amount,
          })
          if (subResult) {
            if (subResult.stripeCustomerId) tenantUpdate.stripe_customer_id = subResult.stripeCustomerId
            if (subResult.subscriptionId) tenantUpdate.stripe_subscription_id = subResult.subscriptionId
            tenantUpdate.billing_type = 'subscription'
            tenantUpdate.billing_status = 'active'
            tenantUpdate.monthly_amount = tenant.monthly_amount || { starter: 49, pro: 149, business: 299, construction: 599 }[tenant.plan || 'starter'] || 149
            console.log('[Deploy] Auto-created Stripe subscription for', tenant.slug)
          }
        } catch (stripeErr: any) {
          console.error('[Deploy] Auto-subscription failed (non-blocking):', stripeErr.message)
        }
      }

      const { error: tenantUpdateErr } = await supabase.from('tenants').update(tenantUpdate).eq('id', tenant.id)
      if (tenantUpdateErr) console.error('[Deploy] Tenant update error:', tenantUpdateErr.message)
    }

    console.log('[Deploy] Complete for', tenant.slug, '- status:', result.status)
  } catch (err: any) {
    console.error('[Deploy] Background deploy failed:', err.message)
    const { error: failErr } = await supabase.from('factory_jobs').update({ status: 'failed' }).eq('id', job.id)
    if (failErr) console.error('[Deploy] Failed to set failed status:', failErr.message)
  }
}


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


// ─── Redeploy ─────────────────────────────────────────────────────────────────
factory.post('/customers/:id/redeploy', async (c) => {
  if (!isConfigured()) return c.json({ error: 'Deploy not configured' }, 400)
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)

  const { data: tenant } = await supabase.from('factory_tenants').select('slug').eq('id', id).maybeSingle()
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


// ─── Update Service Settings ─────────────────────────────────────────────────
factory.patch('/customers/:id/service/:role', async (c) => {
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
    const { redeployCustomer } = await import('../services/deploy')
    await redeployCustomer({ renderServiceIds: { [role]: serviceId } })
  }
  return c.json({ success: true, serviceId, updated: Object.keys(body).filter(k => k !== 'redeploy') })
})

// ─── Cleanup ──────────────────────────────────────────────────────────────────
factory.post('/cleanup', async (c) => {
  // Auth: require CRON_SECRET header or valid Supabase session
  const cronSecret = c.req.header('x-cron-secret')
  const authHeader = c.req.header('Authorization')
  if (cronSecret) {
    if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET) return c.json({ error: 'Invalid cron secret' }, 401)
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
factory.post('/customers/:id/regenerate', async (c) => {
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


// ─── Delete Job ──────────────────────────────────────────────────────────────
factory.delete('/jobs/:id', async (c) => {
  try {
    const jobId = c.req.param('id')
    if (!UUID_RE.test(jobId)) return c.json({ error: 'Invalid job ID format' }, 400)
    const { data: job, error: jobErr } = await supabase.from('factory_jobs').select('*').eq('id', jobId).single()
    if (jobErr || !job) return c.json({ error: jobErr?.message || 'Job not found' }, jobErr && jobErr.code !== 'PGRST116' ? 500 : 404)

    if (job.storage_key) {
      await deleteZip(job.storage_key, job.storage_type || 'local')
    } else if (job.zip_name) {
      const OUTPUT_DIR = process.env.FACTORY_OUTPUT_DIR || path.resolve(process.cwd(), '..', '..', 'generated')
      const zipPath = path.join(OUTPUT_DIR, job.zip_name)
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
    }

    await supabase.from('factory_jobs').delete().eq('id', jobId)
    return c.json({ success: true })
  } catch (err: any) {
    console.error('[Factory] Delete job error:', err)
    return c.json({ error: 'Failed to delete build' }, 500)
  }
})


// ─── Stripe Config ───────────────────────────────────────────────────────────
factory.get('/stripe/config', (c) => {
  return c.json({ configured: factoryStripe.isConfigured(), publishableKey: factoryStripe.getPublishableKey() })
})


// ─── Checkout: Subscription ─────────────────────────────────────────────────
factory.post('/customers/:id/checkout/subscription', async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: tenantErr?.message || 'Tenant not found' }, tenantErr && tenantErr.code !== 'PGRST116' ? 500 : 404)

    const parsedBody = await parseJsonBody(c)
    if (parsedBody.error) return parsedBody.error
    const { planId, monthlyAmount, billingCycle, trialDays } = parsedBody.data
    if (monthlyAmount !== undefined && (typeof monthlyAmount !== 'number' || monthlyAmount <= 0)) return c.json({ error: 'monthlyAmount must be a positive number' }, 400)
    if (billingCycle && !['monthly', 'annual'].includes(billingCycle)) return c.json({ error: 'billingCycle must be "monthly" or "annual"' }, 400)
    if (trialDays !== undefined && (typeof trialDays !== 'number' || trialDays < 0 || !Number.isInteger(trialDays))) return c.json({ error: 'trialDays must be a non-negative integer' }, 400)
    const result = await factoryStripe.createSubscriptionCheckout(
      { id: tenant.id, email: tenant.email, name: tenant.name, phone: tenant.phone, stripeCustomerId: tenant.stripe_customer_id },
      { planId, monthlyAmount: monthlyAmount || 149, billingCycle, trialDays }
    )

    if (result.stripeCustomerId && !tenant.stripe_customer_id) {
      await supabase.from('tenants').update({ stripe_customer_id: result.stripeCustomerId }).eq('id', tenantId)
    }

    return c.json({ url: result.url, sessionId: result.sessionId })
  } catch (err: any) {
    console.error('[Stripe] Subscription checkout error:', err)
    return c.json({ error: err.message }, 500)
  }
})


// ─── Checkout: License ──────────────────────────────────────────────────────
factory.post('/customers/:id/checkout/license', async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: tenantErr?.message || 'Tenant not found' }, tenantErr && tenantErr.code !== 'PGRST116' ? 500 : 404)

    const parsedBody = await parseJsonBody(c)
    if (parsedBody.error) return parsedBody.error
    const { planId, amount } = parsedBody.data
    if (amount !== undefined && (typeof amount !== 'number' || amount <= 0)) return c.json({ error: 'amount must be a positive number' }, 400)
    const result = await factoryStripe.createLicenseCheckout(
      { id: tenant.id, email: tenant.email, name: tenant.name, stripeCustomerId: tenant.stripe_customer_id },
      { planId, amount: amount || 2497 }
    )

    if (result.stripeCustomerId && !tenant.stripe_customer_id) {
      await supabase.from('tenants').update({ stripe_customer_id: result.stripeCustomerId }).eq('id', tenantId)
    }

    return c.json({ url: result.url, sessionId: result.sessionId })
  } catch (err: any) {
    console.error('[Stripe] License checkout error:', err)
    return c.json({ error: err.message }, 500)
  }
})


// ─── Stripe Webhook ─────────────────────────────────────────────────────────
factory.post('/stripe/webhook', async (c) => {
  let event: any
  try {
    const body = await c.req.text()
    const sig = c.req.header('stripe-signature')
    if (!sig) return c.json({ error: 'Missing signature' }, 400)
    event = factoryStripe.verifyWebhookSignature(body, sig)
  } catch (err: any) {
    console.error('[Stripe] Webhook signature verification failed:', err.message)
    return c.json({ error: 'Signature verification failed' }, 400)
  }

  try {
    const result = await factoryStripe.handleFactoryWebhook(event)

    if (result.handled && result.factoryCustomerId && result.updates) {
      await supabase.from('tenants').update(result.updates).eq('id', result.factoryCustomerId)
    } else if (result.handled && result.lookupField && result.lookupValue && result.updates) {
      await supabase.from('tenants').update(result.updates).eq(result.lookupField, result.lookupValue)
    }

    return c.json({ received: true })
  } catch (err: any) {
    console.error('[Stripe] Webhook handler error:', err.message)
    return c.json({ error: 'Webhook processing failed' }, 500)
  }
})


// ─── Billing Portal ─────────────────────────────────────────────────────────
factory.post('/customers/:id/billing-portal', async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: tenantErr?.message || 'Tenant not found' }, tenantErr && tenantErr.code !== 'PGRST116' ? 500 : 404)
    if (!tenant.stripe_customer_id) return c.json({ error: 'Customer has no Stripe account. Create a checkout first.' }, 400)

    const returnUrl = tenant.render_frontend_url || (FRONTEND_URL + '/tenants/' + tenantId)
    const result = await factoryStripe.createBillingPortalSession(tenant.stripe_customer_id, returnUrl)
    return c.json({ url: result.url })
  } catch (err: any) {
    console.error('[Stripe] Billing portal error:', err)
    return c.json({ error: err.message }, 500)
  }
})


// ─── Billing Summary ────────────────────────────────────────────────────────
factory.get('/billing/summary', async (c) => {
  try {
    const { data: subscriptions } = await supabase.from('tenants')
      .select('name, monthly_amount, plan')
      .eq('billing_type', 'subscription').eq('billing_status', 'active')

    const { data: oneTime } = await supabase.from('tenants')
      .select('name, one_time_amount, paid_at')
      .eq('billing_type', 'one_time')

    const { data: pastDue } = await supabase.from('tenants')
      .select('name, monthly_amount, email')
      .eq('billing_status', 'past_due')

    const mrr = (subscriptions || []).reduce((sum: number, t: any) => sum + (parseFloat(t.monthly_amount) || 0), 0)
    const totalOneTime = (oneTime || []).reduce((sum: number, t: any) => sum + (parseFloat(t.one_time_amount) || 0), 0)

    return c.json({
      mrr,
      arr: mrr * 12,
      totalOneTimeRevenue: totalOneTime,
      activeSubscriptions: (subscriptions || []).length,
      pastDueCount: (pastDue || []).length,
      pastDueCustomers: pastDue || [],
      subscriptions: subscriptions || [],
      oneTimeCustomers: oneTime || [],
    })
  } catch (err: any) {
    console.error('[Billing] Summary error:', err)
    return c.json({ mrr: 0, arr: 0, totalOneTimeRevenue: 0, activeSubscriptions: 0, pastDueCount: 0 })
  }
})


// ─── Plans (public) ─────────────────────────────────────────────────────────
factory.get('/plans', (c) => {
  return c.json({
    plans: [
      { id: 'solo', name: 'Solo', monthlyPrice: 49, features: ['Unlimited jobs & clients', 'Estimates & invoices', 'Client CRM', 'Mobile access', '1-2 users'] },
      { id: 'starter', name: 'Starter', monthlyPrice: 129, features: ['Everything in Solo', 'Crew scheduling', 'Job cost tracking', 'Revenue reports', 'Up to 10 users'] },
      { id: 'pro', name: 'Pro', monthlyPrice: 299, features: ['Everything in Starter', 'Advanced analytics', 'Custom fields & workflows', 'Subcontractor portal', 'Up to 25 users'] },
      { id: 'enterprise', name: 'Enterprise', monthlyPrice: 85, perUser: true, minUsers: 15, features: ['Everything in Pro', 'Unlimited users', 'White-glove onboarding', 'Dedicated account manager', 'Custom integrations', 'SLA & uptime guarantee'] },
    ],
    selfHosted: [
      { id: 'solo', name: 'Solo License', price: 1997 },
      { id: 'starter', name: 'Starter License', price: 4997 },
      { id: 'pro', name: 'Pro License', price: 9997 },
      { id: 'enterprise', name: 'Enterprise License', price: null, contact: true },
    ],
    deployServices: [
      { id: 'basic', name: 'Basic', price: 299, description: 'CRM + website setup, login credentials, live URL' },
      { id: 'full', name: 'Full Setup', price: 499, description: 'Basic + data import, integrations, 30-min walkthrough' },
      { id: 'white-glove', name: 'White Glove', price: 699, description: 'Full concierge: website content, data migration, team training, 30-day support' },
    ],
  })
})


// ─── Public Signup (no auth required — path contains /public/) ──────────────
factory.post('/public/signup', async (c) => {
  try {
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const body = parsed.data

    if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
      return c.json({ error: 'Company name is required (min 2 characters)' }, 400)
    }
    if (!body.email || typeof body.email !== 'string' || !body.email.includes('@')) {
      return c.json({ error: 'Valid email is required' }, 400)
    }

    const slug = body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

    // Check for duplicate slug
    const { data: existing } = await supabase.from('tenants').select('id').eq('slug', slug).maybeSingle()
    if (existing) {
      return c.json({ error: 'A company with a similar name already exists. Please contact support or use a different name.' }, 409)
    }

    const tenantRecord: Record<string, any> = {
      name: body.name.trim(),
      slug,
      email: body.email.trim(),
      admin_email: body.admin_email || body.email.trim(),
      phone: body.phone || null,
      industry: body.industry || null,
      address: body.address || null,
      city: body.city || null,
      state: body.state || null,
      zip: body.zip || null,
      domain: body.domain || null,
      primary_color: body.primary_color || '#FF3D00',
      plan: body.plan || 'starter',
      deployment_model: body.deployment_model || 'saas',
      billing_type: body.billing_type || 'subscription',
      monthly_amount: body.monthly_amount || null,
      status: 'pending',
      products: body.products || ['crm', 'website'],
      features: body.features || [],
      notes: body.notes || null,
      admin_password: body.admin_password || null,
    }

    const { data: tenant, error: insertErr } = await supabase.from('tenants').insert(tenantRecord).select().single()
    if (insertErr) {
      console.error('[Signup] Insert error:', insertErr.message)
      return c.json({ error: 'Failed to create account. Please try again.' }, 500)
    }

    console.log('[Signup] New tenant created:', tenant.id, tenant.name, tenant.plan)

    // If Stripe is configured and this is a SaaS subscription, create a checkout session
    let checkoutUrl = null
    if (factoryStripe.isConfigured() && tenantRecord.deployment_model === 'saas' && tenantRecord.monthly_amount) {
      try {
        const result = await factoryStripe.createSubscriptionCheckout(
          { id: tenant.id, email: tenant.email, name: tenant.name, phone: tenant.phone, stripeCustomerId: null },
          { planId: tenant.plan, monthlyAmount: tenantRecord.monthly_amount, trialDays: 14 }
        )
        if (result.stripeCustomerId) {
          await supabase.from('tenants').update({ stripe_customer_id: result.stripeCustomerId }).eq('id', tenant.id)
        }
        checkoutUrl = result.url
      } catch (stripeErr: any) {
        console.error('[Signup] Stripe checkout creation failed (non-blocking):', stripeErr.message)
      }
    }

    return c.json({
      success: true,
      tenantId: tenant.id,
      slug: tenant.slug,
      checkoutUrl,
      message: 'Account created successfully',
    })
  } catch (err: any) {
    console.error('[Signup] Error:', err.message)
    return c.json({ error: 'Something went wrong. Please try again.' }, 500)
  }
})


// ─── Support Tickets (Level 1: CRM customers → Twomiah) ─────────────────────

// List all support tickets (Factory team view)
factory.get('/support/tickets', async (c) => {
  const status = c.req.query('status')
  const priority = c.req.query('priority')
  const tenantId = c.req.query('tenant_id')
  const search = c.req.query('search')
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '50')

  let query = supabase.from('support_tickets').select('*, tenants!inner(name, slug, plan, email)', { count: 'exact' })

  if (status) query = query.eq('status', status)
  if (priority) query = query.eq('priority', priority)
  if (tenantId) query = query.eq('tenant_id', tenantId)
  if (search) query = query.or(`subject.ilike.%${search}%,number.ilike.%${search}%`)

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: data || [], pagination: { page, limit, total: count || 0, pages: Math.ceil((count || 0) / limit) } })
})

// Support ticket stats for dashboard
factory.get('/support/stats', async (c) => {
  const { data: all } = await supabase.from('support_tickets').select('status, priority')

  const stats: Record<string, number> = { open: 0, in_progress: 0, waiting: 0, resolved: 0, closed: 0, total: 0 }
  let slaBreach = 0
  for (const t of all || []) {
    stats[t.status] = (stats[t.status] || 0) + 1
    stats.total++
  }

  // SLA breaches
  const { data: breached } = await supabase.from('support_tickets')
    .select('id')
    .in('status', ['open', 'in_progress'])
    .lt('sla_resolve_due', new Date().toISOString())

  stats.sla_breached = breached?.length || 0

  // Average rating
  const { data: rated } = await supabase.from('support_tickets').select('rating').not('rating', 'is', null)
  const ratings = (rated || []).map((r: any) => r.rating).filter(Boolean)
  const avgRating = ratings.length > 0 ? (ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length).toFixed(1) : null

  return c.json({ ...stats, avgRating, ratedCount: ratings.length })
})

// Get single ticket with messages
factory.get('/support/tickets/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ticket ID' }, 400)

  const { data: ticket } = await supabase.from('support_tickets').select('*, tenants(name, slug, plan, email)').eq('id', id).single()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const { data: messages } = await supabase.from('support_ticket_messages')
    .select('*').eq('ticket_id', id).order('created_at', { ascending: true })

  return c.json({ ...ticket, messages: messages || [] })
})

// Create ticket (from Factory dashboard)
factory.post('/support/tickets', async (c) => {
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  if (!body.tenant_id || !body.subject) return c.json({ error: 'tenant_id and subject are required' }, 400)

  // Generate ticket number
  const { count } = await supabase.from('support_tickets').select('id', { count: 'exact', head: true })
  const number = 'TWO-' + String((count || 0) + 1).padStart(4, '0')

  // Auto-categorize
  const text = ((body.subject || '') + ' ' + (body.description || '')).toLowerCase()
  let aiCategory = 'general'
  let aiPriorityScore = 20
  const cats: [string, string[], number][] = [
    ['billing', ['invoice', 'payment', 'charge', 'subscription', 'billing', 'refund'], 40],
    ['bug', ['bug', 'error', 'crash', 'broken', 'not working', 'fails'], 60],
    ['technical', ['setup', 'install', 'configure', 'api', 'integration', 'deploy'], 50],
    ['feature_request', ['feature', 'request', 'wish', 'suggestion'], 30],
  ]
  for (const [cat, kws, score] of cats) {
    if (kws.some(k => text.includes(k))) { aiCategory = cat; aiPriorityScore = score; break }
  }

  // SLA defaults based on priority
  const slaDefaults: Record<string, { response: number; resolve: number }> = {
    critical: { response: 30, resolve: 240 },
    urgent: { response: 60, resolve: 480 },
    high: { response: 120, resolve: 960 },
    normal: { response: 240, resolve: 1440 },
    low: { response: 480, resolve: 2880 },
  }
  const sla = slaDefaults[body.priority || 'normal'] || slaDefaults.normal
  const now = new Date()

  const record = {
    number,
    subject: body.subject,
    description: body.description || null,
    status: 'open',
    priority: body.priority || 'normal',
    category: body.category || aiCategory,
    source: body.source || 'portal',
    tenant_id: body.tenant_id,
    submitter_email: body.submitter_email || null,
    submitter_name: body.submitter_name || null,
    assigned_to: body.assigned_to || null,
    ai_category: aiCategory,
    ai_priority_score: aiPriorityScore,
    sla_response_due: new Date(now.getTime() + sla.response * 60000).toISOString(),
    sla_resolve_due: new Date(now.getTime() + sla.resolve * 60000).toISOString(),
  }

  const { data: ticket, error } = await supabase.from('support_tickets').insert(record).select().single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json(ticket, 201)
})

// Update ticket
factory.patch('/support/tickets/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (body.status) updates.status = body.status
  if (body.priority) updates.priority = body.priority
  if (body.category) updates.category = body.category
  if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to
  if (body.status === 'resolved') updates.resolved_at = new Date().toISOString()
  if (body.status === 'closed') updates.closed_at = new Date().toISOString()

  const { data, error } = await supabase.from('support_tickets').update(updates).eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// Add message to ticket
factory.post('/support/tickets/:id/messages', async (c) => {
  const ticketId = c.req.param('id')
  if (!UUID_RE.test(ticketId)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  if (!body.body) return c.json({ error: 'Message body is required' }, 400)

  // Track first response
  const { data: ticket } = await supabase.from('support_tickets').select('first_response_at, status').eq('id', ticketId).single()
  if (ticket) {
    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (!ticket.first_response_at && body.sender_type === 'agent') updates.first_response_at = new Date().toISOString()
    if (ticket.status === 'open' && body.sender_type === 'agent') updates.status = 'in_progress'
    await supabase.from('support_tickets').update(updates).eq('id', ticketId)
  }

  const { data, error } = await supabase.from('support_ticket_messages').insert({
    ticket_id: ticketId,
    body: body.body,
    is_internal: body.is_internal || false,
    sender_type: body.sender_type || 'agent',
    sender_email: body.sender_email || null,
    sender_name: body.sender_name || null,
  }).select().single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data, 201)
})

// Rate ticket
factory.post('/support/tickets/:id/rate', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const { rating, comment } = parsed.data

  const { data, error } = await supabase.from('support_tickets').update({
    rating: Math.min(5, Math.max(1, rating)),
    rating_comment: comment || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select().single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// ─── Customer-facing ticket endpoints (public, by tenant) ────────────────────

factory.post('/public/support/tickets', async (c) => {
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  if (!body.tenant_id || !body.subject || !body.submitter_email) {
    return c.json({ error: 'tenant_id, subject, and submitter_email are required' }, 400)
  }

  // Generate number
  const { count } = await supabase.from('support_tickets').select('id', { count: 'exact', head: true })
  const number = 'TWO-' + String((count || 0) + 1).padStart(4, '0')

  const now = new Date()
  const record = {
    number,
    subject: body.subject,
    description: body.description || null,
    status: 'open',
    priority: body.priority || 'normal',
    source: 'portal',
    tenant_id: body.tenant_id,
    submitter_email: body.submitter_email,
    submitter_name: body.submitter_name || null,
    sla_response_due: new Date(now.getTime() + 240 * 60000).toISOString(),
    sla_resolve_due: new Date(now.getTime() + 1440 * 60000).toISOString(),
  }

  const { data: ticket, error } = await supabase.from('support_tickets').insert(record).select().single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json(ticket, 201)
})

// Customer view their tickets
factory.get('/public/support/tickets', async (c) => {
  const tenantId = c.req.query('tenant_id')
  const email = c.req.query('email')
  if (!tenantId || !email) return c.json({ error: 'tenant_id and email are required' }, 400)

  const { data } = await supabase.from('support_tickets')
    .select('id, number, subject, status, priority, category, created_at, resolved_at, rating')
    .eq('tenant_id', tenantId)
    .eq('submitter_email', email)
    .order('created_at', { ascending: false })

  return c.json(data || [])
})

// ─── Knowledge Base (Factory-level) ──────────────────────────────────────────

factory.get('/support/kb', async (c) => {
  const search = c.req.query('search')
  const category = c.req.query('category')

  let query = supabase.from('support_knowledge_base').select('*').eq('published', true)
  if (category) query = query.eq('category', category)
  if (search) query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`)

  const { data } = await query.order('view_count', { ascending: false }).limit(50)
  return c.json(data || [])
})

factory.post('/support/kb', async (c) => {
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const { data, error } = await supabase.from('support_knowledge_base').insert({
    title: body.title,
    content: body.content,
    category: body.category || null,
    tags: body.tags || [],
  }).select().single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data, 201)
})

factory.put('/support/kb/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ID' }, 400)
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const { data, error } = await supabase.from('support_knowledge_base').update({
    title: body.title,
    content: body.content,
    category: body.category,
    tags: body.tags,
    published: body.published,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select().single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

factory.delete('/support/kb/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ID' }, 400)
  await supabase.from('support_knowledge_base').delete().eq('id', id)
  return c.json({ success: true })
})

// ─── Product Feedback (Level 5) ──────────────────────────────────────────────

factory.get('/support/feedback', async (c) => {
  const status = c.req.query('status')
  const category = c.req.query('category')

  let query = supabase.from('product_feedback').select('*, tenants(name)')
  if (status) query = query.eq('status', status)
  if (category) query = query.eq('category', category)

  const { data } = await query.order('votes', { ascending: false }).limit(100)
  return c.json(data || [])
})

factory.post('/support/feedback', async (c) => {
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const { data, error } = await supabase.from('product_feedback').insert({
    title: body.title,
    description: body.description || null,
    category: body.category || null,
    source_ticket_id: body.source_ticket_id || null,
    tenant_id: body.tenant_id || null,
  }).select().single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data, 201)
})

factory.patch('/support/feedback/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ID' }, 400)
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const updates: Record<string, any> = {}
  if (body.status) updates.status = body.status
  if (body.votes) updates.votes = body.votes

  const { data, error } = await supabase.from('product_feedback').update(updates).eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// ─── Pattern Detection Dashboard (Level 5) ──────────────────────────────────

factory.get('/support/patterns', async (c) => {
  // Category distribution
  const { data: allTickets } = await supabase.from('support_tickets').select('category, priority, rating, created_at')

  const byCategory: Record<string, number> = {}
  const byPriority: Record<string, number> = {}
  const ratings: number[] = []
  const dailyMap: Record<string, number> = {}

  for (const t of allTickets || []) {
    byCategory[t.category || 'general'] = (byCategory[t.category || 'general'] || 0) + 1
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1
    if (t.rating) ratings.push(t.rating)
    const day = t.created_at?.split('T')[0]
    if (day) dailyMap[day] = (dailyMap[day] || 0) + 1
  }

  const avgRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null

  // Top feedback items
  const { data: topFeedback } = await supabase.from('product_feedback')
    .select('title, votes, status, category')
    .order('votes', { ascending: false })
    .limit(10)

  return c.json({
    byCategory: Object.entries(byCategory).map(([k, v]) => ({ category: k, count: v })),
    byPriority: Object.entries(byPriority).map(([k, v]) => ({ priority: k, count: v })),
    avgRating,
    ratedCount: ratings.length,
    dailyTrend: Object.entries(dailyMap).sort().slice(-30).map(([day, cnt]) => ({ day, count: cnt })),
    topFeedback: topFeedback || [],
  })
})


// ─── Preview ────────────────────────────────────────────────────────────────
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function sanitizeCSSColor(str: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(str.trim()) ? str.trim() : '#f97316'
}

factory.post('/preview', async (c) => {
  try {
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const { config } = parsed.data
    if (!config) return c.json({ error: 'config required' }, 400)

    const name = escapeHtml(config.company?.name || 'Your Company')
    const primary = sanitizeCSSColor(config.branding?.primaryColor || '#f97316')
    const hero = escapeHtml(config.content?.heroTagline || 'Quality You Can Trust')
    const about = escapeHtml(config.content?.aboutText || '')
    const cta = escapeHtml(config.content?.ctaText || 'Get a free estimate today.')
    const html = '<!DOCTYPE html><html><head><title>' + name + ' Preview</title>' +
      '<style>body{font-family:system-ui,sans-serif;margin:0;} .hero{background:' + primary + ';color:white;padding:80px 40px;text-align:center;} .hero h1{font-size:2.5rem;margin:0 0 16px;} .content{max-width:800px;margin:40px auto;padding:0 20px;} .cta{background:#f5f5f5;text-align:center;padding:40px;margin-top:40px;}</style>' +
      '</head><body><div class="hero"><div style="font-size:0.9rem;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;">' + hero + '</div><h1>' + name + '</h1></div>' +
      '<div class="content"><p>' + about + '</p></div><div class="cta"><p>' + cta + '</p></div></body></html>'
    return new Response(html, { headers: { 'Content-Type': 'text/html' } })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ─── Customer Domain ────────────────────────────────────────────────────────
factory.post('/customers/:id/domain', async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const { domain } = parsed.data
    if (!domain) return c.json({ error: 'domain is required' }, 400)
    if (!DOMAIN_RE.test(domain)) return c.json({ error: 'Invalid domain format. Expected format: example.com' }, 400)

    // Save domain to tenant record
    const { error } = await supabase.from('tenants').update({ domain }).eq('id', tenantId)
    if (error) throw error

    // If Render services exist, add custom domain to each
    const renderErrors: string[] = []
    if (isConfigured()) {
      const { data: job } = await supabase.from('factory_jobs').select('render_service_ids')
        .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1).maybeSingle()
      const serviceIds = job?.render_service_ids
      if (serviceIds) {
        // Add domain to the primary user-facing service (site or frontend)
        const primaryServiceId = serviceIds.site || serviceIds.frontend
        if (primaryServiceId) {
          const result = await addCustomDomain(primaryServiceId, domain)
          if (!result.success) renderErrors.push('Primary service: ' + result.error)
        }
        // Add www subdomain too
        const wwwResult = await addCustomDomain(serviceIds.site || serviceIds.frontend || '', 'www.' + domain)
        if (!wwwResult.success && !wwwResult.error?.includes('already')) renderErrors.push('www: ' + wwwResult.error)
      }
    }

    return c.json({ success: true, domain, renderErrors: renderErrors.length ? renderErrors : undefined })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


export default factory
