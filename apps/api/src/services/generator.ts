/**
 * Twomiah Factory — Generator Service
 * Ported from TwomiahBuild/backend/src/services/factory/generator.js
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'
import AdmZip from 'adm-zip'
import bcrypt from 'bcryptjs'

const TEMPLATES_ROOT = process.env.FACTORY_TEMPLATES_DIR || path.resolve(process.cwd(), '..', '..', 'templates')
const OUTPUT_DIR = process.env.FACTORY_OUTPUT_DIR || path.resolve(process.cwd(), '..', '..', 'generated')

const TEXT_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.ejs', '.html', '.css', '.json',
  '.md', '.txt', '.yml', '.yaml', '.xml', '.svg', '.env', '.sql',
  '.prisma', '.template', '.mjs', '.toml',
])

const SKIP_PATTERNS = ['node_modules', '.git', 'package-lock.json', '.DS_Store']

export interface GenerateConfig {
  tenant_id?: string
  products: string[]
  websiteTheme?: string
  company: {
    name: string
    legalName?: string
    email?: string
    adminEmail?: string
    phone?: string
    address?: string
    city?: string
    state?: string
    stateFull?: string
    zip?: string
    domain?: string
    ownerName?: string
    industry?: string
    serviceRegion?: string
    nearbyCities?: string[]
    description?: string
    defaultPassword?: string
    heroTagline?: string
  }
  branding: {
    primaryColor?: string
    secondaryColor?: string
    logo?: string
    logoFilename?: string
    favicon?: string
    faviconFilename?: string
    heroPhoto?: string
    heroPhotoFilename?: string
    websiteTheme?: string
  }
  features: {
    website?: string[]
    crm?: string[]
    paid_ads?: boolean
  }
  integrations?: {
    twilio?: { accountSid?: string; authToken?: string; phoneNumber?: string }
    sendgrid?: { apiKey?: string }
    stripe?: { secretKey?: string; publishableKey?: string; webhookSecret?: string }
    googleMaps?: { apiKey?: string }
    sentry?: { dsn?: string }
  }
  content?: {
    services?: string[]
    customServices?: Array<{ id: string; name: string; desc: string }>
    heroTagline?: string
    aboutText?: string
    ctaText?: string
    serviceDescriptions?: Record<string, { short?: string; long?: string }>
  }
}

export interface GenerateResult {
  zipPath: string
  zipName: string
  buildId: string
  slug: string
  defaultPassword: string
}

export async function generate(config: GenerateConfig): Promise<GenerateResult> {
  if (!fs.existsSync(TEMPLATES_ROOT)) {
    throw new Error(
      'Templates directory not found at ' + TEMPLATES_ROOT + '. ' +
      'Set FACTORY_TEMPLATES_DIR env var or ensure templates/ exists at monorepo root.'
    )
  }

  const buildId = crypto.randomUUID()
  const workDir = path.join(OUTPUT_DIR, buildId)
  const slug = slugify(config.company.name)
  fs.mkdirSync(workDir, { recursive: true })

  const defaultPassword = config.company?.defaultPassword || generatePassword()
  config = { ...config, company: { ...config.company, defaultPassword } }

  const tokens = buildTokenMap(config, slug)

  try {
    const products = config.products || []

    if (products.includes('website')) {
      const industry = config.company?.industry || ''
      let websiteTemplate = 'website-general'
      if (industry === 'home_care') websiteTemplate = 'website-homecare'
      else if (industry && industry !== 'other') websiteTemplate = 'website-contractor'

      copyTemplate(websiteTemplate, path.join(workDir, 'website'), tokens)
      injectCSSColors(path.join(workDir, 'website'), config.branding, industry)

      // Inject website theme if specified
      const theme = config.websiteTheme || config.branding?.websiteTheme
      if (theme) {
        const themeCssPath = path.join(TEMPLATES_ROOT, websiteTemplate, 'build', 'styles', 'themes', `${theme}.css`)
        if (fs.existsSync(themeCssPath)) {
          const themeCss = fs.readFileSync(themeCssPath, 'utf8')
          const mainCssPath = path.join(workDir, 'website', 'build', 'styles', 'main.css')
          if (fs.existsSync(mainCssPath)) {
            fs.appendFileSync(mainCssPath, '\n\n/* ═══ Theme: ' + theme + ' ═══ */\n' + themeCss)
          }
        }
      }

      stripWebsiteFeatures(path.join(workDir, 'website'), config.features?.website || [])
      writeBrandingAssets(path.join(workDir, 'website'), config.branding)
      injectWizardContent(path.join(workDir, 'website'), config)
      seedHelpArticles(path.join(workDir, 'website'))
      processEnvTemplate(path.join(workDir, 'website'), tokens)

      const websiteRenderTemplate = path.join(workDir, 'website', 'render.yaml.template')
      if (fs.existsSync(websiteRenderTemplate)) {
        let renderContent = fs.readFileSync(websiteRenderTemplate, 'utf8')
        renderContent = injectTokens(renderContent, tokens)
        fs.writeFileSync(path.join(workDir, 'render.yaml'), renderContent, 'utf8')
        fs.writeFileSync(path.join(workDir, 'website', 'render.yaml'), renderContent, 'utf8')
        fs.unlinkSync(websiteRenderTemplate)
      }

      if (products.includes('cms')) {
        copyTemplate('cms', path.join(workDir, 'website', 'admin'), tokens)
        writeBrandingAssets(path.join(workDir, 'website', 'admin'), config.branding)
      }
    } else if (products.includes('cms')) {
      copyTemplate('cms', path.join(workDir, 'cms'), tokens)
      writeBrandingAssets(path.join(workDir, 'cms'), config.branding)
    }

    if (products.includes('crm')) {
      const crmIndustry = config.company?.industry || ''
      const crmTemplate = crmIndustry === 'home_care' ? 'crm-homecare' : 'crm'
      const crmOutputDir = crmTemplate
      copyTemplate(crmTemplate, path.join(workDir, crmOutputDir), tokens)
      processCRM(path.join(workDir, crmOutputDir), config, tokens)
      writeBrandingAssets(path.join(workDir, crmOutputDir, 'frontend', 'public'), config.branding)
    }

    if (products.includes('vision')) {
      cloneVisionRepo(path.join(workDir, 'vision'))
    }

    generateReadme(workDir, config, tokens)
    generateDeployScript(workDir, config, products)

    const zipName = slug + '-' + buildId.split('-')[0] + '-twomiah-build.zip'
    const zipPath = path.join(OUTPUT_DIR, zipName)
    await createZip(workDir, zipPath)

    fs.rmSync(workDir, { recursive: true, force: true })

    return { zipPath, zipName, buildId, slug, defaultPassword }

  } catch (err) {
    if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true })
    throw err
  }
}


function buildTokenMap(config: GenerateConfig, slug: string): Record<string, string> {
  const c = config.company || ({} as GenerateConfig['company'])
  const b = config.branding || {}
  const industry = c.industry || ''

  const ownerParts = (c.ownerName || 'Admin User').split(' ')
  const firstName = ownerParts[0] || 'Admin'
  const lastName = ownerParts.slice(1).join(' ') || 'User'
  const defaultPassword = c.defaultPassword || generatePassword()

  return {
    '{{COMPANY_NAME}}': c.name || 'My Company',
    '{{COMPANY_LEGAL_NAME}}': c.legalName || (c.name || 'My Company') + ' LLC',
    '{{COMPANY_NAME_UPPER}}': (c.name || 'My Company').toUpperCase(),
    '{{COMPANY_SLUG}}': slug,
    '{{COMPANY_SLUG_UNDERSCORE}}': slug.replace(/-/g, '_'),
    '{{COMPANY_NAME_SLUG}}': pascalCase(c.name || 'MyCompany'),
    '{{COMPANY_EMAIL}}': c.email || 'info@' + slug + '.com',
    '{{COMPANY_SHORT}}': (c.name || 'Co').split(' ').map((w: string) => w[0]).join('').toUpperCase().substring(0, 4),
    '{{COMPANY_PHONE}}': c.phone || '(555) 000-0000',
    '{{COMPANY_PHONE_RAW}}': (c.phone || '5550000000').replace(/\D/g, ''),
    '{{COMPANY_ADDRESS}}': c.address || '123 Main St',
    '{{COMPANY_DESCRIPTION}}': c.description || 'Professional services from ' + (c.name || 'our company') + '.',
    '{{CITY}}': c.city || 'Your City',
    '{{STATE}}': c.state || 'ST',
    '{{STATE_FULL}}': c.stateFull || c.state || 'ST',
    '{{ZIP}}': c.zip || '00000',
    '{{SERVICE_REGION}}': c.serviceRegion || c.city || 'the area',
    '{{NEARBY_CITY_1}}': (c.nearbyCities || [])[0] || 'Nearby City 1',
    '{{NEARBY_CITY_2}}': (c.nearbyCities || [])[1] || 'Nearby City 2',
    '{{NEARBY_CITY_3}}': (c.nearbyCities || [])[2] || 'Nearby City 3',
    '{{NEARBY_CITY_4}}': (c.nearbyCities || [])[3] || 'Nearby City 4',
    '{{DOMAIN}}': c.domain || slug + '.com',
    '{{COMPANY_DOMAIN}}': c.domain || slug + '.com',
    '{{SITE_URL}}': 'https://' + (c.domain || slug + '.com'),
    '{{COMPANY_WEBSITE}}': 'https://' + (c.domain || slug + '.com'),
    '{{FRONTEND_URL}}': industry === 'home_care' ? 'https://' + slug + '-care.onrender.com' : 'https://' + slug + '-crm.onrender.com',
    '{{BACKEND_URL}}': industry === 'home_care' ? 'https://' + slug + '-care-api.onrender.com' : 'https://' + slug + '-api.onrender.com',
    '{{INDUSTRY}}': c.industry || 'Contractor',
    '{{META_DESCRIPTION}}': industry === 'home_care'
      ? 'Professional in-home care services in ' + (c.city || 'your area') + '. Licensed, insured, compassionate caregivers.'
      : 'Professional services in ' + (c.city || 'your area') + '.',
    '{{HERO_TAGLINE}}': config.content?.heroTagline || c.heroTagline || (industry === 'home_care' ? 'VA APPROVED PROVIDER' : 'Trusted ' + (c.industry || 'Contractor')),
    '{{HERO_BADGE}}': config.content?.heroTagline || (industry === 'home_care' ? 'Compassionate In-Home Care' : 'Licensed & Insured'),
    '{{HERO_TITLE}}': industry === 'home_care' ? 'Compassionate Home Care for Your Loved Ones' : (c.name || 'Your Company') + ' — Quality You Can Trust',
    '{{HERO_DESCRIPTION}}': industry === 'home_care'
      ? 'Helping families in ' + (c.city || 'your area') + ' with personalized, professional in-home care.'
      : 'Serving ' + (c.serviceRegion || c.city || 'the area') + ' with quality workmanship.',
    '{{TRUST_BADGE_1}}': industry === 'home_care' ? 'Licensed & Insured' : 'Licensed & Insured',
    '{{TRUST_BADGE_2}}': industry === 'home_care' ? 'Background Checked Caregivers' : 'Free Estimates',
    '{{RENDER_DOMAIN}}': slug + '-site.onrender.com',
    '{{ABOUT_TEXT}}': config.content?.aboutText || (industry === 'home_care'
      ? (c.name || 'We') + ' provide compassionate in-home care services throughout ' + (c.city || 'the area') + '.'
      : (c.name || 'We') + ' deliver quality workmanship to homeowners throughout ' + (c.serviceRegion || c.city || 'the area') + '.'),
    '{{CTA_TEXT}}': config.content?.ctaText || (industry === 'home_care'
      ? 'Ready to discuss care options for your loved one?'
      : 'Ready to start your project? Get a free estimate today.'),
    '{{OWNER_NAME}}': c.ownerName || 'Admin',
    '{{OWNER_FIRST_NAME}}': firstName,
    '{{OWNER_LAST_NAME}}': lastName,
    '{{ADMIN_EMAIL}}': c.adminEmail || c.email || 'admin@' + slug + '.com',
    '{{DEFAULT_PASSWORD}}': defaultPassword,
    '{{HASHED_DEFAULT_PASSWORD}}': bcrypt.hashSync(defaultPassword, 10),
    '{{PRIMARY_COLOR}}': b.primaryColor || (industry === 'home_care' ? '#009688' : '#f97316'),
    '{{SECONDARY_COLOR}}': b.secondaryColor || (industry === 'home_care' ? '#004d40' : '#1e3a5f'),
    '{{ACCENT_COLOR}}': '#f59e0b',
    '{{OFF_WHITE_COLOR}}': industry === 'home_care' ? '#f0fdf9' : '#f8f9fa',
    '{{PRODUCTS_JSON}}': JSON.stringify(config.products || ['crm']),
    '{{CMS_URL}}': (config.products || []).includes('cms') ? 'https://' + slug + '-site.onrender.com/admin' : '',
    '{{JWT_SECRET}}': crypto.randomBytes(32).toString('hex'),
    '{{JWT_REFRESH_SECRET}}': crypto.randomBytes(32).toString('hex'),
    '{{ENCRYPTION_KEY}}': crypto.randomBytes(32).toString('hex'),
    '{{ENABLE_SANDATA_EVV}}': 'false',
    '{{ENABLE_GUSTO}}': 'false',
    '{{ENABLE_WORCS}}': 'false',
    '{{DATABASE_URL}}': 'postgresql://USER:PASSWORD@HOST:5432/' + slug + '_crm',
    '{{TWILIO_ACCOUNT_SID}}': (config.integrations?.twilio?.accountSid || '').trim(),
    '{{TWILIO_AUTH_TOKEN}}': (config.integrations?.twilio?.authToken || '').trim(),
    '{{TWILIO_PHONE_NUMBER}}': (config.integrations?.twilio?.phoneNumber || '').trim(),
    '{{SENDGRID_API_KEY}}': (config.integrations?.sendgrid?.apiKey || '').trim(),
    '{{STRIPE_SECRET_KEY}}': (config.integrations?.stripe?.secretKey || '').trim(),
    '{{STRIPE_PUBLISHABLE_KEY}}': (config.integrations?.stripe?.publishableKey || '').trim(),
    '{{STRIPE_WEBHOOK_SECRET}}': (config.integrations?.stripe?.webhookSecret || '').trim(),
    '{{GOOGLE_MAPS_API_KEY}}': (config.integrations?.googleMaps?.apiKey || '').trim(),
    '{{SENTRY_DSN}}': (config.integrations?.sentry?.dsn || '').trim(),
  }
}


function cloneVisionRepo(destDir: string) {
  const repo = 'https://github.com/Jeremiahandson1/home-visualizer.git'
  console.log('[Generator] Cloning Vision repo into', destDir)
  const result = spawnSync('git', ['clone', '--depth', '1', '-b', 'master', repo, destDir], { stdio: ['pipe', 'pipe', 'pipe'] })
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || ''
    throw new Error('Failed to clone Vision repo: ' + stderr)
  }
  // Remove .git directory — this will be part of the customer's repo
  const gitDir = path.join(destDir, '.git')
  if (fs.existsSync(gitDir)) fs.rmSync(gitDir, { recursive: true, force: true })
}

function copyTemplate(templateName: string, destDir: string, tokens: Record<string, string>) {
  const srcDir = path.join(TEMPLATES_ROOT, templateName)
  if (!fs.existsSync(srcDir)) {
    throw new Error('Template not found: ' + templateName + ' (looked in ' + srcDir + ')')
  }
  fs.mkdirSync(destDir, { recursive: true })
  copyAndInject(srcDir, destDir, tokens)
}

function copyAndInject(src: string, dest: string, tokens: Record<string, string>) {
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    if (SKIP_PATTERNS.includes(entry.name)) continue
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true })
      copyAndInject(srcPath, destPath, tokens)
    } else {
      const ext = path.extname(entry.name).toLowerCase()
      const base = entry.name.toLowerCase()
      if (TEXT_EXTS.has(ext) || (base.startsWith('.env') && !base.endsWith('.example')) || base.endsWith('.template')) {
        let content = fs.readFileSync(srcPath, 'utf8')
        content = injectTokens(content, tokens)
        fs.writeFileSync(destPath, content, 'utf8')
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }
}

function injectTokens(content: string, tokens: Record<string, string>): string {
  for (const [token, value] of Object.entries(tokens)) {
    content = content.split(token).join(value)
  }
  return content
}


function processCRM(crmDir: string, config: GenerateConfig, tokens: Record<string, string>) {
  const features = config.features?.crm || []
  const manifest = loadManifest(crmDir)

  // Support both Drizzle (db/) and legacy Prisma (prisma/) seed locations
  const drizzleSeedTemplate = path.join(crmDir, 'backend', 'db', 'seed.template.ts')
  const prismaSeedTemplate = path.join(crmDir, 'backend', 'prisma', 'seed.template.js')
  const seedTemplatePath = fs.existsSync(drizzleSeedTemplate) ? drizzleSeedTemplate : prismaSeedTemplate
  const seedOutputPath = fs.existsSync(drizzleSeedTemplate)
    ? path.join(crmDir, 'backend', 'db', 'seed.ts')
    : path.join(crmDir, 'backend', 'prisma', 'seed.js')
  if (fs.existsSync(seedTemplatePath)) {
    let seedContent = fs.readFileSync(seedTemplatePath, 'utf8')
    const featuresJson = JSON.stringify(features, null, 6).replace(/\n/g, '\n      ')
    seedContent = seedContent.replace('{{ENABLED_FEATURES_JSON}}', featuresJson)
    seedContent = seedContent.replace('{{ENABLED_FEATURES_COUNT}}', features.length + ' features')
    seedContent = injectTokens(seedContent, tokens)
    fs.writeFileSync(seedOutputPath, seedContent, 'utf8')
    fs.unlinkSync(seedTemplatePath)
  }

  if (manifest) stripUnusedCRMFiles(crmDir, features, manifest)

  processEnvTemplate(path.join(crmDir, 'backend'), tokens)
  processEnvTemplate(path.join(crmDir, 'frontend'), tokens)

  const renderTemplatePath = path.join(crmDir, 'render.yaml.template')
  if (fs.existsSync(renderTemplatePath)) {
    let renderContent = fs.readFileSync(renderTemplatePath, 'utf8')
    renderContent = injectTokens(renderContent, tokens)
    const repoRootRenderYaml = path.join(path.dirname(crmDir), 'render.yaml')
    fs.writeFileSync(repoRootRenderYaml, renderContent, 'utf8')
    fs.writeFileSync(path.join(crmDir, 'render.yaml'), renderContent, 'utf8')
    fs.unlinkSync(renderTemplatePath)
  }

  const otherTemplates = findFiles(crmDir, (f: string) => f.endsWith('.template'))
  otherTemplates.forEach((f: string) => {
    const output = f.replace('.template', '')
    let content = fs.readFileSync(f, 'utf8')
    content = injectTokens(content, tokens)
    fs.writeFileSync(output, content, 'utf8')
    fs.unlinkSync(f)
  })

  const manifestPath = path.join(crmDir, 'feature-manifest.json')
  if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath)
}


function stripUnusedCRMFiles(crmDir: string, enabledFeatures: string[], manifest: any) {
  const neededRoutes = new Set<string>()
  const neededServices = new Set<string>()

  if (manifest.core?.backend) {
    (manifest.core.backend.routes || []).forEach((f: string) => neededRoutes.add(f))
    ;(manifest.core.backend.services || []).forEach((f: string) => neededServices.add(f))
  }

  for (const featureId of enabledFeatures) {
    const feature = manifest.features?.[featureId]
    if (!feature?.backend) continue
    ;(feature.backend.routes || []).forEach((f: string) => neededRoutes.add(f))
    ;(feature.backend.services || []).forEach((f: string) => neededServices.add(f))
  }

  const routesDir = path.join(crmDir, 'backend', 'src', 'routes')
  if (fs.existsSync(routesDir)) {
    for (const file of fs.readdirSync(routesDir)) {
      if (file === 'auth.ts' || file === 'factory.ts') continue
      if (!neededRoutes.has(file)) fs.unlinkSync(path.join(routesDir, file))
    }
  }

  const servicesDir = path.join(crmDir, 'backend', 'src', 'services')
  if (fs.existsSync(servicesDir)) {
    for (const entry of fs.readdirSync(servicesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) continue
      if (!neededServices.has(entry.name)) fs.unlinkSync(path.join(servicesDir, entry.name))
    }
  }

  const indexPath = path.join(crmDir, 'backend', 'src', 'index.ts')
  if (fs.existsSync(indexPath)) {
    let indexContent = fs.readFileSync(indexPath, 'utf8')
    const allRouteFiles = new Set(
      (indexContent.match(/from '\.\/routes\/([^']+)'/g) || [])
        .map((m: string) => m.match(/\/([^/]+)'/)?.[1])
        .filter(Boolean)
    )
    for (const routeFile of allRouteFiles) {
      if (!routeFile || neededRoutes.has(routeFile) || routeFile === 'auth.ts' || routeFile === 'factory.ts') continue
      indexContent = indexContent.replace(new RegExp("import \\w+ from './routes/" + routeFile + "';?\\n?", 'g'), '')
      const routeName = routeFile.replace('.ts', '')
      indexContent = indexContent.replace(new RegExp("app\\.(?:use|route)\\('/api/[^']*',\\s*\\w*" + routeName + "\\w*Routes?\\);?\\n?", 'gi'), '')
    }
    fs.writeFileSync(indexPath, indexContent, 'utf8')
  }
}


function processEnvTemplate(dir: string, tokens: Record<string, string>) {
  const templatePath = path.join(dir, '.env.template')
  if (fs.existsSync(templatePath)) {
    let content = fs.readFileSync(templatePath, 'utf8')
    content = injectTokens(content, tokens)
    fs.writeFileSync(path.join(dir, '.env'), content, 'utf8')
    fs.unlinkSync(templatePath)
  }
}

function loadManifest(crmDir: string): any {
  const manifestPath = path.join(crmDir, 'feature-manifest.json')
  if (fs.existsSync(manifestPath)) {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  }
  return null
}

function injectCSSColors(websiteDir: string, branding: GenerateConfig['branding'], _industry: string) {
  const cssPaths = [
    path.join(websiteDir, 'build', 'styles', 'main.css'),
    path.join(websiteDir, 'build', 'css', 'style.css'),
    path.join(websiteDir, 'public', 'css', 'style.css'),
  ]
  for (const cssFile of cssPaths) {
    if (!fs.existsSync(cssFile)) continue
    let css = fs.readFileSync(cssFile, 'utf8')
    if (branding.primaryColor) css = css.replace(/var\(--primary-color\)/g, branding.primaryColor)
    if (branding.secondaryColor) css = css.replace(/var\(--secondary-color\)/g, branding.secondaryColor)
    fs.writeFileSync(cssFile, css, 'utf8')
  }
}

function stripWebsiteFeatures(websiteDir: string, enabledFeatures: string[]) {
  const featureFiles: Record<string, { views?: string[]; data?: string[]; routes?: string[] }> = {
    blog: { views: ['blog.ejs', 'blog-post.ejs'], data: ['posts.json'] },
    gallery: { views: ['gallery.ejs'], data: ['gallery.json'] },
    testimonials: { data: ['testimonials.json'] },
    services_pages: { views: ['service.ejs', 'subservice.ejs'], data: ['services.json'], routes: ['services.ts'] },
    contact_form: { views: ['contact.ejs'], routes: ['leads.ts'] },
    visualizer: { views: ['visualize.html'] },
  }

  for (const [featureId, files] of Object.entries(featureFiles)) {
    if (enabledFeatures.includes(featureId)) continue
    if (files.views) {
      for (const view of files.views) {
        const viewPath = path.join(websiteDir, 'views', view)
        if (fs.existsSync(viewPath)) fs.unlinkSync(viewPath)
      }
    }
    if (files.routes) {
      for (const route of files.routes) {
        const routePath = path.join(websiteDir, 'routes', route)
        if (fs.existsSync(routePath)) fs.unlinkSync(routePath)
      }
    }
    if (files.data) {
      for (const dataFile of files.data) {
        const dataPath = path.join(websiteDir, 'data', dataFile)
        if (fs.existsSync(dataPath)) fs.writeFileSync(dataPath, '[]', 'utf8')
      }
    }
  }

  const navConfigPath = path.join(websiteDir, 'data', 'nav-config.json')
  if (fs.existsSync(navConfigPath)) {
    const navConfig = JSON.parse(fs.readFileSync(navConfigPath, 'utf8'))
    const featureToNav: Record<string, string> = {
      services_pages: 'services', gallery: 'gallery', blog: 'blog', contact_form: 'contact',
    }
    if (navConfig.items) {
      navConfig.items = navConfig.items.map((item: any) => {
        const featureId = Object.entries(featureToNav).find(([, navId]) => navId === item.id)?.[0]
        if (featureId) item.visible = enabledFeatures.includes(featureId)
        return item
      })
    }
    fs.writeFileSync(navConfigPath, JSON.stringify(navConfig, null, 2), 'utf8')
  }
}

function injectWizardContent(websiteDir: string, config: GenerateConfig) {
  const dataDir = path.join(websiteDir, 'data')
  const wizardContent = config.content || {}

  const servicesFile = path.join(dataDir, 'services.json')
  if (fs.existsSync(servicesFile) && (wizardContent.services || wizardContent.customServices)) {
    try {
      let services = JSON.parse(fs.readFileSync(servicesFile, 'utf8'))
      if (wizardContent.services && wizardContent.services.length > 0) {
        services = services.filter((s: any) => wizardContent.services!.includes(s.id))
        services.sort((a: any, b: any) => wizardContent.services!.indexOf(a.id) - wizardContent.services!.indexOf(b.id))
      }
      if (wizardContent.customServices && wizardContent.customServices.length > 0) {
        for (const custom of wizardContent.customServices) {
          if (!services.find((s: any) => s.id === custom.id)) {
            services.push({ id: custom.id, name: custom.name, slug: custom.id, shortDescription: custom.desc || 'Professional ' + custom.name.toLowerCase() + ' services.', description: custom.desc || '', icon: 'star', visible: true, order: services.length + 1 })
          }
        }
      }
      if (wizardContent.serviceDescriptions) {
        services = services.map((s: any) => ({
          ...s,
          shortDescription: wizardContent.serviceDescriptions![s.id]?.short || s.shortDescription,
          description: wizardContent.serviceDescriptions![s.id]?.long || s.description,
        }))
      }
      services = services.map((s: any, i: number) => ({ ...s, order: i + 1 }))
      fs.writeFileSync(servicesFile, JSON.stringify(services, null, 2))
    } catch (e: any) { console.warn('[Factory] Could not inject services:', e.message) }
  }

  const homepageFile = path.join(dataDir, 'homepage.json')
  if (fs.existsSync(homepageFile)) {
    try {
      const homepage = JSON.parse(fs.readFileSync(homepageFile, 'utf8'))
      if (wizardContent.aboutText) homepage.aboutText = wizardContent.aboutText
      if (wizardContent.ctaText) homepage.ctaText = wizardContent.ctaText
      if (wizardContent.heroTagline) homepage.heroTagline = wizardContent.heroTagline
      fs.writeFileSync(homepageFile, JSON.stringify(homepage, null, 2))
    } catch (e: any) { console.warn('[Factory] Could not inject homepage content:', e.message) }
  }
}

function seedHelpArticles(websiteDir: string) {
  const dataDir = path.join(websiteDir, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const helpFile = path.join(dataDir, 'help-articles.json')
  const articles = [
    { id: crypto.randomUUID(), title: 'Getting Started with Your Website', content: 'Welcome to your website CMS! Use the admin panel to manage pages, blog posts, media, and site settings. Navigate using the sidebar to access different management sections.', category: 'Getting Started', tags: [], is_faq: true, published: true, sort_order: 1, view_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: crypto.randomUUID(), title: 'Managing Pages', content: 'Create and edit pages from the Pages section. Each page has a title, content, SEO settings, and layout options. Use the visual editor to add text, images, and custom HTML. Pages can be nested under parent pages for organized navigation.', category: 'Content', tags: [], is_faq: false, published: true, sort_order: 2, view_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: crypto.randomUUID(), title: 'How do I add images?', content: 'Go to the Media section to upload images. You can organize images into folders, add alt text for accessibility, and optimize images automatically. Once uploaded, insert images into any page using the editor toolbar.', category: 'Media', tags: [], is_faq: true, published: true, sort_order: 3, view_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: crypto.randomUUID(), title: 'Blog Posts', content: 'Create blog posts from the Blog section. Add a title, content, featured image, and SEO metadata. Posts can be saved as drafts or published immediately. Use categories and tags to organize your content.', category: 'Content', tags: [], is_faq: false, published: true, sort_order: 4, view_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: crypto.randomUUID(), title: 'How do I update the navigation menu?', content: 'Go to Menus in the admin panel to customize your navigation. You can show/hide menu items, reorder them, and add links to custom pages. Changes are reflected on the live site after saving.', category: 'Navigation', tags: [], is_faq: true, published: true, sort_order: 5, view_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: crypto.randomUUID(), title: 'SEO Settings', content: 'Each page has SEO fields: meta title, meta description, and open graph image. Use the SEO analyzer in the page editor to get suggestions for improving search engine visibility. Keep titles under 60 characters and descriptions under 160 characters.', category: 'SEO', tags: [], is_faq: false, published: true, sort_order: 6, view_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: crypto.randomUUID(), title: 'Managing Leads', content: 'Form submissions from your contact forms appear in the Leads section. You can view, mark as contacted, add notes, and export leads. Set up email notifications to be alerted when new leads come in.', category: 'Leads', tags: [], is_faq: false, published: true, sort_order: 7, view_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: crypto.randomUUID(), title: 'How do I change my site colors?', content: 'Go to Site Settings to update your brand colors, logo, favicon, and other global settings. Changes to colors will be applied across your entire website theme.', category: 'Settings', tags: [], is_faq: true, published: true, sort_order: 8, view_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ]
  fs.writeFileSync(helpFile, JSON.stringify(articles, null, 2))
}

function writeBrandingAssets(targetDir: string, branding: GenerateConfig['branding']) {
  const imagesDir = path.join(targetDir, 'build', 'images')
  fs.mkdirSync(imagesDir, { recursive: true })
  const buildDir = path.join(targetDir, 'build')

  if (branding.logo?.startsWith('data:')) {
    const ext = getExtFromDataUrl(branding.logo) || 'png'
    writeDataUrl(branding.logo, path.join(imagesDir, 'logo.' + ext))
    // Also write to targetDir root for Vite-based projects (CRM frontend/public/)
    writeDataUrl(branding.logo, path.join(targetDir, 'logo.' + ext))
    updateSettingsField(targetDir, 'logo', '/images/logo.' + ext)
  }

  if (branding.favicon?.startsWith('data:')) {
    writeDataUrl(branding.favicon, path.join(buildDir, 'favicon.png'))
    writeDataUrl(branding.favicon, path.join(buildDir, 'favicon.ico'))
    // Also write to targetDir root for Vite-based projects (CRM frontend/public/)
    writeDataUrl(branding.favicon, path.join(targetDir, 'favicon.png'))
    writeDataUrl(branding.favicon, path.join(targetDir, 'favicon.ico'))
    updateSettingsField(targetDir, 'favicon', '/favicon.png')
  }

  if (branding.heroPhoto?.startsWith('data:')) {
    const ext = getExtFromDataUrl(branding.heroPhoto) || 'jpg'
    const heroPath = path.join(imagesDir, 'hero.' + ext)
    writeDataUrl(branding.heroPhoto, heroPath)
    const homepageFile = path.join(targetDir, 'data', 'homepage.json')
    if (fs.existsSync(homepageFile)) {
      try {
        const hp = JSON.parse(fs.readFileSync(homepageFile, 'utf8'))
        if (!hp.hero) hp.hero = {}
        hp.hero.image = '/images/hero.' + ext
        fs.writeFileSync(homepageFile, JSON.stringify(hp, null, 2))
      } catch (_e) { /* ignore */ }
    }
  }
}

function getExtFromDataUrl(dataUrl: string): string | null {
  const match = dataUrl.match(/data:image\/([\w+.-]+)/)
  if (match) {
    const type = match[1].toLowerCase()
    if (type === 'jpeg') return 'jpg'
    if (type === 'svg+xml') return 'svg'
    if (type === 'x-icon' || type === 'vnd.microsoft.icon') return 'ico'
    return type
  }
  return null
}

function writeDataUrl(dataUrl: string, filePath: string) {
  const base64 = dataUrl.split(',')[1]
  if (base64) fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
}

function updateSettingsField(dir: string, field: string, value: string) {
  const paths = [path.join(dir, 'data', 'settings.json'), path.join(dir, 'settings.json')]
  for (const settingsPath of paths) {
    if (fs.existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
        settings[field] = value
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
      } catch (_e) { /* skip */ }
      break
    }
  }
}

function generateReadme(workDir: string, config: GenerateConfig, tokens: Record<string, string>) {
  const products = config.products || []
  const name = config.company?.name || 'Your Company'
  const slug = tokens['{{COMPANY_SLUG}}']
  let readme = '# ' + name + ' — Software Package\n\nGenerated by Twomiah Factory on ' + new Date().toISOString().split('T')[0] + '\n\n'
  readme += '## Admin Credentials\n\n- **Email:** `' + tokens['{{ADMIN_EMAIL}}'] + '`\n- **Password:** `' + tokens['{{DEFAULT_PASSWORD}}'] + '`\n- ⚠️ Change the default password after first login!\n\n'
  if (products.includes('crm')) {
    const crmDir = (config.company?.industry === 'home_care') ? 'crm-homecare' : 'crm'
    readme += '## CRM (`/' + crmDir + '`)\n\n```bash\ncd ' + crmDir + '/backend && bun install\nbunx drizzle-kit migrate && bun db/seed.ts\nbun start\n```\n\n'
  }
  if (products.includes('website')) {
    readme += '## Website (`/website`)\n\n```bash\ncd website && bun install && bun start\n```\n\n'
  }
  if (products.includes('vision')) {
    readme += '## Twomiah Vision (`/vision`)\n\nAI home exterior visualizer (Next.js).\n\n```bash\ncd vision && npm install && npm run build && npm start\n```\n\nRequires env vars: see `vision/env.example`\n\n'
  }
  readme += '## Deploy to Render\n\nPush to GitHub and select `render.yaml` as your Render Blueprint.\n'
  fs.writeFileSync(path.join(workDir, 'README.md'), readme, 'utf8')
}

function generateDeployScript(workDir: string, config: GenerateConfig, products: string[]) {
  let script = '#!/bin/bash\nset -e\n\n'
  if (products.includes('website')) script += 'cd website && bun install && cd ..\n'
  const crmScriptDir = (config.company?.industry === 'home_care') ? 'crm-homecare' : 'crm'
  if (products.includes('crm')) script += 'cd ' + crmScriptDir + '/backend && bun install && bunx drizzle-kit migrate && bun db/seed.ts && cd ../..\ncd ' + crmScriptDir + '/frontend && bun install && bun run build && cd ../..\n'
  script += '\necho "✅ Done!"\n'
  const scriptPath = path.join(workDir, 'deploy.sh')
  fs.writeFileSync(scriptPath, script, 'utf8')
  fs.chmodSync(scriptPath, '755')
}

function createZip(sourceDir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const zip = new AdmZip()
      zip.addLocalFolder(sourceDir)
      zip.writeZip(outputPath)
      resolve()
    } catch (err) {
      reject(err)
    }
  })
}

function findFiles(dir: string, predicate: (name: string) => boolean): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory() && !SKIP_PATTERNS.includes(entry.name)) {
      results.push(...findFiles(fullPath, predicate))
    } else if (predicate(entry.name)) {
      results.push(fullPath)
    }
  }
  return results
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40)
}

function pascalCase(name: string): string {
  return name.replace(/(?:^|\s|-)(\w)/g, (_, c) => c.toUpperCase()).replace(/\s/g, '')
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const max = 256 - (256 % chars.length) // reject values >= max to avoid modulo bias
  let pw = ''
  while (pw.length < 8) {
    const byte = crypto.randomBytes(1)[0]
    if (byte < max) pw += chars[byte % chars.length]
  }
  return pw + '!'
}

export function listTemplates(): string[] {
  if (!fs.existsSync(TEMPLATES_ROOT)) return []
  return fs.readdirSync(TEMPLATES_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
}

export function cleanOldBuilds(maxAge = 24 * 60 * 60 * 1000): number {
  if (!fs.existsSync(OUTPUT_DIR)) return 0
  let cleaned = 0
  const now = Date.now()
  for (const file of fs.readdirSync(OUTPUT_DIR)) {
    const filePath = path.join(OUTPUT_DIR, file)
    const stat = fs.statSync(filePath)
    if (now - stat.mtimeMs > maxAge) {
      try { fs.rmSync(filePath, { recursive: true, force: true }); cleaned++ } catch (_e) { /* ignore */ }
    }
  }
  return cleaned
}
