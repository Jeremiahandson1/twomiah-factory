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
        features: result.crmFeatures || config.features?.crm || [],   // what the CRM's seed starts with
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


// ─── Deploy ───────────────────────────────────────────────────────────────────
factory.get('/deploy/config', (c) => {
  return c.json({ configured: isConfigured() })
})
}
