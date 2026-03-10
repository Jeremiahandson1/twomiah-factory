import { Hono } from 'hono'
import { authenticate, supabase, requireRole } from '../middleware/auth'
import { generate, listTemplates, cleanOldBuilds, type GenerateConfig } from '../services/generator'
import { isConfigured, getMissingConfig, deployCustomer, checkDeployStatus, redeployCustomer, addCustomDomain, updateRenderServiceSettings, findRenderServicesBySlug } from '../services/deploy'
import factoryStripe from '../services/factoryStripe'
import { uploadZip, getZipDownloadUrl, deleteZip } from '../services/factoryStorage'
import { notifyDeployComplete, notifyDeployFailed, notifyNewTicket, notifyTicketReply, notifyBillingPastDue } from '../services/email'
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
  if (pub.some(p => c.req.path.endsWith(p)) || c.req.path.includes('/public/') || c.req.path.includes('/stripe/webhook') || c.req.path.includes('/download/') || c.req.path.includes('/deploy/stream') || c.req.path.endsWith('/cleanup') || c.req.path.includes('/website-themes') || (c.req.method === 'GET' && c.req.path.includes('/support/kb'))) return next()
  return authenticate(c, next)
})


// ─── Generate (editor+) ───────────────────────────────────────────────────────
factory.post('/generate', requireRole('owner', 'admin', 'editor'), async (c) => {
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


// ─── Generate Content with AI (editor+) ──────────────────────────────────────
factory.post('/generate-content', requireRole('owner', 'admin', 'editor'), async (c) => {
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

// ─── Website Themes ───────────────────────────────────────────────────────────
factory.get('/website-themes', (c) => {
  try {
    const TEMPLATES_ROOT = process.env.FACTORY_TEMPLATES_DIR || path.resolve(process.cwd(), '..', '..', 'templates')
    const themesFile = path.join(TEMPLATES_ROOT, 'website-themes.json')
    if (!fs.existsSync(themesFile)) {
      return c.json({ themes: [] })
    }
    const themes = JSON.parse(fs.readFileSync(themesFile, 'utf8'))
    return c.json({ themes })
  } catch (err: any) {
    console.error('[Factory] Failed to load website themes:', err.message)
    return c.json({ themes: [] })
  }
})

factory.get('/website-themes/preview', (c) => {
  try {
    const TEMPLATES_ROOT = process.env.FACTORY_TEMPLATES_DIR || path.resolve(process.cwd(), '..', '..', 'templates')
    const type = c.req.query('type') || 'contractor'
    const theme = c.req.query('theme') || ''
    const companyName = c.req.query('companyName') || 'Your Company'
    const primaryColor = c.req.query('primaryColor') || '#f97316'
    const secondaryColor = c.req.query('secondaryColor') || '#1e3a5f'

    // Load preview HTML template
    const previewTemplatePath = path.join(TEMPLATES_ROOT, 'website-preview.html')
    if (!fs.existsSync(previewTemplatePath)) {
      return c.text('Preview template not found', 404)
    }
    let html = fs.readFileSync(previewTemplatePath, 'utf8')

    // Load and inject theme CSS if specified
    let themeCss = ''
    if (theme) {
      const websiteTemplate = type === 'home_care' ? 'website-homecare' : (type === 'general' ? 'website-general' : 'website-contractor')
      const themeCssPath = path.join(TEMPLATES_ROOT, websiteTemplate, 'build', 'styles', 'themes', `${theme}.css`)
      if (fs.existsSync(themeCssPath)) {
        themeCss = fs.readFileSync(themeCssPath, 'utf8')
      }
    }

    html = html.replace(/\{\{COMPANY_NAME\}\}/g, companyName)
    html = html.replace(/\{\{PRIMARY_COLOR\}\}/g, primaryColor)
    html = html.replace(/\{\{SECONDARY_COLOR\}\}/g, secondaryColor)
    html = html.replace(/\{\{THEME_CSS\}\}/g, themeCss)

    return c.html(html)
  } catch (err: any) {
    console.error('[Factory] Preview error:', err.message)
    return c.text('Preview generation failed', 500)
  }
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
      const tenantUpdate: Record<string, any> = { status: 'active' }
      if (result.deployedUrl) tenantUpdate.render_frontend_url = result.deployedUrl
      if (result.apiUrl) tenantUpdate.render_backend_url = result.apiUrl
      if (result.siteUrl) tenantUpdate.website_url = result.siteUrl
      if (result.adsUrl) tenantUpdate.ads_url = result.adsUrl
      if (result.supabaseProjectRef) tenantUpdate.supabase_project_ref = result.supabaseProjectRef
      if (result.r2BucketName) tenantUpdate.r2_bucket_name = result.r2BucketName

      // Auto-create Stripe subscription if tenant doesn't already have one
      if (!tenant.stripe_subscription_id && tenant.deployment_model === 'saas') {
        try {
          const subResult = await factoryStripe.createAutoSubscription({
            id: tenant.id, email: tenant.email, name: tenant.name,
            phone: tenant.phone, stripeCustomerId: tenant.stripe_customer_id,
            plan: tenant.plan,
          })
          if (subResult) {
            if (subResult.stripeCustomerId) tenantUpdate.stripe_customer_id = subResult.stripeCustomerId
            if (subResult.subscriptionId) tenantUpdate.stripe_subscription_id = subResult.subscriptionId
            tenantUpdate.billing_type = 'subscription'
            tenantUpdate.billing_status = 'active'
            const planPrices: Record<string, number> = { starter: 49, pro: 149, business: 299, construction: 599, enterprise: 199 }
            tenantUpdate.monthly_amount = tenant.monthly_amount || planPrices[tenant.plan || 'starter'] || 149
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

    // Send email notification
    if (result.success) {
      notifyDeployComplete(tenant, { apiUrl: result.apiUrl, deployedUrl: result.deployedUrl, siteUrl: result.siteUrl, repoUrl: result.repoUrl, adsUrl: result.adsUrl }).catch(e => console.warn('[Email] Deploy complete notification failed:', e.message))
    } else {
      notifyDeployFailed(tenant, result.errors.join('; ') || 'Unknown error').catch(e => console.warn('[Email] Deploy failed notification failed:', e.message))
    }
  } catch (err: any) {
    console.error('[Deploy] Background deploy failed:', err.message)
    const { error: failErr } = await supabase.from('factory_jobs').update({ status: 'failed' }).eq('id', job.id)
    if (failErr) console.error('[Deploy] Failed to set failed status:', failErr.message)
    notifyDeployFailed(tenant, err.message).catch(e => console.warn('[Email] Deploy failed notification failed:', e.message))
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


// ─── Delete Job ──────────────────────────────────────────────────────────────
factory.delete('/jobs/:id', requireRole('owner', 'admin'), async (c) => {
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
factory.post('/customers/:id/checkout/subscription', requireRole('owner', 'admin'), async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: tenantErr?.message || 'Tenant not found' }, tenantErr && tenantErr.code !== 'PGRST116' ? 500 : 404)

    const parsedBody = await parseJsonBody(c)
    if (parsedBody.error) return parsedBody.error
    const { planId, billingCycle, trialDays } = parsedBody.data
    if (billingCycle && !['monthly', 'annual'].includes(billingCycle)) return c.json({ error: 'billingCycle must be "monthly" or "annual"' }, 400)
    if (trialDays !== undefined && (typeof trialDays !== 'number' || trialDays < 0 || !Number.isInteger(trialDays))) return c.json({ error: 'trialDays must be a non-negative integer' }, 400)
    const result = await factoryStripe.createSubscriptionCheckout(
      { id: tenant.id, email: tenant.email, name: tenant.name, phone: tenant.phone, stripeCustomerId: tenant.stripe_customer_id },
      { planId: planId || tenant.plan || 'starter', billingCycle: billingCycle || 'monthly', trialDays }
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
factory.post('/customers/:id/checkout/license', requireRole('owner', 'admin'), async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: tenantErr?.message || 'Tenant not found' }, tenantErr && tenantErr.code !== 'PGRST116' ? 500 : 404)

    const parsedBody = await parseJsonBody(c)
    if (parsedBody.error) return parsedBody.error
    const { planId } = parsedBody.data
    const result = await factoryStripe.createLicenseCheckout(
      { id: tenant.id, email: tenant.email, name: tenant.name, stripeCustomerId: tenant.stripe_customer_id },
      { planId: planId || tenant.plan || 'pro' }
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


// ─── Checkout: Deploy Service ────────────────────────────────────────────────
factory.post('/customers/:id/checkout/deploy-service', requireRole('owner', 'admin'), async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: tenantErr?.message || 'Tenant not found' }, tenantErr && tenantErr.code !== 'PGRST116' ? 500 : 404)

    const parsedBody = await parseJsonBody(c)
    if (parsedBody.error) return parsedBody.error
    const { serviceId } = parsedBody.data
    if (!serviceId || !['basic', 'full', 'white-glove', 'white_glove'].includes(serviceId)) {
      return c.json({ error: 'serviceId must be "basic", "full", or "white-glove"' }, 400)
    }
    const result = await factoryStripe.createDeployCheckout(
      { id: tenant.id, email: tenant.email, name: tenant.name, stripeCustomerId: tenant.stripe_customer_id },
      { serviceId }
    )

    if (result.stripeCustomerId && !tenant.stripe_customer_id) {
      await supabase.from('tenants').update({ stripe_customer_id: result.stripeCustomerId }).eq('id', tenantId)
    }

    return c.json({ url: result.url, sessionId: result.sessionId })
  } catch (err: any) {
    console.error('[Stripe] Deploy service checkout error:', err)
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

    // Send email notification for past-due billing
    if (result.handled && result.updates?.billing_status === 'past_due') {
      const lookupQuery = result.factoryCustomerId
        ? supabase.from('tenants').select('name, email, stripe_subscription_id').eq('id', result.factoryCustomerId).single()
        : result.lookupField && result.lookupValue
          ? supabase.from('tenants').select('name, email, stripe_subscription_id').eq(result.lookupField, result.lookupValue).single()
          : null
      if (lookupQuery) {
        const { data: pastDueTenant } = await lookupQuery
        if (pastDueTenant) {
          notifyBillingPastDue(pastDueTenant).catch(e => console.warn('[Email] Billing past-due notification failed:', e.message))
        }
      }
    }

    return c.json({ received: true })
  } catch (err: any) {
    console.error('[Stripe] Webhook handler error:', err.message)
    return c.json({ error: 'Webhook processing failed' }, 500)
  }
})


// ─── Billing Portal ─────────────────────────────────────────────────────────
factory.post('/customers/:id/billing-portal', requireRole('owner', 'admin'), async (c) => {
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
    // Single query instead of 3 sequential queries (fixes 23s response times)
    const { data: tenants } = await supabase.from('tenants')
      .select('name, monthly_amount, one_time_amount, paid_at, plan, email, billing_type, billing_status')
      .or('billing_status.eq.active,billing_status.eq.past_due,billing_type.eq.one_time')

    const all = tenants || []
    const subscriptions = all.filter((t: any) => t.billing_type === 'subscription' && t.billing_status === 'active')
      .map((t: any) => ({ name: t.name, monthly_amount: t.monthly_amount, plan: t.plan }))
    const oneTime = all.filter((t: any) => t.billing_type === 'one_time')
      .map((t: any) => ({ name: t.name, one_time_amount: t.one_time_amount, paid_at: t.paid_at }))
    const pastDue = all.filter((t: any) => t.billing_status === 'past_due')
      .map((t: any) => ({ name: t.name, monthly_amount: t.monthly_amount, email: t.email }))

    const mrr = subscriptions.reduce((sum: number, t: any) => sum + (parseFloat(t.monthly_amount) || 0), 0)
    const totalOneTime = oneTime.reduce((sum: number, t: any) => sum + (parseFloat(t.one_time_amount) || 0), 0)

    return c.json({
      mrr,
      arr: mrr * 12,
      totalOneTimeRevenue: totalOneTime,
      activeSubscriptions: subscriptions.length,
      pastDueCount: pastDue.length,
      pastDueCustomers: pastDue,
      subscriptions,
      oneTimeCustomers: oneTime,
    })
  } catch (err: any) {
    console.error('[Billing] Summary error:', err)
    return c.json({ mrr: 0, arr: 0, totalOneTimeRevenue: 0, activeSubscriptions: 0, pastDueCount: 0 })
  }
})


// ─── Analytics ──────────────────────────────────────────────────────────────
factory.get('/analytics', async (c) => {
  try {
    // Parallel queries instead of sequential (fixes slow response times)
    const [tenantsRes, jobsRes, ticketsRes] = await Promise.all([
      supabase.from('tenants').select('id, created_at, plan, monthly_amount, features, products, status'),
      supabase.from('factory_jobs').select('status'),
      supabase.from('support_tickets').select('status, resolved_at, created_at, rating'),
    ])

    const all = tenantsRes.data || []

    // Revenue by month
    const revByMonth: Record<string, { mrr: number; count: number }> = {}
    for (const t of all) {
      if (!t.created_at) continue
      const m = t.created_at.slice(0, 7)
      if (!revByMonth[m]) revByMonth[m] = { mrr: 0, count: 0 }
      revByMonth[m].mrr += parseFloat(t.monthly_amount) || 0
      revByMonth[m].count += 1
    }
    const revenueByMonth = Object.entries(revByMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, mrr: Math.round(v.mrr * 100) / 100, count: v.count }))

    // Customer growth
    const growthByMonth: Record<string, number> = {}
    for (const t of all) {
      if (!t.created_at) continue
      const m = t.created_at.slice(0, 7)
      growthByMonth[m] = (growthByMonth[m] || 0) + 1
    }
    const sortedMonths = Object.keys(growthByMonth).sort()
    let cumulative = 0
    const customerGrowth = sortedMonths.map(month => {
      const newCount = growthByMonth[month]
      cumulative += newCount
      return { month, total: cumulative, new: newCount }
    })

    // Plan distribution
    const planCounts: Record<string, number> = {}
    for (const t of all) {
      const p = t.plan || 'unknown'
      planCounts[p] = (planCounts[p] || 0) + 1
    }
    const planDistribution = Object.entries(planCounts).map(([plan, count]) => ({ plan, count }))

    // Deploy metrics from factory_jobs
    const allJobs = jobsRes.data || []
    const deployMetrics = {
      total: allJobs.length,
      successful: allJobs.filter((j: any) => j.status === 'deployed' || j.status === 'complete').length,
      failed: allJobs.filter((j: any) => j.status === 'failed').length,
    }

    // Ticket metrics
    const allTickets = ticketsRes.data || []
    const openTickets = allTickets.filter((t: any) => t.status === 'open' || t.status === 'in_progress').length
    const resolved = allTickets.filter((t: any) => t.resolved_at && t.created_at)
    let avgResolutionHours = 0
    if (resolved.length > 0) {
      const totalHours = resolved.reduce((sum: number, t: any) => {
        return sum + (new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime()) / 3600000
      }, 0)
      avgResolutionHours = Math.round((totalHours / resolved.length) * 10) / 10
    }
    const rated = allTickets.filter((t: any) => t.rating != null)
    const avgRating = rated.length > 0
      ? Math.round((rated.reduce((s: number, t: any) => s + t.rating, 0) / rated.length) * 10) / 10
      : 0

    const ticketMetrics = { open: openTickets, avgResolutionHours, avgRating }

    // Feature adoption from tenants.features JSON
    const featureCounts: Record<string, number> = {}
    for (const t of all) {
      const feats = Array.isArray(t.features) ? t.features : []
      for (const f of feats) {
        if (typeof f === 'string') featureCounts[f] = (featureCounts[f] || 0) + 1
      }
    }
    const featureAdoption = Object.entries(featureCounts)
      .map(([feature, count]) => ({ feature, count }))
      .sort((a, b) => b.count - a.count)

    // Top products from tenants.products
    const productCounts: Record<string, number> = {}
    for (const t of all) {
      const prods = Array.isArray(t.products) ? t.products : []
      for (const p of prods) {
        if (typeof p === 'string') productCounts[p] = (productCounts[p] || 0) + 1
      }
    }
    const topProducts = Object.entries(productCounts)
      .map(([product, count]) => ({ product, count }))
      .sort((a, b) => b.count - a.count)

    return c.json({
      revenueByMonth,
      customerGrowth,
      planDistribution,
      deployMetrics,
      ticketMetrics,
      featureAdoption,
      topProducts,
    })
  } catch (err: any) {
    console.error('[Analytics] Error:', err)
    return c.json({ error: 'Failed to load analytics' }, 500)
  }
})


// ─── Plans (public) ─────────────────────────────────────────────────────────
factory.get('/plans', (c) => {
  return c.json({
    plans: [
      { id: 'starter', name: 'Starter', monthlyPrice: 49, annualPrice: 39, users: { included: 2, max: 2 }, features: ['Contacts / CRM', 'Jobs & Work Orders', 'Quotes & Invoicing', 'Payment Processing', 'Time & Expense Tracking', 'Documents', 'Customer Portal', 'Mobile App'] },
      { id: 'pro', name: 'Pro', monthlyPrice: 149, annualPrice: 119, users: { included: 5, max: 10, additionalPrice: 29 }, highlight: true, features: ['Everything in Starter', 'Team Management', 'Two-Way SMS', 'GPS & Geofencing', 'Route Optimization', 'Online Booking', 'Review Requests', 'Pricebook', 'QuickBooks Sync', 'Job Costing Reports'] },
      { id: 'business', name: 'Business', monthlyPrice: 299, annualPrice: 239, users: { included: 15, max: 25, additionalPrice: 29 }, features: ['Everything in Pro', 'Inventory Management', 'Fleet Management', 'Equipment Tracking', 'Email Campaigns', 'Call Tracking', 'Automations', 'Custom Forms', 'Consumer Financing', 'Advanced Reporting'] },
      { id: 'construction', name: 'Construction', monthlyPrice: 599, annualPrice: 479, users: { included: 20, max: 50, additionalPrice: 29 }, features: ['Everything in Business', 'Project Management', 'Change Orders', 'RFIs & Submittals', 'Daily Logs', 'Punch Lists & Inspections', 'Bid Management', 'Gantt Charts', 'Selections Portal', 'Takeoffs', 'Lien Waivers', 'Draw Schedules (AIA)'] },
      { id: 'enterprise', name: 'Enterprise', monthlyPrice: 199, annualPrice: 159, perUser: true, users: { min: 10, max: null }, features: ['Everything Included', 'Unlimited Users', 'API Access', 'White-Label Options', 'Custom Domain', 'SSO Integration', 'Priority Support', 'Dedicated Account Manager', 'Custom Integrations', 'SLA & Uptime Guarantee'] },
    ],
    selfHosted: [
      { id: 'starter', name: 'Starter License', price: 997 },
      { id: 'pro', name: 'Pro License', price: 2497 },
      { id: 'business', name: 'Business License', price: 4997 },
      { id: 'construction', name: 'Construction License', price: 9997 },
      { id: 'full', name: 'Full Platform License', price: 14997 },
    ],
    selfHostedAddons: [
      { id: 'installation', name: 'Installation Service', price: 500, type: 'one_time' },
      { id: 'updates_yearly', name: 'Update Subscription', price: 999, type: 'yearly' },
      { id: 'support_monthly', name: 'Support Contract', price: 199, type: 'monthly' },
      { id: 'white_label', name: 'White-Label Setup', price: 500, type: 'one_time' },
      { id: 'custom_dev', name: 'Custom Development', price: 150, type: 'per_hour' },
    ],
    deployServices: [
      { id: 'basic', name: 'Basic', price: 299, description: 'CRM + website setup, login credentials, live URL' },
      { id: 'full', name: 'Full Setup', price: 499, description: 'Basic + data import, integrations, 30-min walkthrough' },
      { id: 'white-glove', name: 'White Glove', price: 699, description: 'Full concierge: website content, data migration, team training, 30-day support' },
    ],
    addons: [
      { id: 'sms', name: 'SMS Communication', price: 39 },
      { id: 'gps_field', name: 'GPS & Field', price: 49 },
      { id: 'inventory', name: 'Inventory Management', price: 49 },
      { id: 'fleet', name: 'Fleet Management', price: 39 },
      { id: 'equipment', name: 'Equipment Tracking', price: 29 },
      { id: 'marketing', name: 'Marketing Suite', price: 59 },
      { id: 'construction_pm', name: 'Construction PM', price: 149 },
      { id: 'compliance', name: 'Compliance & Draws', price: 79 },
      { id: 'selections_takeoffs', name: 'Selections & Takeoffs', price: 49 },
      { id: 'service_contracts', name: 'Service Contracts', price: 39 },
      { id: 'forms', name: 'Custom Forms', price: 29 },
      { id: 'integrations', name: 'Integrations', price: 49 },
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
      website_theme: body.website_theme || null,
    }

    const { data: tenant, error: insertErr } = await supabase.from('tenants').insert(tenantRecord).select().single()
    if (insertErr) {
      console.error('[Signup] Insert error:', insertErr.message)
      return c.json({ error: 'Failed to create account. Please try again.' }, 500)
    }

    console.log('[Signup] New tenant created:', tenant.id, tenant.name, tenant.plan)

    // If Stripe is configured and this is a SaaS subscription, create a checkout session
    let checkoutUrl = null
    if (factoryStripe.isConfigured() && tenantRecord.deployment_model === 'saas') {
      try {
        const result = await factoryStripe.createSubscriptionCheckout(
          { id: tenant.id, email: tenant.email, name: tenant.name, phone: tenant.phone, stripeCustomerId: null },
          { planId: tenant.plan || 'starter', billingCycle: 'monthly', trialDays: 14 }
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
  // Single query instead of 3 sequential queries (fixes 23s response times)
  const { data: all } = await supabase.from('support_tickets')
    .select('status, priority, rating, sla_resolve_due')

  const tickets = all || []
  const stats: Record<string, number> = { open: 0, in_progress: 0, waiting: 0, resolved: 0, closed: 0, total: 0 }
  const now = new Date().toISOString()
  let slaBreach = 0
  const ratings: number[] = []

  for (const t of tickets) {
    stats[t.status] = (stats[t.status] || 0) + 1
    stats.total++
    // SLA breach check inline
    if ((t.status === 'open' || t.status === 'in_progress') && t.sla_resolve_due && t.sla_resolve_due < now) {
      slaBreach++
    }
    // Collect ratings inline
    if (t.rating != null) ratings.push(t.rating)
  }

  stats.sla_breached = slaBreach
  const avgRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null

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

// Create ticket (from Factory dashboard, editor+)
factory.post('/support/tickets', requireRole('owner', 'admin', 'editor'), async (c) => {
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

  // Send email notification for new ticket
  if (ticket) {
    const { data: ticketTenant } = await supabase.from('tenants').select('email').eq('id', body.tenant_id).single()
    notifyNewTicket(ticket, ticketTenant?.email).catch(e => console.warn('[Email] New ticket notification failed:', e.message))
  }

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

  // Send email notification for ticket reply (skip internal notes)
  if (data && !body.is_internal) {
    const { data: fullTicket } = await supabase.from('support_tickets').select('number, subject, submitter_email, tenant_id').eq('id', ticketId).single()
    if (fullTicket) {
      const { data: replyTenant } = await supabase.from('tenants').select('email').eq('id', fullTicket.tenant_id).single()
      notifyTicketReply(fullTicket, data, replyTenant?.email).catch(e => console.warn('[Email] Ticket reply notification failed:', e.message))
    }
  }

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

factory.post('/preview', requireRole('owner', 'admin', 'editor'), async (c) => {
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
factory.post('/customers/:id/domain', requireRole('owner', 'admin'), async (c) => {
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


// ─── Settings: Current User Profile ──────────────────────────────────────────
factory.get('/settings/profile', async (c) => {
  try {
    const userId = c.get('userId')
    const { data, error } = await supabase
      .from('factory_users')
      .select('id, auth_id, email, name, role, created_at')
      .eq('auth_id', userId)
      .maybeSingle()
    if (error) throw error
    return c.json(data || { email: '', name: '', role: 'viewer' })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

factory.patch('/settings/profile', async (c) => {
  try {
    const userId = c.get('userId')
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const { name } = parsed.data
    const { data, error } = await supabase
      .from('factory_users')
      .update({ name })
      .eq('auth_id', userId)
      .select('id, auth_id, email, name, role, created_at')
      .single()
    if (error) throw error
    return c.json(data)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ─── Settings: Team Management (owner/admin only) ────────────────────────────
factory.get('/settings/users', requireRole('owner', 'admin'), async (c) => {
  try {
    const { data, error } = await supabase
      .from('factory_users')
      .select('id, auth_id, email, name, role, created_at')
      .order('created_at', { ascending: true })
    if (error) throw error
    return c.json(data || [])
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

factory.post('/settings/users', requireRole('owner', 'admin'), async (c) => {
  try {
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const { email, role } = parsed.data
    if (!email) return c.json({ error: 'email is required' }, 400)
    const validRoles = ['admin', 'editor', 'viewer']
    if (!role || !validRoles.includes(role)) return c.json({ error: 'role must be one of: ' + validRoles.join(', ') }, 400)

    // Check if user already exists
    const { data: existing } = await supabase
      .from('factory_users')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (existing) return c.json({ error: 'User with this email already exists' }, 409)

    // Create a placeholder entry — auth_id will be filled when they log in
    // For now use a deterministic UUID from email or generate one
    const { data: authUser } = await supabase.auth.admin.getUserByEmail(email)
    const authId = authUser?.user?.id || null

    if (authId) {
      const { data, error } = await supabase
        .from('factory_users')
        .insert({ auth_id: authId, email, role })
        .select('id, auth_id, email, name, role, created_at')
        .single()
      if (error) throw error
      return c.json(data, 201)
    } else {
      // Invite user via Supabase Auth
      const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email)
      if (inviteErr) throw inviteErr
      if (!invited?.user) return c.json({ error: 'Failed to create invitation' }, 500)
      const { data, error } = await supabase
        .from('factory_users')
        .insert({ auth_id: invited.user.id, email, role })
        .select('id, auth_id, email, name, role, created_at')
        .single()
      if (error) throw error
      return c.json(data, 201)
    }
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

factory.patch('/settings/users/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const targetId = c.req.param('id')
    if (!UUID_RE.test(targetId)) return c.json({ error: 'Invalid user ID format' }, 400)
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const { role } = parsed.data
    const validRoles = ['owner', 'admin', 'editor', 'viewer']
    if (!role || !validRoles.includes(role)) return c.json({ error: 'role must be one of: ' + validRoles.join(', ') }, 400)

    // Prevent non-owners from assigning owner role
    const callerRole = c.get('userRole')
    if (role === 'owner' && callerRole !== 'owner') return c.json({ error: 'Only owners can assign owner role' }, 403)

    // Prevent demoting the last owner
    if (role !== 'owner') {
      const { data: target } = await supabase.from('factory_users').select('role').eq('id', targetId).single()
      if (target?.role === 'owner') {
        const { count } = await supabase.from('factory_users').select('id', { count: 'exact', head: true }).eq('role', 'owner')
        if (count && count <= 1) return c.json({ error: 'Cannot demote the last owner' }, 400)
      }
    }

    const { data, error } = await supabase
      .from('factory_users')
      .update({ role })
      .eq('id', targetId)
      .select('id, auth_id, email, name, role, created_at')
      .single()
    if (error) throw error
    return c.json(data)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

factory.delete('/settings/users/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const targetId = c.req.param('id')
    if (!UUID_RE.test(targetId)) return c.json({ error: 'Invalid user ID format' }, 400)

    // Prevent removing the last owner
    const { data: target } = await supabase.from('factory_users').select('role').eq('id', targetId).single()
    if (target?.role === 'owner') {
      const { count } = await supabase.from('factory_users').select('id', { count: 'exact', head: true }).eq('role', 'owner')
      if (count && count <= 1) return c.json({ error: 'Cannot remove the last owner' }, 400)
    }

    // Prevent removing yourself
    const callerFactoryUserId = c.get('factoryUserId')
    if (callerFactoryUserId === targetId) return c.json({ error: 'Cannot remove yourself' }, 400)

    const { error } = await supabase.from('factory_users').delete().eq('id', targetId)
    if (error) throw error
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ─── Settings: Integration Status ────────────────────────────────────────────
factory.get('/settings/integrations', async (c) => {
  try {
    const integrations = {
      render: { configured: !!(process.env.RENDER_API_KEY), label: 'Render' },
      github: { configured: !!(process.env.GITHUB_TOKEN), label: 'GitHub' },
      stripe: { configured: !!(process.env.STRIPE_SECRET_KEY), label: 'Stripe' },
      sendgrid: { configured: !!(process.env.SENDGRID_API_KEY), label: 'SendGrid' },
      supabase_visualizer: { configured: !!(process.env.VISION_SUPABASE_URL && process.env.VISION_SUPABASE_SERVICE_KEY), label: 'Vision Supabase' },
      qb_online: { configured: !!(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET), label: 'QuickBooks Online' },
      qb_desktop: { configured: !!(process.env.QBWC_PASSWORD), label: 'QuickBooks Desktop' },
    }
    return c.json(integrations)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


export default factory
