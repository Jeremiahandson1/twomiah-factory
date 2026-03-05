require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

// Routes — loaded conditionally so missing optional route files don't crash the server
const adminRoutes = require('./routes/admin');
const servicesRoutes = (() => { try { return require('./routes/services'); } catch(e) { const r = require('express').Router(); r.get('/', (_, res) => res.json([])); return r; } })();
const { startSchedule: startBackups } = require('./services/autoBackup');
const { rebuildMiddleware } = (() => { try { return require('./services/rebuild-middleware'); } catch(e) { return { rebuildMiddleware: (req, res, next) => next() }; } })();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;

// Ensure uploads directory exists
const appPaths = require('./config/paths');
const uploadsDir = appPaths.uploads;
const BASE_URL = process.env.SITE_URL || '{{SITE_URL}}';

// EJS view engine for public website pages
const ejs = require('ejs');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ===========================================
// MIDDLEWARE
// ===========================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// Rate limiting for contact form
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: 'Too many submissions. Please try again in 15 minutes.'
  }
});

// General API rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

// Admin rate limiting
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200
});

// ===========================================
// API ROUTES
// ===========================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/services', apiLimiter, servicesRoutes);
app.use('/api/admin', adminLimiter, rebuildMiddleware, adminRoutes);

// Apply stricter rate limit to admin lead submission
app.post('/api/admin/leads', contactLimiter);

// ===========================================
// STATIC FILES
// ===========================================

// Website static assets (CSS, JS, images, favicon)
app.use(express.static(path.join(__dirname, 'build')));
app.use(express.static(path.join(__dirname, 'public')));

// CMS admin panel (React SPA built by Vite with base: '/admin/')
const adminDist = path.join(__dirname, 'admin', 'dist');
if (fs.existsSync(adminDist)) {
  app.use('/admin', express.static(adminDist));
  app.get('/admin*', (req, res) => {
    res.sendFile(path.join(adminDist, 'index.html'));
  });
}

// ===========================================
// DATA HELPERS
// ===========================================

function loadJSON(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(appPaths.data, filename), 'utf8'));
  } catch (e) { return null; }
}

function renderPage(res, pageView, locals = {}, statusCode = 200) {
  const settings = loadJSON('settings.json') || {};
  const navConfig = loadJSON('nav-config.json') || {};
  const menuItems = Array.isArray(navConfig.items) ? navConfig.items : Array.isArray(navConfig) ? navConfig : [];
  const shared = { settings, menuItems, BASE_URL, ...locals };
  const pageFile = path.join(__dirname, 'views', pageView + '.ejs');
  ejs.renderFile(pageFile, shared, (err, body) => {
    if (err) { console.error('EJS page error:', err.message); return res.status(500).send('Render error'); }
    res.status(statusCode).render('base', { ...shared, body });
  });
}

// ===========================================
// PAGE ROUTES
// ===========================================

app.get('/', (req, res) => {
  const homepage = loadJSON('homepage.json') || {};
  const services = loadJSON('services.json') || [];
  const testimonials = loadJSON('testimonials.json') || [];
  const settings = loadJSON('settings.json') || {};
  renderPage(res, 'home', {
    homepage, services, testimonials,
    title: settings.seoTitle || settings.companyName || '{{COMPANY_NAME}}',
    description: settings.seoDescription || 'Professional contractor services',
    canonicalUrl: BASE_URL + '/',
  });
});

app.get('/services/:slug', (req, res) => {
  const services = loadJSON('services.json') || [];
  const service = services.find(s => s.slug === req.params.slug);
  if (!service) return res.status(404).send('Service not found');
  renderPage(res, 'service', {
    service, services,
    title: service.seoTitle || service.name + ' | {{COMPANY_NAME}}',
    description: service.seoDescription || service.shortDescription || '',
    canonicalUrl: BASE_URL + '/services/' + service.slug,
  });
});

app.get('/contact', (req, res) => {
  const services = loadJSON('services.json') || [];
  renderPage(res, 'contact', {
    services, selectedService: req.query.service || '',
    title: 'Contact Us | {{COMPANY_NAME}}',
    description: 'Get in touch for a free estimate.',
    canonicalUrl: BASE_URL + '/contact',
  });
});

app.get('/gallery', (req, res) => {
  const gallery = loadJSON('gallery.json') || [];
  renderPage(res, 'gallery', {
    gallery,
    title: 'Gallery | {{COMPANY_NAME}}',
    description: 'See our completed projects.',
    canonicalUrl: BASE_URL + '/gallery',
  });
});

app.get('/blog', (req, res) => {
  const posts = (loadJSON('posts.json') || []).filter(p => p.published !== false);
  renderPage(res, 'blog', {
    posts,
    title: 'Blog | {{COMPANY_NAME}}',
    description: 'News, tips, and project updates.',
    canonicalUrl: BASE_URL + '/blog',
  });
});

app.get('/blog/:slug', (req, res) => {
  const posts = loadJSON('posts.json') || [];
  const post = posts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).send('Post not found');
  renderPage(res, 'blog-post', {
    post, posts,
    title: post.seoTitle || post.title + ' | {{COMPANY_NAME}}',
    description: post.seoDescription || post.excerpt || '',
    canonicalUrl: BASE_URL + '/blog/' + post.slug,
  });
});

app.get('/p/:pageId', (req, res) => {
  const pages = loadJSON('pages.json') || {};
  const page = pages[req.params.pageId];
  if (!page) return res.status(404).send('Page not found');
  renderPage(res, 'custom-page', {
    page,
    title: page.seoTitle || page.title || req.params.pageId,
    description: page.seoDescription || '',
    canonicalUrl: BASE_URL + '/p/' + req.params.pageId,
  });
});

// ===========================================
// ERROR HANDLING
// ===========================================

// API 404 handler
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    });
  }
  res.status(500).send('Something went wrong. Please try again.');
});

// ===========================================
// START SERVER
// ===========================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🏠 {{COMPANY_NAME}}                                  ║
║                                                            ║
║   Server running on port ${PORT}                             ║
║   Environment: ${process.env.NODE_ENV || 'development'}                            ║
║   Uploads: ${uploadsDir}
║   Mode: Server-rendered (EJS) + CMS Admin                        ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);

  startBackups();
});

module.exports = app;
