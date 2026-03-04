require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const ejs = require('ejs');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.BASE_URL || 'https://{{RENDER_DOMAIN}}';

// ─── Paths ────────────────────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production';
const dataDir = isProd
  ? path.join(__dirname, 'persistent/data')
  : path.join(__dirname, 'data');
const uploadsDir = isProd
  ? path.join(__dirname, 'persistent/uploads')
  : path.join(__dirname, 'data/uploads');
const buildDir = path.join(__dirname, 'build');   // static assets (CSS, images)
const viewsDir = path.join(__dirname, 'views');

// Ensure dirs exist
[dataDir, uploadsDir].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// In production, seed missing data files and merge new fields into existing ones
if (isProd) {
  const repoDataDir = path.join(__dirname, 'data');
  if (fs.existsSync(repoDataDir)) {
    fs.readdirSync(repoDataDir).filter(f => f.endsWith('.json')).forEach(f => {
      const dest = path.join(dataDir, f);
      const src  = path.join(repoDataDir, f);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        console.log('[Boot] Seeded:', f);
      } else {
        // Merge new keys from repo defaults into persistent (never overwrite existing values)
        try {
          const existing = JSON.parse(fs.readFileSync(dest, 'utf8'));
          const defaults = JSON.parse(fs.readFileSync(src, 'utf8'));
          let changed = false;
          for (const key of Object.keys(defaults)) {
            if (!(key in existing)) {
              existing[key] = defaults[key];
              changed = true;
              console.log('[Boot] Merged new field "' + key + '" into', f);
            }
          }
          if (changed) fs.writeFileSync(dest, JSON.stringify(existing, null, 2));
        } catch(e) {
          console.error('[Boot] Merge failed for', f, e.message);
        }
      }
    });
  }
}

// ─── Data helpers ─────────────────────────────────────────────────────────────
function readData(filename, fallback = null) {
  // Try persistent dir first, then repo data
  const files = [
    path.join(dataDir, filename),
    path.join(__dirname, 'data', filename)
  ];
  for (const f of files) {
    if (fs.existsSync(f)) {
      try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
      catch (e) { console.error(`[Data] Failed to parse ${f}:`, e.message); }
    }
  }
  return fallback;
}

function getBaseData() {
  return {
    settings:    readData('settings.json', {}),
    navConfig:   readData('nav-config.json', { items: [] }),
    services:    readData('services.json', []).filter(s => s.active !== false),
    testimonials: (readData('testimonials.json', []) || []).filter(t => t.approved),
    BASE_URL
  };
}

// ─── EJS renderer ─────────────────────────────────────────────────────────────
// Renders a page body view, then wraps it in base.ejs
async function renderPage(res, viewName, pageData = {}) {
  try {
    const base = readData('settings.json', {});
    const { settings, navConfig, services, testimonials } = getBaseData();

    const viewFile = path.join(viewsDir, `${viewName}.ejs`);
    if (!fs.existsSync(viewFile)) {
      return render404(res, { settings, navConfig, services, BASE_URL });
    }

    const viewTemplate = fs.readFileSync(viewFile, 'utf8');

    // All data available inside page templates
    const templateLocals = {
      settings, navConfig, services, testimonials, BASE_URL,
      ...pageData
    };

    // Render inner page content
    const bodyHtml = await ejs.render(viewTemplate, templateLocals, {
      async: true,
      filename: viewFile   // needed for relative includes
    });

    // Render base layout with page content
    const baseTemplate = fs.readFileSync(path.join(viewsDir, 'base.ejs'), 'utf8');
    const fullHtml = await ejs.render(baseTemplate, {
      ...templateLocals,
      body: bodyHtml
    }, { async: true, filename: path.join(viewsDir, 'base.ejs') });

    res.send(fullHtml);
  } catch (err) {
    console.error(`[Render] Error rendering ${viewName}:`, err.message);
    res.status(500).send(`
      <h1>Server Error</h1>
      <p>${process.env.NODE_ENV !== 'production' ? err.message : 'Something went wrong. Please try again.'}</p>
    `);
  }
}

async function render404(res, extraData = {}) {
  try {
    const base = getBaseData();
    const viewFile = path.join(viewsDir, '404.ejs');
    const baseFile = path.join(viewsDir, 'base.ejs');

    if (!fs.existsSync(viewFile) || !fs.existsSync(baseFile)) {
      return res.status(404).send('<h1>404 — Page Not Found</h1><p><a href="/">Return home</a></p>');
    }

    const locals = { ...base, ...extraData };
    const bodyHtml = await ejs.render(fs.readFileSync(viewFile, 'utf8'), locals, {
      async: true, filename: viewFile
    });
    const fullHtml = await ejs.render(fs.readFileSync(baseFile, 'utf8'), { ...locals, body: bodyHtml }, {
      async: true, filename: baseFile
    });
    res.status(404).send(fullHtml);
  } catch (e) {
    res.status(404).send('<h1>404 — Page Not Found</h1>');
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : [BASE_URL, 'http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static assets: build/ has CSS, images, scripts, favicon
app.use(express.static(buildDir));

// Admin panel (React SPA built from admin/)
const adminDist = path.join(__dirname, 'admin', 'dist');
if (fs.existsSync(adminDist)) {
  app.use('/admin', express.static(adminDist));
  app.get('/admin', (req, res) => res.sendFile(path.join(adminDist, 'index.html')));
  app.get('/admin/*', (req, res) => res.sendFile(path.join(adminDist, 'index.html')));
}
// Serve uploads
app.use('/uploads', express.static(uploadsDir));
// Also serve public/ folder
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const apiLimiter   = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const leadLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 5,
  message: { success: false, message: 'Too many submissions. Please try again in 15 minutes.' }
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(buildDir, 'favicon.ico'));
});
app.get('/favicon.png', (req, res) => {
  res.sendFile(path.join(buildDir, 'favicon.png'));
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminLimiter, adminRoutes);
app.post('/api/admin/leads', leadLimiter);

// Try to load leads route
try {
  const leadsRoutes = require('./routes/leads');
  app.use('/api/leads', apiLimiter, leadsRoutes);
} catch (e) {
  console.log('[Boot] No leads route found');
}

// Services API
app.get('/api/services', (req, res) => {
  const services = readData('services.json', []);
  res.json(services.filter(s => s.active !== false));
});

// ─── Page Routes ──────────────────────────────────────────────────────────────

// Home
app.get('/', async (req, res) => {
  const homepage     = readData('homepage.json', {});
  const gallery      = readData('gallery.json', []);
  const posts        = readData('posts.json', []);
  const featuredProjects = gallery.filter(p => p.featured).slice(0, 6);
  const recentPosts  = posts.filter(p => p.status === 'published').slice(0, 3);

  await renderPage(res, 'home', {
    homepage,
    featuredProjects,
    recentPosts,
    title: readData('settings.json', {}).defaultMetaTitle || '{{COMPANY_NAME}} — Eau Claire, WI',
    description: readData('settings.json', {}).defaultMetaDescription || 'Professional in-home care services across Chippewa Valley.',
    canonicalUrl: BASE_URL
  });
});

// Contact
app.get('/contact', async (req, res) => {
  await renderPage(res, 'contact', {
    title: 'Contact Us | {{COMPANY_NAME}}',
    description: 'Request a free in-home assessment or reach out to our care coordinators.',
    canonicalUrl: `${BASE_URL}/contact`,
    selectedService: req.query.service || ''
  });
});

// Services listing
app.get('/services', async (req, res) => {
  await renderPage(res, 'home', {   // falls back to home if no services.ejs
    homepage: readData('homepage.json', {}),
    title: 'Our Services | {{COMPANY_NAME}}',
    description: 'Comprehensive in-home care services in Eau Claire and Chippewa Valley.',
    canonicalUrl: `${BASE_URL}/services`
  });
});

// Individual service pages
app.get('/services/:slug', async (req, res) => {
  const services = readData('services.json', []);
  const service  = services.find(s => s.slug === req.params.slug);
  if (!service) return render404(res);

  // Use custom-page or service template if available
  const viewFile = path.join(viewsDir, 'custom-page.ejs');
  await renderPage(res, fs.existsSync(viewFile) ? 'custom-page' : 'home', {
    page:        service,
    title:       `${service.title} | {{COMPANY_NAME}}`,
    description: service.description || service.shortDescription || '',
    canonicalUrl: `${BASE_URL}/services/${service.slug}`
  });
});

// Blog listing
app.get('/blog', async (req, res) => {
  const posts = (readData('posts.json', []) || []).filter(p => p.status === 'published');
  await renderPage(res, 'home', {
    homepage:   readData('homepage.json', {}),
    recentPosts: posts,
    title:      'Blog | {{COMPANY_NAME}}',
    description: 'News and resources from {{COMPANY_NAME}}.',
    canonicalUrl: `${BASE_URL}/blog`
  });
});

// Blog post
app.get('/blog/:slug', async (req, res) => {
  const posts = readData('posts.json', []) || [];
  const post  = posts.find(p => p.slug === req.params.slug && p.status === 'published');
  if (!post) return render404(res);

  await renderPage(res, 'custom-page', {
    page:        { ...post, content: post.content || post.body || '' },
    title:       `${post.title} | {{COMPANY_NAME}}`,
    description: post.excerpt || '',
    canonicalUrl: `${BASE_URL}/blog/${post.slug}`
  });
});

// Gallery
app.get('/gallery', async (req, res) => {
  const gallery = readData('gallery.json', []);
  await renderPage(res, 'home', {
    homepage:        readData('homepage.json', {}),
    featuredProjects: gallery,
    title:           'Gallery | {{COMPANY_NAME}}',
    description:     'Browse our work across Chippewa Valley.',
    canonicalUrl:    `${BASE_URL}/gallery`
  });
});

// Gallery detail
app.get('/gallery/:id', async (req, res) => {
  const gallery = readData('gallery.json', []);
  const project = gallery.find(p => String(p.id) === req.params.id);
  if (!project) return render404(res);

  await renderPage(res, 'project-detail', {
    project,
    title:       `${project.title} | {{COMPANY_NAME}}`,
    description: project.description || '',
    canonicalUrl: `${BASE_URL}/gallery/${project.id}`
  });
});

// Custom pages (from CMS)
app.get('/:slug', async (req, res) => {
  // Skip if looks like a file request
  if (req.params.slug.includes('.')) return render404(res);

  const pages   = readData('pages.json', []);
  const page    = pages.find(p => p.slug === req.params.slug && p.status === 'published');
  if (!page) return render404(res);

  const s = readData('settings.json', {});
  await renderPage(res, 'custom-page', {
    page,
    title:       `${page.title} | ${s.siteName || '{{COMPANY_NAME}}'}`,
    description: page.metaDescription || page.excerpt || '',
    canonicalUrl: `${BASE_URL}/${page.slug}`
  });
});

// ─── 404 catch-all ────────────────────────────────────────────────────────────
app.use(async (req, res) => render404(res));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({
      success: false,
      message: isProd ? 'Internal server error' : err.message
    });
  }
  res.status(500).send('Something went wrong. Please try again.');
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║                                                      ║
║   🏠  {{COMPANY_NAME}}                      ║
║                                                      ║
║   Port:     ${PORT}                                    ║
║   Mode:     ${isProd ? 'Production' : 'Development'}                         ║
║   Data:     ${dataDir}
║                                                      ║
╚══════════════════════════════════════════════════════╝
  `);

  // Start auto-backup service
  try {
    const { startSchedule } = require('./services/autoBackup');
    startSchedule();
  } catch (e) {
    console.log('[Boot] Auto-backup not available:', e.message);
  }
});

module.exports = app;

