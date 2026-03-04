const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { execFile } = require('child_process');

// Paths config — uses persistent disk in production
const appPaths = require('../config/paths');
const dataDir = appPaths.data;
const uploadsDir = appPaths.uploads;

// ── Static site rebuild helper ──
// Spawns build-static.js as a child process after page changes
let rebuildTimer = null;
function triggerRebuild(reason = 'page change') {
  // Debounce: if multiple saves happen quickly, only rebuild once
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    const buildScript = path.join(__dirname, '..', '..', 'build-static.js');
    if (!fs.existsSync(buildScript)) {
      console.log('[rebuild] build-static.js not found at', buildScript);
      return;
    }
    console.log(`[rebuild] Triggering static rebuild (${reason})...`);
    execFile('node', [buildScript], { 
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
      timeout: 60000 
    }, (err, stdout, stderr) => {
      if (err) {
        console.error('[rebuild] Build failed:', err.message);
        if (stderr) console.error('[rebuild] stderr:', stderr);
      } else {
        console.log('[rebuild] Build complete');
        if (stdout) console.log(stdout);
      }
    });
  }, 1000);
}

// Data files
const pagesFile = path.join(dataDir, 'pages.json');
const settingsFile = path.join(dataDir, 'settings.json');
const revisionsFile = path.join(dataDir, 'revisions.json');
const activityFile = path.join(dataDir, 'activity.json');
const leadsFile = path.join(dataDir, 'leads.json');
const trashFile = path.join(dataDir, 'trash.json');
const redirectsFile = path.join(dataDir, 'redirects.json');
const mediaFoldersFile = path.join(dataDir, 'media-folders.json');
const testimonialsFile = path.join(dataDir, 'testimonials.json');
const servicesDataFile = path.join(dataDir, 'services.json');
const homepageFile = path.join(dataDir, 'homepage.json');
const analyticsFile = path.join(dataDir, 'analytics.json');
const previewTokensFile = path.join(dataDir, 'preview-tokens.json');
const templatesFile = path.join(dataDir, 'templates.json');
const galleryFile = path.join(dataDir, 'gallery.json');
const navConfigFile = path.join(dataDir, 'nav-config.json');

// Initialize files
const initFile = (file, defaultData) => {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
  }
};

initFile(pagesFile, {});
initFile(revisionsFile, {});
initFile(activityFile, []);
initFile(leadsFile, []);
initFile(trashFile, []);
initFile(redirectsFile, []);
initFile(mediaFoldersFile, ['Uncategorized']);
initFile(previewTokensFile, {});
initFile(analyticsFile, { pageViews: {}, dailyViews: {} });

// Default navigation config — generic template, customize via CMS admin
initFile(navConfigFile, {
  items: [
    {
      id: 'services', label: 'Services', href: '/services', visible: true,
      children: []
    },
    {
      id: 'gallery', label: 'Gallery', href: '/gallery', visible: true,
      children: []
    },
    {
      id: 'blog', label: 'Blog', href: '/blog', visible: true,
      children: []
    },
    {
      id: 'contact', label: 'Contact', href: '/contact', visible: true,
      children: []
    }
  ]
});

// Default gallery projects — empty, populate via CMS admin
initFile(galleryFile, []);

// Default testimonials — empty, populate via CMS admin
initFile(testimonialsFile, []);

// Default services — empty, configure via CMS admin
initFile(servicesDataFile, []);

// Default homepage content
initFile(homepageFile, {
  hero: {
    tagline: '{{HERO_TAGLINE}}',
    title: '{{COMPANY_NAME}}',
    subtitle: 'Professional {{INDUSTRY}} Services',
    description: 'Serving the {{SERVICE_REGION}} with Quality & Professionalism',
    image: '',
    animation: 'none',
    primaryButtonText: 'Request Free Estimate',
    primaryButtonLink: '#contact',
    secondaryButtonText: 'View Our Work',
    secondaryButtonLink: '/gallery'
  },
  trustBadges: [
    { id: uuidv4(), type: 'google', label: '5.0 Rating', sublabel: 'Google Reviews', enabled: true },
    { id: uuidv4(), type: 'years', label: 'Years', sublabel: 'Experience', enabled: true },
    { id: uuidv4(), type: 'bbb', label: 'A+', sublabel: 'BBB Rating', enabled: true }
  ],
  ctaSection: {
    title: 'Ready to get started?',
    description: "Contact us today for a free consultation and estimate.",
    primaryButtonText: 'Get a Free Estimate',
    primaryButtonLink: '#contact',
    secondaryButtonText: 'Call {{COMPANY_PHONE}}',
    secondaryButtonLink: 'tel:{{COMPANY_PHONE_RAW}}',
    backgroundImage: ''
  },
  serviceAreas: ['{{CITY}}', '{{NEARBY_CITY_1}}', '{{NEARBY_CITY_2}}', '{{NEARBY_CITY_3}}', '{{NEARBY_CITY_4}}'],
  businessHours: {
    monday: { open: '8:00 AM', close: '5:00 PM', closed: false },
    tuesday: { open: '8:00 AM', close: '5:00 PM', closed: false },
    wednesday: { open: '8:00 AM', close: '5:00 PM', closed: false },
    thursday: { open: '8:00 AM', close: '5:00 PM', closed: false },
    friday: { open: '8:00 AM', close: '5:00 PM', closed: false },
    saturday: { open: 'By Appointment', close: '', closed: false },
    sunday: { open: '', close: '', closed: true }
  }
});

// Default content templates
initFile(templatesFile, [
  {
    id: 'about-us',
    name: 'About Us',
    description: 'Standard about page template',
    content: `<h2>Our Story</h2>
<p>{{COMPANY_NAME}} has been proudly serving the {{SERVICE_REGION}} with professional {{INDUSTRY}} services.</p>

<h2>Our Mission</h2>
<p>We are committed to delivering the highest quality workmanship while maintaining honest, transparent communication with every customer.</p>

<h2>Why Choose Us?</h2>
<p><strong>Experienced Team</strong> - Our skilled professionals bring years of expertise to every project.</p>
<p><strong>Quality Materials</strong> - We use only the best materials from trusted manufacturers.</p>
<p><strong>Customer Focused</strong> - Your satisfaction is our top priority.</p>
<p><strong>Licensed &amp; Insured</strong> - Full protection for your peace of mind.</p>`,
    heroDescription: 'Learn about {{COMPANY_NAME}} and our commitment to quality.',
    tagline: 'Quality You Can Trust'
  },
  {
    id: 'faq',
    name: 'FAQ',
    description: 'Frequently asked questions template',
    content: `<h2>Frequently Asked Questions</h2>

<h3>How long does a typical project take?</h3>
<p>Project timelines vary depending on scope. We'll provide a detailed timeline during your estimate.</p>

<h3>Do you offer financing?</h3>
<p>Yes! We offer flexible financing options to help make your project affordable. Contact us to learn about current programs.</p>

<h3>Are you licensed and insured?</h3>
<p>Absolutely. We are fully licensed and carry comprehensive insurance coverage for your protection.</p>

<h3>What areas do you serve?</h3>
<p>We serve {{CITY}} and the surrounding {{SERVICE_REGION}} area.</p>

<h3>What warranties do you offer?</h3>
<p>We stand behind our work with comprehensive warranties. Specific terms vary by service.</p>`,
    heroDescription: 'Get answers to common questions about our services.',
    tagline: 'Your Questions Answered'
  }
]);

// Default settings
if (!fs.existsSync(settingsFile)) {
  const defaultPassword = bcrypt.hashSync('{{DEFAULT_PASSWORD}}', 10);
  fs.writeFileSync(settingsFile, JSON.stringify({
    adminPassword: defaultPassword,
    siteName: '{{COMPANY_NAME}}',
    companyName: '{{COMPANY_LEGAL_NAME}}',
    phone: '{{COMPANY_PHONE}}',
    email: '{{COMPANY_EMAIL}}',
    address: '{{COMPANY_ADDRESS}}',
    city: '{{CITY}}',
    state: '{{STATE}}',
    zip: '{{ZIP}}',
    logo: '',
    favicon: '',
    defaultOgImage: '',
    socialLinks: {
      facebook: '',
      instagram: '',
      twitter: '',
      linkedin: '',
      youtube: '',
      yelp: '',
      googleBusiness: ''
    },
    defaultMetaTitle: '{{COMPANY_NAME}} - {{INDUSTRY}} Services in {{CITY}}',
    defaultMetaDescription: 'Professional {{INDUSTRY}} services in the {{SERVICE_REGION}}. Contact us today for a free estimate.',
    analytics: {
      googleAnalyticsId: '',
      facebookPixelId: '',
      googleTagManagerId: ''
    },
    scripts: {
      headScripts: '',
      bodyStartScripts: '',
      bodyEndScripts: ''
    },
    custom404: {
      title: 'Page Not Found',
      message: "Sorry, the page you're looking for doesn't exist or has been moved.",
      showSearch: true,
      showHomeLink: true,
      showContactLink: true,
      backgroundImage: ''
    },
    robotsTxt: `User-agent: *
Allow: /

Sitemap: {{SITE_URL}}/sitemap.xml`,
    emailNotifications: {
      enabled: false,
      recipient: '{{COMPANY_EMAIL}}',
      smtpHost: '',
      smtpPort: 587,
      smtpUser: '',
      smtpPass: '',
      fromEmail: 'noreply@{{DOMAIN}}',
      fromName: '{{COMPANY_NAME}} Website',
      sendgridApiKey: ''
    },
    twoFactorEnabled: false,
    twoFactorSecret: ''
  }, null, 2));
}

// Helper: Log activity
const logActivity = (action, details = {}) => {
  try {
    const activities = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
    activities.unshift({
      id: uuidv4(),
      action,
      details,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync(activityFile, JSON.stringify(activities.slice(0, 500), null, 2));
  } catch (err) {
    console.error('Activity log error:', err);
  }
};

// Helper: Save revision
const saveRevision = (pageId, content) => {
  try {
    const revisions = JSON.parse(fs.readFileSync(revisionsFile, 'utf8'));
    if (!revisions[pageId]) revisions[pageId] = [];
    revisions[pageId].unshift({
      id: uuidv4(),
      content: JSON.parse(JSON.stringify(content)),
      savedAt: new Date().toISOString()
    });
    revisions[pageId] = revisions[pageId].slice(0, 20);
    fs.writeFileSync(revisionsFile, JSON.stringify(revisions, null, 2));
  } catch (err) {
    console.error('Revision save error:', err);
  }
};

// Helper: Send email notification
const sendEmailNotification = async (lead) => {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const emailConfig = settings.emailNotifications;
    
    if (!emailConfig?.enabled) return;
    
    // Try SendGrid first
    if (emailConfig.sendgridApiKey) {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${emailConfig.sendgridApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{
            to: [{ email: emailConfig.recipient }]
          }],
          from: {
            email: emailConfig.fromEmail,
            name: emailConfig.fromName
          },
          subject: `🏠 New Lead: ${lead.name}`,
          content: [{
            type: 'text/html',
            value: `
              <h2>New Lead from Website</h2>
              <p><strong>Name:</strong> ${lead.name}</p>
              <p><strong>Email:</strong> <a href="mailto:${lead.email}">${lead.email}</a></p>
              <p><strong>Phone:</strong> <a href="tel:${lead.phone}">${lead.phone || 'Not provided'}</a></p>
              <p><strong>Service:</strong> ${lead.service || 'Not specified'}</p>
              <p><strong>Message:</strong></p>
              <p>${lead.message || 'No message'}</p>
              <hr>
              <p><small>Submitted at ${new Date().toLocaleString()}</small></p>
            `
          }]
        })
      });
      
      if (response.ok) {
        logActivity('email_notification_sent', { leadId: lead.id, method: 'sendgrid' });
      }
    }
  } catch (err) {
    console.error('Email notification error:', err);
    logActivity('email_notification_failed', { error: err.message });
  }
};

// Helper: Track page view
// ── Analytics helpers ──────────────────────────────────────────────

function classifyReferrer(referrer = '') {
  if (!referrer) return 'direct';
  const r = referrer.toLowerCase();
  if (/google\.com|googlebot/.test(r)) return 'google';
  if (/bing\.com|yahoo\.com|duckduckgo\.com|baidu\.com/.test(r)) return 'search';
  if (/facebook\.com|instagram\.com|fb\.me|twitter\.com|x\.com|linkedin\.com|pinterest\.com|tiktok\.com/.test(r)) return 'social';
  if (/google\.com\/ads|doubleclick\.net|adwords/.test(r)) return 'paid';
  return 'referral';
}

function classifyDevice(userAgent = '') {
  const ua = userAgent.toLowerCase();
  if (/mobile|android.*mobile|iphone|ipod|blackberry|windows phone/.test(ua)) return 'mobile';
  if (/ipad|android(?!.*mobile)|tablet/.test(ua)) return 'tablet';
  return 'desktop';
}

function ensureAnalyticsSchema(analytics) {
  if (!analytics.pageViews) analytics.pageViews = {};
  if (!analytics.dailyViews) analytics.dailyViews = {};
  if (!analytics.sources) analytics.sources = {};        // { direct: N, google: N, ... }
  if (!analytics.dailySources) analytics.dailySources = {}; // { date: { source: N } }
  if (!analytics.devices) analytics.devices = {};        // { mobile: N, desktop: N, tablet: N }
  if (!analytics.utmCampaigns) analytics.utmCampaigns = {}; // { campaign: N }
  if (!analytics.uniqueSessions) analytics.uniqueSessions = {}; // { date: Set → stored as count }
  return analytics;
}

const trackPageView = (pageId, referrer = '', userAgent = '', utm = {}, sessionId = '') => {
  try {
    const analytics = ensureAnalyticsSchema(
      JSON.parse(fs.readFileSync(analyticsFile, 'utf8'))
    );
    const today = new Date().toISOString().split('T')[0];
    const source = classifyReferrer(referrer);
    const device = classifyDevice(userAgent);

    // Page views
    if (!analytics.pageViews[pageId]) {
      analytics.pageViews[pageId] = { total: 0, daily: {} };
    }
    analytics.pageViews[pageId].total++;
    analytics.pageViews[pageId].daily[today] = (analytics.pageViews[pageId].daily[today] || 0) + 1;

    // Daily totals
    analytics.dailyViews[today] = (analytics.dailyViews[today] || 0) + 1;

    // Traffic sources
    analytics.sources[source] = (analytics.sources[source] || 0) + 1;
    if (!analytics.dailySources[today]) analytics.dailySources[today] = {};
    analytics.dailySources[today][source] = (analytics.dailySources[today][source] || 0) + 1;

    // Device breakdown
    analytics.devices[device] = (analytics.devices[device] || 0) + 1;

    // UTM campaign tracking
    if (utm.campaign) {
      const key = utm.campaign + (utm.source ? ` / ${utm.source}` : '');
      analytics.utmCampaigns[key] = (analytics.utmCampaigns[key] || 0) + 1;
    }

    // Unique sessions (approximate — count distinct sessionIds per day)
    if (sessionId) {
      if (!analytics.uniqueSessions[today]) analytics.uniqueSessions[today] = 0;
      // We store a rolling session hash set in a side file to avoid bloat
      const sessFile = analyticsFile.replace('analytics.json', 'analytics-sessions.json');
      let sessions = {};
      try { sessions = JSON.parse(fs.readFileSync(sessFile, 'utf8')); } catch (e) { /* new file */ }
      if (!sessions[today]) sessions[today] = {};
      if (!sessions[today][sessionId]) {
        sessions[today][sessionId] = 1;
        analytics.uniqueSessions[today] = Object.keys(sessions[today]).length;
        // Keep sessions file to last 7 days only
        const cutoff7 = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
        Object.keys(sessions).forEach(d => { if (d < cutoff7) delete sessions[d]; });
        fs.writeFileSync(sessFile, JSON.stringify(sessions), 'utf8');
      }
    }

    // Prune data older than 90 days
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    ['dailyViews', 'dailySources', 'uniqueSessions'].forEach(key => {
      Object.keys(analytics[key] || {}).forEach(date => {
        if (date < cutoff) delete analytics[key][date];
      });
    });

    fs.writeFileSync(analyticsFile, JSON.stringify(analytics, null, 2));
  } catch (err) {
    console.error('Analytics error:', err);
  }
};

// Helper: Check scheduled pages
const checkScheduledPages = () => {
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const now = new Date();
    let updated = false;
    
    Object.entries(pages).forEach(([id, page]) => {
      if (page.status === 'scheduled' && page.scheduledAt) {
        const scheduledDate = new Date(page.scheduledAt);
        if (scheduledDate <= now) {
          pages[id].status = 'published';
          pages[id].publishedAt = now.toISOString();
          delete pages[id].scheduledAt;
          logActivity('page_auto_published', { pageId: id });
          updated = true;
        }
      }
    });
    
    if (updated) {
      fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
    }
  } catch (err) {
    console.error('Schedule check error:', err);
  }
};

setInterval(checkScheduledPages, 60000);

// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|svg|ico/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = /image/.test(file.mimetype);
    cb(null, ext && mime);
  }
});

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET environment variable is required in production');
}
const jwtSecret = JWT_SECRET || 'dev-secret-do-not-use-in-production';

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  
  try {
    req.admin = jwt.verify(token, jwtSecret);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ============ AUTH ROUTES ============

router.post('/login', (req, res) => {
  const { password, totpCode } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (!bcrypt.compareSync(password, settings.adminPassword)) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    
    if (settings.twoFactorEnabled && settings.twoFactorSecret) {
      if (!totpCode) {
        return res.status(200).json({ requires2FA: true });
      }
    }
    
    const token = jwt.sign({ admin: true }, jwtSecret, { expiresIn: '7d' });
    logActivity('login', { success: true });
    res.json({ token, message: 'Login successful' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/verify', authMiddleware, (req, res) => {
  res.json({ valid: true });
});

router.post('/change-password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (!bcrypt.compareSync(currentPassword, settings.adminPassword)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    settings.adminPassword = bcrypt.hashSync(newPassword, 10);
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    logActivity('password_changed');
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ 2FA ROUTES ============

router.post('/2fa/setup', authMiddleware, (req, res) => {
  try {
    const secret = crypto.randomBytes(20).toString('hex');
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    settings.twoFactorSecret = secret;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    
    const otpauthUrl = `otpauth://totp/{{COMPANY_NAME_SLUG}}Admin?secret=${secret}&issuer={{COMPANY_NAME_SLUG}}`;
    res.json({ secret, otpauthUrl });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/2fa/enable', authMiddleware, (req, res) => {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    settings.twoFactorEnabled = true;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    logActivity('2fa_enabled');
    res.json({ message: '2FA enabled successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/2fa/disable', authMiddleware, (req, res) => {
  const { password } = req.body;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (!bcrypt.compareSync(password, settings.adminPassword)) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    settings.twoFactorEnabled = false;
    settings.twoFactorSecret = '';
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    logActivity('2fa_disabled');
    res.json({ message: '2FA disabled' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ SITE SETTINGS ============

router.get('/site-settings', authMiddleware, (req, res) => {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const { adminPassword, twoFactorSecret, ...publicSettings } = settings;
    publicSettings.twoFactorEnabled = settings.twoFactorEnabled;
    res.json(publicSettings);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/site-settings', authMiddleware, (req, res) => {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const { adminPassword, twoFactorSecret, twoFactorEnabled } = settings;
    
    const updatedSettings = {
      ...req.body,
      adminPassword,
      twoFactorSecret,
      twoFactorEnabled
    };
    
    fs.writeFileSync(settingsFile, JSON.stringify(updatedSettings, null, 2));
    logActivity('settings_updated');
    triggerRebuild('settings updated');
    res.json({ message: 'Settings saved' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/public-settings', (req, res) => {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    res.json({
      siteName: settings.siteName,
      companyName: settings.companyName,
      phone: settings.phone,
      email: settings.email,
      address: settings.address,
      city: settings.city,
      state: settings.state,
      zip: settings.zip,
      logo: settings.logo,
      favicon: settings.favicon,
      socialLinks: settings.socialLinks,
      analytics: settings.analytics,
      scripts: settings.scripts
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ TESTIMONIALS ============

router.get('/testimonials', (req, res) => {
  try {
    const testimonials = JSON.parse(fs.readFileSync(testimonialsFile, 'utf8'));
    res.json(testimonials);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/testimonials', authMiddleware, (req, res) => {
  const { text, author, location, rating, featured, image } = req.body;
  if (!text || !author) return res.status(400).json({ error: 'Text and author required' });
  
  try {
    const testimonials = JSON.parse(fs.readFileSync(testimonialsFile, 'utf8'));
    const newTestimonial = {
      id: uuidv4(),
      text,
      author,
      location: location || '',
      rating: rating || 5,
      featured: featured || false,
      image: image || '',
      createdAt: new Date().toISOString()
    };
    testimonials.push(newTestimonial);
    fs.writeFileSync(testimonialsFile, JSON.stringify(testimonials, null, 2));
    logActivity('testimonial_created', { author });
    triggerRebuild('testimonial created');
    res.json({ message: 'Testimonial added', testimonial: newTestimonial });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/testimonials/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  try {
    const testimonials = JSON.parse(fs.readFileSync(testimonialsFile, 'utf8'));
    const index = testimonials.findIndex(t => t.id === id);
    if (index === -1) return res.status(404).json({ error: 'Testimonial not found' });
    
    testimonials[index] = { ...testimonials[index], ...req.body, updatedAt: new Date().toISOString() };
    fs.writeFileSync(testimonialsFile, JSON.stringify(testimonials, null, 2));
    logActivity('testimonial_updated', { id });
    triggerRebuild('testimonial updated');
    res.json({ message: 'Testimonial updated', testimonial: testimonials[index] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/testimonials/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  try {
    let testimonials = JSON.parse(fs.readFileSync(testimonialsFile, 'utf8'));
    testimonials = testimonials.filter(t => t.id !== id);
    fs.writeFileSync(testimonialsFile, JSON.stringify(testimonials, null, 2));
    logActivity('testimonial_deleted', { id });
    triggerRebuild('testimonial deleted');
    res.json({ message: 'Testimonial deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/testimonials/reorder', authMiddleware, (req, res) => {
  const { order } = req.body;
  try {
    const testimonials = JSON.parse(fs.readFileSync(testimonialsFile, 'utf8'));
    const reordered = order.map(id => testimonials.find(t => t.id === id)).filter(Boolean);
    fs.writeFileSync(testimonialsFile, JSON.stringify(reordered, null, 2));
    res.json({ message: 'Order updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ SERVICES MANAGEMENT ============

router.get('/services-data', (req, res) => {
  try {
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    res.json(services.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Public: Get single service by ID (used by ServicePage)
router.get('/services-data/:id', (req, res) => {
  try {
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    const service = services.find(s => s.id === req.params.id);
    if (!service) return res.status(404).json({ error: 'Service not found' });
    res.json(service);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Public: Get sub-service by parentId/subId (used by SubServicePage)
router.get('/services-data/:serviceId/:subId', (req, res) => {
  try {
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    const parent = services.find(s => s.id === req.params.serviceId);
    if (!parent) return res.status(404).json({ error: 'Service not found' });
    const sub = (parent.subServices || []).find(s => s.id === req.params.subId);
    if (!sub) return res.status(404).json({ error: 'Sub-service not found' });
    res.json({ ...sub, parentId: parent.id, parentTitle: parent.title });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Reorder services (must be before /:id routes so Express doesn't match 'reorder' as an id)
router.put('/services-data/reorder', authMiddleware, (req, res) => {
  const { order } = req.body;
  try {
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    order.forEach((id, index) => {
      const service = services.find(s => s.id === id);
      if (service) service.sortOrder = index + 1;
    });
    services.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    fs.writeFileSync(servicesDataFile, JSON.stringify(services, null, 2));
    res.json({ message: 'Order updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/services-data', authMiddleware, (req, res) => {
  const { id, title } = req.body;
  if (!id || !title) return res.status(400).json({ error: 'ID and title required' });
  
  try {
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    if (services.find(s => s.id === id)) {
      return res.status(400).json({ error: 'Service with this ID already exists' });
    }
    
    const newService = {
      id,
      title,
      description: req.body.description || '',
      image: req.body.image || '',
      icon: req.body.icon || '🔧',
      sortOrder: services.length + 1,
      links: req.body.links || [],
      featured: req.body.featured !== false,
      // Page content fields
      tagline: req.body.tagline || '',
      heroDescription: req.body.heroDescription || '',
      heroImage: req.body.heroImage || '',
      fullDescription: req.body.fullDescription || '',
      offerings: req.body.offerings || [],
      materials: req.body.materials || [],
      features: req.body.features || [],
      faqs: req.body.faqs || []
    };
    services.push(newService);
    fs.writeFileSync(servicesDataFile, JSON.stringify(services, null, 2));
    logActivity('service_created', { id, title });
    triggerRebuild('service created: ' + id);
    res.json({ message: 'Service added', service: newService });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/services-data/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  try {
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    const index = services.findIndex(s => s.id === id);
    if (index === -1) return res.status(404).json({ error: 'Service not found' });
    
    services[index] = { ...services[index], ...req.body };
    fs.writeFileSync(servicesDataFile, JSON.stringify(services, null, 2));
    logActivity('service_updated', { id });
    triggerRebuild('service updated: ' + id);
    res.json({ message: 'Service updated', service: services[index] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/services-data/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  try {
    let services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    services = services.filter(s => s.id !== id);
    fs.writeFileSync(servicesDataFile, JSON.stringify(services, null, 2));
    logActivity('service_deleted', { id });
    triggerRebuild('service deleted: ' + id);
    res.json({ message: 'Service deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ HOMEPAGE CONTENT ============

router.get('/homepage', (req, res) => {
  try {
    const homepage = JSON.parse(fs.readFileSync(homepageFile, 'utf8'));
    res.json(homepage);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/homepage', authMiddleware, (req, res) => {
  try {
    fs.writeFileSync(homepageFile, JSON.stringify(req.body, null, 2));
    logActivity('homepage_updated');
    triggerRebuild('homepage updated');
    res.json({ message: 'Homepage saved' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ CONTENT TEMPLATES ============

router.get('/templates', authMiddleware, (req, res) => {
  try {
    const templates = JSON.parse(fs.readFileSync(templatesFile, 'utf8'));
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/templates', authMiddleware, (req, res) => {
  const { id, name, description, content, heroDescription, tagline } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'ID and name required' });
  
  try {
    const templates = JSON.parse(fs.readFileSync(templatesFile, 'utf8'));
    if (templates.find(t => t.id === id)) {
      return res.status(400).json({ error: 'Template with this ID already exists' });
    }
    
    const newTemplate = { id, name, description, content, heroDescription, tagline };
    templates.push(newTemplate);
    fs.writeFileSync(templatesFile, JSON.stringify(templates, null, 2));
    res.json({ message: 'Template created', template: newTemplate });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ PREVIEW LINKS ============

router.post('/preview-token', authMiddleware, (req, res) => {
  const { pageId } = req.body;
  try {
    const tokens = JSON.parse(fs.readFileSync(previewTokensFile, 'utf8'));
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    tokens[token] = { pageId, expiresAt, createdAt: new Date().toISOString() };
    fs.writeFileSync(previewTokensFile, JSON.stringify(tokens, null, 2));
    
    res.json({ token, expiresAt });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/preview/:token', (req, res) => {
  const { token } = req.params;
  try {
    const tokens = JSON.parse(fs.readFileSync(previewTokensFile, 'utf8'));
    const tokenData = tokens[token];
    
    if (!tokenData || new Date(tokenData.expiresAt) < new Date()) {
      return res.status(404).json({ error: 'Invalid or expired preview link' });
    }
    
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const page = pages[tokenData.pageId];
    
    if (!page) return res.status(404).json({ error: 'Page not found' });
    
    res.json({ page, pageId: tokenData.pageId });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ ANALYTICS ============

router.get('/analytics', authMiddleware, (req, res) => {
  try {
    const raw = JSON.parse(fs.readFileSync(analyticsFile, 'utf8'));
    const analytics = ensureAnalyticsSchema(raw);
    const leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));

    // Period filter: ?period=7 | 30 | 90 (default 30)
    const period = Math.min(90, Math.max(1, parseInt(req.query.period) || 30));
    const cutoff = new Date(Date.now() - period * 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Total page views in period
    const periodViews = Object.entries(analytics.dailyViews)
      .filter(([d]) => d >= cutoff)
      .reduce((s, [, n]) => s + n, 0);
    const totalViews = Object.values(analytics.pageViews).reduce((s, p) => s + p.total, 0);

    // Unique sessions in period
    const periodSessions = Object.entries(analytics.uniqueSessions || {})
      .filter(([d]) => d >= cutoff)
      .reduce((s, [, n]) => s + n, 0);

    // Lead metrics
    const leadsInPeriod = leads.filter(l => {
      const d = (l.createdAt || l.submittedAt || '').slice(0, 10);
      return d >= cutoff;
    });
    const conversionRate = periodViews > 0
      ? ((leadsInPeriod.length / periodViews) * 100).toFixed(2)
      : '0.00';

    // Daily views array for chart
    const dailyArray = [];
    let d = new Date(cutoff);
    const end = new Date(today);
    while (d <= end) {
      const key = d.toISOString().split('T')[0];
      dailyArray.push({
        date: key,
        views: analytics.dailyViews[key] || 0,
        sessions: (analytics.uniqueSessions || {})[key] || 0,
        leads: leads.filter(l => (l.createdAt || l.submittedAt || '').startsWith(key)).length
      });
      d.setDate(d.getDate() + 1);
    }

    // Traffic sources in period
    const sourcesInPeriod = {};
    Object.entries(analytics.dailySources || {})
      .filter(([d]) => d >= cutoff)
      .forEach(([, dayData]) => {
        Object.entries(dayData).forEach(([src, n]) => {
          sourcesInPeriod[src] = (sourcesInPeriod[src] || 0) + n;
        });
      });

    // Source labels for display
    const sourceLabels = {
      google: 'Google Search',
      search: 'Other Search',
      social: 'Social Media',
      paid: 'Paid Ads',
      referral: 'Referral',
      direct: 'Direct / Unknown'
    };
    const sourcesArray = Object.entries(sourcesInPeriod)
      .map(([src, n]) => ({ source: src, label: sourceLabels[src] || src, visits: n }))
      .sort((a, b) => b.visits - a.visits);

    // Devices (all-time, normalized to period if possible)
    const devicesArray = Object.entries(analytics.devices || {})
      .map(([device, n]) => ({ device, count: n }))
      .sort((a, b) => b.count - a.count);

    // Top pages in period
    const topPages = Object.entries(analytics.pageViews)
      .map(([page, data]) => {
        const periodCount = Object.entries(data.daily || {})
          .filter(([d]) => d >= cutoff)
          .reduce((s, [, n]) => s + n, 0);
        return { page, views: periodCount, total: data.total };
      })
      .filter(p => p.views > 0)
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    // UTM campaigns
    const utmArray = Object.entries(analytics.utmCampaigns || {})
      .map(([campaign, visits]) => ({ campaign, visits }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 10);

    // Lead source attribution
    const leadSources = {};
    leads.forEach(l => {
      const src = l.source || classifyReferrer(l.referrer || '');
      leadSources[src] = (leadSources[src] || 0) + 1;
    });
    const leadSourcesArray = Object.entries(leadSources)
      .map(([source, count]) => ({ source, label: sourceLabels[source] || source, count }))
      .sort((a, b) => b.count - a.count);

    // Funnel: views → contact page views → leads submitted
    const contactPageViews = Object.entries(analytics.pageViews)
      .filter(([p]) => p === 'contact' || p === 'contact-us' || p === '/')
      .reduce((s, [, d]) => {
        return s + Object.entries(d.daily || {}).filter(([dt]) => dt >= cutoff).reduce((ss, [, n]) => ss + n, 0);
      }, 0);

    const funnel = [
      { label: 'Total Visitors', value: periodViews },
      { label: 'Viewed Contact Page', value: contactPageViews },
      { label: 'Submitted Form', value: leadsInPeriod.length }
    ];

    res.json({
      period,
      summary: {
        totalViews,
        periodViews,
        todayViews: analytics.dailyViews[today] || 0,
        yesterdayViews: analytics.dailyViews[yesterday] || 0,
        periodSessions,
        totalLeads: leads.length,
        periodLeads: leadsInPeriod.length,
        newLeads: leads.filter(l => l.status === 'new').length,
        conversionRate: parseFloat(conversionRate)
      },
      dailyViews: dailyArray,
      sources: sourcesArray,
      devices: devicesArray,
      topPages,
      utmCampaigns: utmArray,
      leadSources: leadSourcesArray,
      funnel
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/track', (req, res) => {
  const { pageId, referrer, userAgent, utm, sessionId } = req.body;
  if (pageId) {
    trackPageView(pageId, referrer || req.get('Referrer') || '', userAgent || req.get('User-Agent') || '', utm || {}, sessionId || '');
  }
  res.json({ ok: true });
});

// ============ SITEMAP & ROBOTS ============

router.get('/sitemap.xml', (req, res) => {
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    
    const baseUrl = process.env.SITE_URL || '{{SITE_URL}}';
    
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    
    xml += `  <url>\n    <loc>${baseUrl}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;
    
    ['gallery', 'contact'].forEach(page => {
      xml += `  <url>\n    <loc>${baseUrl}/${page}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
    });
    
    services.forEach(service => {
      xml += `  <url>\n    <loc>${baseUrl}/services/${service.id}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
    });
    
    Object.entries(pages).forEach(([id, page]) => {
      if (page.status === 'published' && page.isCustomPage) {
        xml += `  <url>\n    <loc>${baseUrl}/${id}</loc>\n    <lastmod>${page.updatedAt || page.createdAt}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
      }
    });
    
    xml += '</urlset>';
    
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    res.status(500).send('Error generating sitemap');
  }
});

router.get('/robots.txt', (req, res) => {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    res.set('Content-Type', 'text/plain');
    res.send(settings.robotsTxt || 'User-agent: *\nAllow: /');
  } catch (err) {
    res.set('Content-Type', 'text/plain');
    res.send('User-agent: *\nAllow: /');
  }
});

// ============ BROKEN LINK CHECKER ============

router.post('/check-links', authMiddleware, async (req, res) => {
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const brokenLinks = [];
    
    const urlRegex = /href=["']([^"']+)["']/g;
    
    for (const [pageId, page] of Object.entries(pages)) {
      const content = page.content || '';
      let match;
      
      while ((match = urlRegex.exec(content)) !== null) {
        const url = match[1];
        
        if (url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('tel:')) continue;
        
        if (url.startsWith('/') && !url.startsWith('//')) {
          const targetPage = url.replace('/', '').split('/')[0];
          if (targetPage && !pages[targetPage] && !['gallery', 'contact', 'services'].includes(targetPage)) {
            brokenLinks.push({ pageId, url, type: 'internal' });
          }
        }
      }
    }
    
    res.json({ brokenLinks, checkedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ LEADS / FORM SUBMISSIONS ============

router.get('/leads', authMiddleware, (req, res) => {
  try {
    const leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/leads', async (req, res) => {
  const { name, email, phone, service, services, message, source, address } = req.body;
  
  if (!name || (!email && !phone)) {
    return res.status(400).json({ error: 'Name and either email or phone are required' });
  }
  
  try {
    const leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
    const newLead = {
      id: uuidv4(),
      name,
      email,
      phone: phone || '',
      address: address || '',
      service: service || (services ? services.join(', ') : ''),
      message: message || '',
      source: source || 'website',
      status: 'new',
      createdAt: new Date().toISOString(),
      notes: ''
    };
    
    leads.unshift(newLead);
    fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));
    logActivity('lead_received', { name, email });
    
    sendEmailNotification(newLead);
    
    res.json({ message: 'Form submitted successfully', id: newLead.id });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/leads/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  try {
    const leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
    const index = leads.findIndex(l => l.id === id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    
    leads[index] = { ...leads[index], ...updates, updatedAt: new Date().toISOString() };
    fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));
    logActivity('lead_updated', { id, status: updates.status });
    
    res.json({ message: 'Lead updated', lead: leads[index] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/leads/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  
  try {
    let leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
    leads = leads.filter(l => l.id !== id);
    fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));
    logActivity('lead_deleted', { id });
    res.json({ message: 'Lead deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ PAGE ROUTES ============

// Helper: extract pageId from route params (handles both /pages/:pageId and /pages/:parentId/:subId)
function getPageId(req) {
  if (req.params.subId) {
    return `${req.params.parentId}/${req.params.subId}`;
  }
  return decodeURIComponent(req.params.pageId);
}

router.get('/pages', authMiddleware, (req, res) => {
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

function handleGetPage(req, res) {
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const pageId = getPageId(req);
    
    // Check pages.json first
    if (pages[pageId]) return res.json(pages[pageId]);
    
    // Fall back to services.json for sub-service pages
    if (pageId.includes('/')) {
      const [parentId, subId] = pageId.split('/');
      try {
        const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
        const parent = services.find(s => s.id === parentId);
        if (parent && parent.subServices) {
          const sub = parent.subServices.find(s => s.id === subId);
          if (sub) {
            return res.json({
              id: pageId,
              title: sub.title,
              tagline: sub.tagline || '',
              heroDescription: sub.heroDescription || '',
              heroImage: sub.heroImage || '',
              content: sub.description || '',
              description: sub.description || '',
              offerings: sub.offerings || [],
              materials: sub.materials || [],
              features: sub.features || [],
              faqs: sub.faqs || [],
              placement: { type: 'sub-service', parent: parentId },
              isCustomPage: !!sub.isCustomPage,
              status: 'published'
            });
          }
        }
      } catch (e) { /* services.json lookup failed */ }
    }
    
    res.json(null);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}
router.get('/pages/:parentId/:subId', handleGetPage);
router.get('/pages/:pageId', handleGetPage);

function handleUpdatePage(req, res) {
  const pageId = getPageId(req);
  const content = req.body;
  
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    
    if (pages[pageId]) {
      saveRevision(pageId, pages[pageId]);
    }
    
    pages[pageId] = {
      ...(pages[pageId] || {}),
      ...content,
      updatedAt: new Date().toISOString(),
      status: content.status || pages[pageId]?.status || 'published'
    };
    
    if (content.status === 'scheduled' && content.scheduledAt) {
      pages[pageId].scheduledAt = content.scheduledAt;
    }
    
    fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
    
    // ── Sync sub-service edits to services.json ──
    const pagePlacement = content.placement || pages[pageId].placement;
    if (pageId.includes('/') || (pagePlacement && pagePlacement.type === 'sub-service')) {
      const parentId = pageId.includes('/') ? pageId.split('/')[0] : (pagePlacement && pagePlacement.parent);
      const slug = pageId.includes('/') ? pageId.split('/').pop() : pageId;
      
      if (parentId) {
        try {
          const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
          const parent = services.find(s => s.id === parentId);
          if (parent && parent.subServices) {
            const subIdx = parent.subServices.findIndex(s => s.id === slug);
            if (subIdx !== -1) {
              parent.subServices[subIdx] = {
                ...parent.subServices[subIdx],
                title: content.title || parent.subServices[subIdx].title,
                tagline: content.tagline ?? parent.subServices[subIdx].tagline,
                heroDescription: content.heroDescription ?? parent.subServices[subIdx].heroDescription,
                heroImage: content.heroImage ?? parent.subServices[subIdx].heroImage,
                description: content.content || content.description || parent.subServices[subIdx].description,
                offerings: content.offerings || parent.subServices[subIdx].offerings,
                materials: content.materials || parent.subServices[subIdx].materials,
                features: content.features || parent.subServices[subIdx].features,
                faqs: content.faqs || parent.subServices[subIdx].faqs,
                updatedAt: new Date().toISOString()
              };
              fs.writeFileSync(servicesDataFile, JSON.stringify(services, null, 2));
            }
          }
        } catch (svcErr) {
          console.error('Services data sync on update failed:', svcErr);
        }
      }
    }
    
    logActivity('page_saved', { pageId, status: pages[pageId].status });
    triggerRebuild('page saved: ' + pageId);
    res.json({ message: 'Page saved successfully', page: pages[pageId] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}
router.put('/pages/:parentId/:subId', authMiddleware, handleUpdatePage);
router.put('/pages/:pageId', authMiddleware, handleUpdatePage);


function handleDeletePage(req, res) {
  const pageId = getPageId(req);
  
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const slug = pageId.includes('/') ? pageId.split('/').pop() : pageId;
    const parentId = pageId.includes('/') ? pageId.split('/')[0] : null;
    
    // Delete from pages.json if present
    if (pages[pageId]) {
      const trash = JSON.parse(fs.readFileSync(trashFile, 'utf8'));
      trash.unshift({
        id: uuidv4(),
        pageId,
        page: pages[pageId],
        deletedAt: new Date().toISOString()
      });
      fs.writeFileSync(trashFile, JSON.stringify(trash.slice(0, 50), null, 2));
      
      delete pages[pageId];
      fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
    }
    
    // Remove from services.json if it's a sub-service
    let deletedFromServices = false;
    if (parentId) {
      try {
        const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
        const parent = services.find(s => s.id === parentId);
        if (parent && parent.subServices) {
          const before = parent.subServices.length;
          parent.subServices = parent.subServices.filter(s => s.id !== slug);
          if (parent.subServices.length < before) {
            deletedFromServices = true;
            fs.writeFileSync(servicesDataFile, JSON.stringify(services, null, 2));
          }
        }
      } catch (svcErr) {
        console.error('Services data cleanup failed:', svcErr);
      }
    }
    
    // If we didn't find it anywhere, 404
    if (!pages[pageId] === undefined && !deletedFromServices) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    // Remove from nav config
    try {
      const navConfig = JSON.parse(fs.readFileSync(navConfigFile, 'utf8'));
      navConfig.items.forEach(item => {
        if (item.children) {
          item.children = item.children.filter(c => c.id !== slug && c.customPageId !== pageId);
        }
      });
      fs.writeFileSync(navConfigFile, JSON.stringify(navConfig, null, 2));
    } catch (navErr) { /* nav cleanup is non-critical */ }
    
    logActivity('page_deleted', { pageId });
    triggerRebuild('page deleted: ' + pageId);
    res.json({ message: 'Page deleted' });
  } catch (err) {
    console.error('Delete page error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}
router.delete('/pages/:parentId/:subId', authMiddleware, handleDeletePage);
router.delete('/pages/:pageId', authMiddleware, handleDeletePage);


router.post('/pages', authMiddleware, (req, res) => {
  const { pageId, title, type, template, placement } = req.body;
  
  if (!pageId || !title) {
    return res.status(400).json({ error: 'Page ID and title are required' });
  }
  
  // Allow slashes for sub-service pages (e.g. "roofing/storm-damage")
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(pageId)) {
    return res.status(400).json({ error: 'Page ID can only contain lowercase letters, numbers, hyphens, and one optional slash' });
  }
  
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    
    if (pages[pageId]) {
      return res.status(400).json({ error: 'A page with this ID already exists' });
    }
    
    let templateContent = {};
    if (template) {
      try {
        const templates = JSON.parse(fs.readFileSync(templatesFile, 'utf8'));
        const tpl = templates.find(t => t.id === template);
        if (tpl) {
          templateContent = {
            content: tpl.content,
            heroDescription: tpl.heroDescription,
            tagline: tpl.tagline
          };
        }
      } catch (e) { /* templates file may not exist */ }
    }
    
    const pl = placement || { type: 'standalone', parent: null, position: 'end' };
    
    pages[pageId] = {
      id: pageId,
      title,
      type: type || 'custom',
      isCustomPage: true,
      content: templateContent.content || '',
      heroDescription: templateContent.heroDescription || '',
      tagline: templateContent.tagline || '',
      status: 'published',
      sortOrder: Object.keys(pages).length,
      showInNav: true,
      placement: pl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
    
    const slug = pageId.includes('/') ? pageId.split('/').pop() : pageId;
    
    // Auto-detect parent from pageId if it contains a slash (e.g. "roofing/stone-shingles")
    const detectedParent = pageId.includes('/') ? pageId.split('/')[0] : (pl.parent || null);
    const isSubService = detectedParent && (pl.type === 'sub-service' || pageId.includes('/'));
    
    // Update placement to reflect detected parent
    if (isSubService && !pl.parent) {
      pl.type = 'sub-service';
      pl.parent = detectedParent;
      pages[pageId].placement = pl;
      fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
    }
    
    // ── Sub-service: also add to services.json so the static build generates the page ──
    if (isSubService && detectedParent) {
      try {
        const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
        const parent = services.find(s => s.id === detectedParent);
        if (parent) {
          if (!parent.subServices) parent.subServices = [];
          // Remove existing entry with same slug to avoid duplicates
          parent.subServices = parent.subServices.filter(s => s.id !== slug);
          
          const newSub = {
            id: slug,
            title,
            tagline: templateContent.tagline || '',
            heroDescription: templateContent.heroDescription || '',
            description: templateContent.content || '',
            offerings: [],
            materials: [],
            features: [],
            faqs: [],
            isCustomPage: true,
            createdAt: new Date().toISOString()
          };
          
          // Position-aware insertion
          if (pl.position && pl.position.startsWith('after:')) {
            const afterId = pl.position.replace('after:', '');
            const afterIdx = parent.subServices.findIndex(s => s.id === afterId);
            if (afterIdx !== -1) {
              parent.subServices.splice(afterIdx + 1, 0, newSub);
            } else {
              parent.subServices.push(newSub);
            }
          } else if (pl.position === 'start') {
            parent.subServices.unshift(newSub);
          } else {
            parent.subServices.push(newSub);
          }
          
          fs.writeFileSync(servicesDataFile, JSON.stringify(services, null, 2));
        }
      } catch (svcErr) {
        console.error('Services data sync failed:', svcErr);
      }
    }
    
    // ── Insert into nav config so page appears in dropdown menus ──
    try {
      const navConfig = JSON.parse(fs.readFileSync(navConfigFile, 'utf8'));
      
      if (isSubService && detectedParent) {
        const parentItem = navConfig.items.find(item => item.id === detectedParent);
        if (parentItem) {
          // Remove existing entry to avoid duplicates
          parentItem.children = (parentItem.children || []).filter(c => c.id !== slug);
          
          const navEntry = {
            id: slug,
            label: title,
            href: `/services/${detectedParent}/${slug}`,
            visible: true,
            builtIn: true
          };
          
          if (pl.position && pl.position.startsWith('after:')) {
            const afterId = pl.position.replace('after:', '');
            const afterIndex = parentItem.children.findIndex(c => c.id === afterId);
            if (afterIndex !== -1) {
              parentItem.children.splice(afterIndex + 1, 0, navEntry);
            } else {
              parentItem.children.push(navEntry);
            }
          } else if (pl.position === 'start') {
            parentItem.children.splice(1, 0, navEntry);
          } else {
            parentItem.children.push(navEntry);
          }
        }
      }
      
      fs.writeFileSync(navConfigFile, JSON.stringify(navConfig, null, 2));
    } catch (navErr) {
      console.error('Nav config update failed:', navErr);
    }
    
    logActivity('page_created', { pageId, title, placement: pl.type });
    triggerRebuild('page created: ' + pageId);
    
    res.json({ message: 'Page created successfully', page: pages[pageId] });
  } catch (err) {
    console.error('Page creation error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

function handleDuplicatePage(req, res) {
  const pageId = getPageId(req);
  const { newPageId } = req.body;
  
  if (!newPageId) return res.status(400).json({ error: 'New page ID required' });
  
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    if (!pages[pageId]) return res.status(404).json({ error: 'Source page not found' });
    if (pages[newPageId]) return res.status(400).json({ error: 'Target page already exists' });
    
    pages[newPageId] = {
      ...JSON.parse(JSON.stringify(pages[pageId])),
      title: (pages[pageId].title || 'Page') + ' (Copy)',
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
    
    logActivity('page_duplicated', { sourceId: pageId, newId: newPageId });
    res.json({ message: 'Page duplicated successfully', page: pages[newPageId] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}
router.post('/pages/:parentId/:subId/duplicate', authMiddleware, handleDuplicatePage);
router.post('/pages/:pageId/duplicate', authMiddleware, handleDuplicatePage);

router.put('/pages/reorder', authMiddleware, (req, res) => {
  const { order } = req.body;
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    // Support both formats: array of IDs (legacy) or array of {id, sortOrder}
    if (Array.isArray(order)) {
      order.forEach((item, index) => {
        if (typeof item === 'string') {
          // Legacy: array of ID strings
          if (pages[item]) pages[item].sortOrder = index;
        } else if (item && item.id) {
          // New: array of {id, sortOrder} objects
          if (pages[item.id]) pages[item.id].sortOrder = item.sortOrder ?? index;
        }
      });
    }
    fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
    logActivity('pages_reordered');
    res.json({ message: 'Order updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Move a page to a different parent service (or to standalone)
function handleMovePage(req, res) {
  const pageId = getPageId(req);
  const { newParent } = req.body;
  
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const page = pages[pageId];
    
    if (!page) return res.status(404).json({ error: 'Page not found' });
    
    const oldParentId = pageId.includes('/') ? pageId.split('/')[0] : (page.placement && page.placement.parent);
    const slug = pageId.split('/').pop();
    
    // Update placement
    page.placement = {
      type: newParent ? 'sub-service' : 'standalone',
      parent: newParent || null,
    };
    
    // ── Sync with services.json ──
    try {
      const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
      
      // Remove from old parent in services.json
      if (oldParentId) {
        const oldParent = services.find(s => s.id === oldParentId);
        if (oldParent && oldParent.subServices) {
          oldParent.subServices = oldParent.subServices.filter(s => s.id !== slug);
        }
      }
      
      // Add to new parent in services.json
      if (newParent) {
        const newParentSvc = services.find(s => s.id === newParent);
        if (newParentSvc) {
          if (!newParentSvc.subServices) newParentSvc.subServices = [];
          newParentSvc.subServices.push({
            id: slug,
            title: page.title,
            tagline: page.tagline || '',
            heroDescription: page.heroDescription || '',
            description: page.content || page.description || '',
            offerings: page.offerings || [],
            materials: page.materials || [],
            features: page.features || [],
            faqs: page.faqs || [],
            isCustomPage: true,
            updatedAt: new Date().toISOString()
          });
        }
      }
      
      fs.writeFileSync(servicesDataFile, JSON.stringify(services, null, 2));
    } catch (svcErr) {
      console.error('Services data move sync failed:', svcErr);
    }
    
    // If moving to a service and ID doesn't already have parent prefix, rename
    if (newParent && !pageId.startsWith(newParent + '/')) {
      const newId = `${newParent}/${slug}`;
      pages[newId] = { ...page, id: newId, updatedAt: new Date().toISOString() };
      delete pages[pageId];
      fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
      logActivity('page_moved', { from: pageId, to: newId });
      return res.json({ success: true, newId });
    }
    
    // If moving to standalone and ID has a parent prefix, strip it
    if (!newParent && pageId.includes('/')) {
      pages[slug] = { ...page, id: slug, updatedAt: new Date().toISOString() };
      delete pages[pageId];
      fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
      logActivity('page_moved', { from: pageId, to: slug });
      return res.json({ success: true, newId: slug });
    }
    
    // Same parent structure, just update placement metadata
    page.updatedAt = new Date().toISOString();
    fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
    logActivity('page_moved', { pageId, newParent });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}
router.put('/pages/:parentId/:subId/move', authMiddleware, handleMovePage);
router.put('/pages/:pageId/move', authMiddleware, handleMovePage);

router.get('/custom-pages', authMiddleware, (req, res) => {
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const customPages = Object.entries(pages)
      .filter(([id, page]) => page.isCustomPage)
      .map(([id, page]) => ({ id, ...page, placement: page.placement || { type: 'standalone', parent: null } }))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    
    // Also include admin-created sub-services from services.json 
    // that don't already have a pages.json entry
    try {
      const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
      const existingIds = new Set(customPages.map(p => p.id));
      
      services.forEach(svc => {
        if (svc.subServices) {
          svc.subServices.forEach(sub => {
            if (sub.isCustomPage) {
              const fullId = `${svc.id}/${sub.id}`;
              if (!existingIds.has(fullId)) {
                customPages.push({
                  id: fullId,
                  title: sub.title,
                  isCustomPage: true,
                  status: 'published',
                  placement: { type: 'sub-service', parent: svc.id },
                  createdAt: sub.createdAt,
                  updatedAt: sub.updatedAt
                });
              }
            }
          });
        }
      });
    } catch (e) { /* services.json lookup failed */ }
    
    res.json(customPages);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ NAVIGATION CONFIG ============

// Public: returns nav structure for the header (no auth needed)
router.get('/public/nav-config', (req, res) => {
  try {
    const navConfig = JSON.parse(fs.readFileSync(navConfigFile, 'utf8'));
    // Filter out hidden items for public consumption
    const publicNav = {
      items: (navConfig.items || [])
        .filter(item => item.visible !== false)
        .map(item => ({
          ...item,
          children: (item.children || []).filter(c => c.visible !== false)
        })),
      footerLinks: (navConfig.footerLinks || []).filter(link => link.visible !== false)
    };
    res.json(publicNav);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: get full nav config including hidden items
router.get('/nav-config', authMiddleware, (req, res) => {
  try {
    const navConfig = JSON.parse(fs.readFileSync(navConfigFile, 'utf8'));
    res.json(navConfig);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: update full nav config (reorder, restructure)
router.put('/nav-config', authMiddleware, (req, res) => {
  try {
    const navConfig = req.body;
    fs.writeFileSync(navConfigFile, JSON.stringify(navConfig, null, 2));
    logActivity('nav_config_updated');
    triggerRebuild('nav config updated');
    res.json({ message: 'Navigation updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: toggle a single nav item's visibility
router.put('/nav-config/toggle/:itemId', authMiddleware, (req, res) => {
  const { itemId } = req.params;
  const { parentId } = req.body;
  
  try {
    const navConfig = JSON.parse(fs.readFileSync(navConfigFile, 'utf8'));
    
    if (parentId) {
      // Toggle a child item
      const parent = navConfig.items.find(i => i.id === parentId);
      if (parent && parent.children) {
        const child = parent.children.find(c => c.id === itemId);
        if (child) child.visible = !child.visible;
      }
    } else {
      // Toggle a top-level item
      const item = navConfig.items.find(i => i.id === itemId);
      if (item) item.visible = !item.visible;
    }
    
    fs.writeFileSync(navConfigFile, JSON.stringify(navConfig, null, 2));
    logActivity('nav_item_toggled', { itemId, parentId });
    res.json({ message: 'Visibility toggled' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/pages-search', authMiddleware, (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const query = q.toLowerCase();
    
    const results = Object.entries(pages)
      .filter(([id, page]) => {
        const searchable = `${id} ${page.title || ''} ${page.content || ''} ${page.heroDescription || ''}`.toLowerCase();
        return searchable.includes(query);
      })
      .map(([id, page]) => ({ id, title: page.title, status: page.status }))
      .slice(0, 20);
    
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ TRASH ============

router.get('/trash', authMiddleware, (req, res) => {
  try {
    const trash = JSON.parse(fs.readFileSync(trashFile, 'utf8'));
    res.json(trash);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/trash/:id/restore', authMiddleware, (req, res) => {
  const { id } = req.params;
  
  try {
    let trash = JSON.parse(fs.readFileSync(trashFile, 'utf8'));
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    
    const item = trash.find(t => t.id === id);
    if (!item) return res.status(404).json({ error: 'Item not found in trash' });
    
    let restoreId = item.pageId;
    if (pages[restoreId]) {
      restoreId = `${item.pageId}-restored-${Date.now()}`;
    }
    
    pages[restoreId] = {
      ...item.page,
      updatedAt: new Date().toISOString()
    };
    
    trash = trash.filter(t => t.id !== id);
    
    fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
    fs.writeFileSync(trashFile, JSON.stringify(trash, null, 2));
    logActivity('page_restored', { pageId: restoreId });
    
    res.json({ message: 'Page restored', pageId: restoreId });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/trash/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  
  try {
    let trash = JSON.parse(fs.readFileSync(trashFile, 'utf8'));
    trash = trash.filter(t => t.id !== id);
    fs.writeFileSync(trashFile, JSON.stringify(trash, null, 2));
    logActivity('trash_emptied_item', { id });
    res.json({ message: 'Permanently deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/trash', authMiddleware, (req, res) => {
  try {
    fs.writeFileSync(trashFile, JSON.stringify([], null, 2));
    logActivity('trash_emptied_all');
    res.json({ message: 'Trash emptied' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ REDIRECTS ============

router.get('/redirects', authMiddleware, (req, res) => {
  try {
    const redirects = JSON.parse(fs.readFileSync(redirectsFile, 'utf8'));
    res.json(redirects);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/redirects', authMiddleware, (req, res) => {
  const { from, to, type } = req.body;
  
  if (!from || !to) {
    return res.status(400).json({ error: 'From and to paths required' });
  }
  
  try {
    const redirects = JSON.parse(fs.readFileSync(redirectsFile, 'utf8'));
    
    if (redirects.find(r => r.from === from)) {
      return res.status(400).json({ error: 'Redirect from this path already exists' });
    }
    
    redirects.push({
      id: uuidv4(),
      from,
      to,
      type: type || '301',
      createdAt: new Date().toISOString()
    });
    
    fs.writeFileSync(redirectsFile, JSON.stringify(redirects, null, 2));
    logActivity('redirect_created', { from, to });
    res.json({ message: 'Redirect created' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/redirects/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  
  try {
    let redirects = JSON.parse(fs.readFileSync(redirectsFile, 'utf8'));
    redirects = redirects.filter(r => r.id !== id);
    fs.writeFileSync(redirectsFile, JSON.stringify(redirects, null, 2));
    logActivity('redirect_deleted', { id });
    res.json({ message: 'Redirect deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ REVISION ROUTES ============

router.get('/pages/:pageId/revisions', authMiddleware, (req, res) => {
  try {
    const revisions = JSON.parse(fs.readFileSync(revisionsFile, 'utf8'));
    res.json(revisions[req.params.pageId] || []);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/pages/:pageId/revisions/:revisionId/restore', authMiddleware, (req, res) => {
  const { pageId, revisionId } = req.params;
  
  try {
    const revisions = JSON.parse(fs.readFileSync(revisionsFile, 'utf8'));
    const pageRevisions = revisions[pageId] || [];
    const revision = pageRevisions.find(r => r.id === revisionId);
    
    if (!revision) return res.status(404).json({ error: 'Revision not found' });
    
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    
    if (pages[pageId]) {
      saveRevision(pageId, pages[pageId]);
    }
    
    pages[pageId] = {
      ...revision.content,
      updatedAt: new Date().toISOString(),
      restoredFrom: revisionId
    };
    fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
    
    logActivity('revision_restored', { pageId, revisionId });
    res.json({ message: 'Revision restored successfully', page: pages[pageId] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ ACTIVITY LOG ============

router.get('/activity', authMiddleware, (req, res) => {
  try {
    const activities = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ EXPORT / IMPORT ============

router.get('/export', authMiddleware, (req, res) => {
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const redirects = JSON.parse(fs.readFileSync(redirectsFile, 'utf8'));
    const testimonials = JSON.parse(fs.readFileSync(testimonialsFile, 'utf8'));
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    const homepage = JSON.parse(fs.readFileSync(homepageFile, 'utf8'));
    
    const { adminPassword, twoFactorSecret, ...publicSettings } = settings;
    
    res.json({
      exportedAt: new Date().toISOString(),
      settings: publicSettings,
      pages,
      redirects,
      testimonials,
      services,
      homepage
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/import', authMiddleware, (req, res) => {
  const { pages, testimonials, services, homepage, merge } = req.body;
  
  try {
    if (pages) {
      let currentPages = merge ? JSON.parse(fs.readFileSync(pagesFile, 'utf8')) : {};
      fs.writeFileSync(pagesFile, JSON.stringify({ ...currentPages, ...pages }, null, 2));
    }
    
    if (testimonials) {
      fs.writeFileSync(testimonialsFile, JSON.stringify(testimonials, null, 2));
    }
    
    if (services) {
      fs.writeFileSync(servicesDataFile, JSON.stringify(services, null, 2));
    }
    
    if (homepage) {
      fs.writeFileSync(homepageFile, JSON.stringify(homepage, null, 2));
    }
    
    logActivity('data_imported', { merge });
    res.json({ message: 'Import successful' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ MEDIA / IMAGE ROUTES ============

// Image optimization helper
const optimizeImage = async (inputPath, outputPath, options = {}) => {
  const { maxWidth = 1920, maxHeight = 1080, quality = 80 } = options;
  
  try {
    const metadata = await sharp(inputPath).metadata();
    
    // Skip SVG and ICO files
    if (metadata.format === 'svg' || inputPath.endsWith('.ico')) {
      if (inputPath !== outputPath) {
        fs.copyFileSync(inputPath, outputPath);
      }
      return { optimized: false, originalSize: fs.statSync(inputPath).size };
    }
    
    const originalSize = fs.statSync(inputPath).size;
    
    let sharpInstance = sharp(inputPath);
    
    // Resize if larger than max dimensions
    if (metadata.width > maxWidth || metadata.height > maxHeight) {
      sharpInstance = sharpInstance.resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }
    
    // Convert to WebP for better compression (keep original extension though)
    // Or optimize based on format
    if (metadata.format === 'jpeg' || metadata.format === 'jpg') {
      sharpInstance = sharpInstance.jpeg({ quality, mozjpeg: true });
    } else if (metadata.format === 'png') {
      sharpInstance = sharpInstance.png({ quality, compressionLevel: 9 });
    } else if (metadata.format === 'webp') {
      sharpInstance = sharpInstance.webp({ quality });
    }
    
    await sharpInstance.toFile(outputPath + '.tmp');
    
    // Replace original with optimized
    fs.renameSync(outputPath + '.tmp', outputPath);
    
    const newSize = fs.statSync(outputPath).size;
    const savings = Math.round((1 - newSize / originalSize) * 100);
    
    return { 
      optimized: true, 
      originalSize, 
      newSize, 
      savings: `${savings}%`,
      dimensions: { width: metadata.width, height: metadata.height }
    };
  } catch (err) {
    console.error('Image optimization error:', err);
    return { optimized: false, error: err.message };
  }
};

// Generate thumbnail
const generateThumbnail = async (inputPath, outputPath, size = 300) => {
  try {
    await sharp(inputPath)
      .resize(size, size, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toFile(outputPath);
    return true;
  } catch (err) {
    console.error('Thumbnail generation error:', err);
    return false;
  }
};

router.post('/upload', authMiddleware, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  
  const folder = req.body.folder || 'Uncategorized';
  const altText = req.body.altText || '';
  const optimize = req.body.optimize !== 'false'; // Default to true
  
  try {
    const filePath = path.join(uploadsDir, req.file.filename);
    let optimizationResult = { optimized: false };
    
    if (optimize) {
      optimizationResult = await optimizeImage(filePath, filePath);
    }
    
    // Generate thumbnail for gallery use
    const thumbName = `thumb_${req.file.filename}`;
    const thumbPath = path.join(uploadsDir, thumbName);
    await generateThumbnail(filePath, thumbPath);
    
    const imageUrl = `/uploads/${req.file.filename}`;
    const thumbUrl = `/uploads/${thumbName}`;
    
    logActivity('image_uploaded', { 
      filename: req.file.filename, 
      folder,
      optimized: optimizationResult.optimized,
      savings: optimizationResult.savings
    });
    
    res.json({ 
      message: 'Image uploaded', 
      url: imageUrl, 
      thumbnail: thumbUrl,
      filename: req.file.filename, 
      folder, 
      altText,
      optimization: optimizationResult
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload processing failed' });
  }
});

router.post('/upload-multiple', authMiddleware, upload.array('images', 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No images uploaded' });
  }
  
  const folder = req.body.folder || 'Uncategorized';
  const optimize = req.body.optimize !== 'false';
  
  try {
    const images = await Promise.all(req.files.map(async (file) => {
      const filePath = path.join(uploadsDir, file.filename);
      let optimizationResult = { optimized: false };
      
      if (optimize) {
        optimizationResult = await optimizeImage(filePath, filePath);
      }
      
      // Generate thumbnail
      const thumbName = `thumb_${file.filename}`;
      const thumbPath = path.join(uploadsDir, thumbName);
      await generateThumbnail(filePath, thumbPath);
      
      return {
        url: `/uploads/${file.filename}`,
        thumbnail: `/uploads/${thumbName}`,
        filename: file.filename,
        folder,
        optimization: optimizationResult
      };
    }));
    
    logActivity('images_uploaded', { count: images.length, folder });
    res.json({ message: 'Images uploaded', images });
  } catch (err) {
    console.error('Multi-upload error:', err);
    res.status(500).json({ error: 'Upload processing failed' });
  }
});

router.get('/images', authMiddleware, (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir);
    const metaFile = path.join(dataDir, 'image-meta.json');
    let meta = {};
    
    if (fs.existsSync(metaFile)) {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    }
    
    const images = files
      .filter(f => /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i.test(f) && !f.startsWith('thumb_'))
      .map(filename => ({
        filename,
        url: `/uploads/${filename}`,
        uploadedAt: fs.statSync(path.join(uploadsDir, filename)).mtime,
        folder: meta[filename]?.folder || 'Uncategorized',
        altText: meta[filename]?.altText || ''
      }))
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/images/:filename', authMiddleware, (req, res) => {
  const { filename } = req.params;
  const { folder, altText } = req.body;
  
  try {
    const metaFile = path.join(dataDir, 'image-meta.json');
    let meta = {};
    
    if (fs.existsSync(metaFile)) {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    }
    
    meta[filename] = { folder, altText };
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
    
    res.json({ message: 'Image updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/images/:filename', authMiddleware, (req, res) => {
  const { filename } = req.params;
  if (filename.includes('..') || filename.includes('/')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  
  const filepath = path.join(uploadsDir, filename);
  try {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      logActivity('image_deleted', { filename });
      res.json({ message: 'Image deleted' });
    } else {
      res.status(404).json({ error: 'Image not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Bulk image actions
router.post('/bulk/images', authMiddleware, (req, res) => {
  const { action, filenames, folder } = req.body;
  
  if (!action || !filenames || !Array.isArray(filenames)) {
    return res.status(400).json({ error: 'Action and filenames array required' });
  }
  
  try {
    if (action === 'delete') {
      let deleted = 0;
      let failed = 0;
      
      for (const filename of filenames) {
        if (filename.includes('..') || filename.includes('/')) {
          failed++;
          continue;
        }
        
        const filepath = path.join(uploadsDir, filename);
        const thumbPath = path.join(uploadsDir, `thumb_${filename}`);
        
        try {
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            deleted++;
          }
          // Also delete thumbnail if exists
          if (fs.existsSync(thumbPath)) {
            fs.unlinkSync(thumbPath);
          }
        } catch (err) {
          failed++;
        }
      }
      
      logActivity('bulk_images_deleted', { count: deleted });
      res.json({ message: `Deleted ${deleted} images`, deleted, failed });
      
    } else if (action === 'move' && folder) {
      // For future folder organization
      res.json({ message: 'Move action not yet implemented' });
      
    } else {
      res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Bulk action error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/media-folders', authMiddleware, (req, res) => {
  try {
    const folders = JSON.parse(fs.readFileSync(mediaFoldersFile, 'utf8'));
    res.json(folders);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/media-folders', authMiddleware, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Folder name required' });
  
  try {
    const folders = JSON.parse(fs.readFileSync(mediaFoldersFile, 'utf8'));
    if (folders.includes(name)) {
      return res.status(400).json({ error: 'Folder already exists' });
    }
    folders.push(name);
    fs.writeFileSync(mediaFoldersFile, JSON.stringify(folders, null, 2));
    res.json({ message: 'Folder created', folders });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/media-folders/:name', authMiddleware, (req, res) => {
  const { name } = req.params;
  if (name === 'Uncategorized') {
    return res.status(400).json({ error: 'Cannot delete default folder' });
  }
  
  try {
    let folders = JSON.parse(fs.readFileSync(mediaFoldersFile, 'utf8'));
    folders = folders.filter(f => f !== name);
    fs.writeFileSync(mediaFoldersFile, JSON.stringify(folders, null, 2));
    res.json({ message: 'Folder deleted', folders });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ GALLERY / PROJECTS ROUTES ============

// Get all projects (public)
router.get('/gallery', (req, res) => {
  try {
    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get gallery categories
router.get('/gallery/categories', (req, res) => {
  try {
    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const categories = [...new Set(projects.map(p => p.category))].filter(Boolean);
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single project (public)
router.get('/gallery/:id', (req, res) => {
  try {
    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const project = projects.find(p => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create project
router.post('/gallery', authMiddleware, (req, res) => {
  try {
    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const newProject = {
      id: uuidv4(),
      title: req.body.title || 'Untitled Project',
      category: req.body.category || 'General',
      location: req.body.location || '',
      description: req.body.description || '',
      images: req.body.images || [],
      featured: req.body.featured !== false,
      completedAt: req.body.completedAt || new Date().toISOString().slice(0, 7),
      createdAt: new Date().toISOString()
    };
    
    projects.unshift(newProject);
    fs.writeFileSync(galleryFile, JSON.stringify(projects, null, 2));
    logActivity('project_created', { title: newProject.title });
    triggerRebuild('project created');
    res.json(newProject);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update project
router.put('/gallery/:id', authMiddleware, (req, res) => {
  try {
    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Project not found' });
    
    projects[index] = {
      ...projects[index],
      title: req.body.title ?? projects[index].title,
      category: req.body.category ?? projects[index].category,
      location: req.body.location ?? projects[index].location,
      description: req.body.description ?? projects[index].description,
      images: req.body.images ?? projects[index].images,
      featured: req.body.featured ?? projects[index].featured,
      completedAt: req.body.completedAt ?? projects[index].completedAt,
      updatedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(galleryFile, JSON.stringify(projects, null, 2));
    logActivity('project_updated', { id: req.params.id, title: projects[index].title });
    triggerRebuild('project updated');
    res.json(projects[index]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete project
router.delete('/gallery/:id', authMiddleware, (req, res) => {
  try {
    let projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const project = projects.find(p => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    projects = projects.filter(p => p.id !== req.params.id);
    fs.writeFileSync(galleryFile, JSON.stringify(projects, null, 2));
    logActivity('project_deleted', { title: project.title });
    triggerRebuild('project deleted');
    res.json({ message: 'Project deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Reorder projects
router.put('/gallery-reorder', authMiddleware, (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Order array required' });
    
    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const reordered = order.map(id => projects.find(p => p.id === id)).filter(Boolean);
    
    // Add any missing projects at the end
    projects.forEach(p => {
      if (!reordered.find(r => r.id === p.id)) {
        reordered.push(p);
      }
    });
    
    fs.writeFileSync(galleryFile, JSON.stringify(reordered, null, 2));
    res.json({ message: 'Order saved' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add images to project
router.post('/gallery/:id/images', authMiddleware, (req, res) => {
  try {
    const { images } = req.body;
    if (!Array.isArray(images)) return res.status(400).json({ error: 'Images array required' });
    
    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Project not found' });
    
    projects[index].images = [...(projects[index].images || []), ...images];
    projects[index].updatedAt = new Date().toISOString();
    
    fs.writeFileSync(galleryFile, JSON.stringify(projects, null, 2));
    res.json(projects[index]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove image from project
router.delete('/gallery/:id/images/:imageIndex', authMiddleware, (req, res) => {
  try {
    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Project not found' });
    
    const imageIndex = parseInt(req.params.imageIndex);
    if (isNaN(imageIndex) || imageIndex < 0 || imageIndex >= (projects[index].images?.length || 0)) {
      return res.status(400).json({ error: 'Invalid image index' });
    }
    
    projects[index].images.splice(imageIndex, 1);
    projects[index].updatedAt = new Date().toISOString();
    
    fs.writeFileSync(galleryFile, JSON.stringify(projects, null, 2));
    res.json(projects[index]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

const { createBackup, listBackups, backupsDir } = require('../services/autoBackup');

// ============ BACKUP ROUTES ============

router.get('/backups', authMiddleware, (req, res) => {
  try {
    res.json(listBackups());
  } catch (err) {
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

router.post('/backups', authMiddleware, (req, res) => {
  try {
    const result = createBackup();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

router.get('/backups/:filename', authMiddleware, (req, res) => {
  try {
    const filename = req.params.filename;
    if (!/^backup-[\d-T]+\.tar\.gz$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const filepath = path.join(backupsDir, filename);
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    res.download(filepath);
  } catch (err) {
    res.status(500).json({ error: 'Failed to download backup' });
  }
});

// ============ BLOG POSTS ============

const postsFile = path.join(dataDir, 'posts.json');
initFile(postsFile, []);

// Get all posts
router.get('/posts', authMiddleware, (req, res) => {
  try {
    const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single post
router.get('/posts/:id', authMiddleware, (req, res) => {
  try {
    const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
    const post = posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create post
router.post('/posts', authMiddleware, (req, res) => {
  try {
    const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
    const newPost = {
      id: req.body.slug || uuidv4(),
      title: req.body.title || 'Untitled Post',
      slug: req.body.slug || '',
      excerpt: req.body.excerpt || '',
      content: req.body.content || '',
      author: req.body.author || '{{COMPANY_NAME}}',
      publishedAt: req.body.publishedAt || new Date().toISOString(),
      category: req.body.category || 'tips',
      tags: req.body.tags || [],
      image: req.body.image || '',
      relatedServices: req.body.relatedServices || [],
      featured: req.body.featured || false,
      published: req.body.published || false,
      createdAt: new Date().toISOString()
    };

    posts.unshift(newPost);
    fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2));
    logActivity('post_created', { title: newPost.title });
    triggerRebuild('blog post created');
    res.json(newPost);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update post
router.put('/posts/:id', authMiddleware, (req, res) => {
  try {
    const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
    const index = posts.findIndex(p => p.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Post not found' });

    posts[index] = {
      ...posts[index],
      title: req.body.title ?? posts[index].title,
      slug: req.body.slug ?? posts[index].slug,
      excerpt: req.body.excerpt ?? posts[index].excerpt,
      content: req.body.content ?? posts[index].content,
      author: req.body.author ?? posts[index].author,
      publishedAt: req.body.publishedAt ?? posts[index].publishedAt,
      category: req.body.category ?? posts[index].category,
      tags: req.body.tags ?? posts[index].tags,
      image: req.body.image ?? posts[index].image,
      relatedServices: req.body.relatedServices ?? posts[index].relatedServices,
      featured: req.body.featured ?? posts[index].featured,
      published: req.body.published ?? posts[index].published,
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2));
    logActivity('post_updated', { id: req.params.id, title: posts[index].title });
    triggerRebuild('blog post updated');
    res.json(posts[index]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete post
router.delete('/posts/:id', authMiddleware, (req, res) => {
  try {
    let posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
    const post = posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    posts = posts.filter(p => p.id !== req.params.id);
    fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2));
    logActivity('post_deleted', { title: post.title });
    triggerRebuild('blog post deleted');
    res.json({ message: 'Post deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
