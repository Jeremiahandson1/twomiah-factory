import { supabase, requireRole } from '../../middleware/auth'
import { generate, listTemplates, type GenerateConfig } from '../../services/generator'
import { isConfigured } from '../../services/deploy'
import { uploadZip, getZipDownloadUrl } from '../../services/factoryStorage'
import fs from 'fs'
import path from 'path'
import { type FactoryApp, parseJsonBody, UUID_RE } from './shared'

export function registerGenerationRoutes(factory: FactoryApp) {
// ─── Generate (editor+) ───────────────────────────────────────────────────────
factory.post('/generate', requireRole('owner', 'admin', 'editor'), async (c) => {
  try {
    const config = await c.req.json() as GenerateConfig
    if (!config.products?.length) return c.json({ error: 'At least one product must be selected' }, 400)
    if (!config.company?.name) return c.json({ error: 'Company name is required' }, 400)

    const validProducts = ['website', 'website-premium', 'cms', 'crm', 'vision', 'pricing']
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
    const { companyName, city, state, stateFull, industry, services, serviceRegion, ownerName, description, phone, email, domain, nearbyCities, mode } = parsed.data
    if (!companyName) return c.json({ error: 'companyName is required' }, 400)
    if (!process.env.ANTHROPIC_API_KEY) return c.json({ error: 'AI content generation not configured (missing ANTHROPIC_API_KEY)' }, 503)

    // Full AI generation mode — generates all website data files
    if (mode === 'full') {
      const { generateWebsiteContent } = await import('../../services/contentGenerator')
      const result = await generateWebsiteContent({
        businessName: companyName,
        businessType: industry || 'general business',
        location: { city: city || '', state: state || '', stateFull: stateFull || '' },
        services: services || [],
        description: description || '',
        serviceRegion,
        nearbyCities: nearbyCities || [],
        phone, email, ownerName, domain,
      })
      return c.json(result)
    }

    // Legacy mode — simple hero/about/cta generation
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
    // Small call (1K tokens) — don't let it tie up a worker for the SDK's 10-min default
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 2 })
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
}
