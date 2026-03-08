import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import sharp from 'sharp';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import appPaths from '../config/paths.ts';
import { createBackup, listBackups, backupsDir } from '../services/autoBackup.ts';
import { uploadFile, deleteFile, listFiles, getImageUrl, USE_R2 } from '../services/storage.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uuidv4 = () => crypto.randomUUID();

const app = new Hono();

const dataDir = appPaths.data;
const uploadsDir = appPaths.uploads;

// ── Static site rebuild helper ──
// Spawns build-static.js as a child process after page changes
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
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
const initFile = (file: string, defaultData: any) => {
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
const logActivity = (action: string, details: any = {}) => {
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
const saveRevision = (pageId: string, content: any) => {
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
const sendEmailNotification = async (lead: any) => {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const emailConfig = settings.emailNotifications;

    if (!emailConfig?.enabled) return;
    if (!emailConfig.recipient || !emailConfig.fromEmail) return;

    // Try SendGrid first
    if (emailConfig.sendgridApiKey) {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${emailConfig.sendgridApiKey}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(30_000),
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
  } catch (err: any) {
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

function ensureAnalyticsSchema(analytics: any) {
  if (!analytics.pageViews) analytics.pageViews = {};
  if (!analytics.dailyViews) analytics.dailyViews = {};
  if (!analytics.sources) analytics.sources = {};
  if (!analytics.dailySources) analytics.dailySources = {};
  if (!analytics.devices) analytics.devices = {};
  if (!analytics.utmCampaigns) analytics.utmCampaigns = {};
  if (!analytics.uniqueSessions) analytics.uniqueSessions = {};
  return analytics;
}

const trackPageView = (pageId: string, referrer = '', userAgent = '', utm: any = {}, sessionId = '') => {
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
      let sessions: any = {};
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

    Object.entries(pages).forEach(([id, page]: [string, any]) => {
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

// Allowed image types for upload validation
const allowedImageTypes = /jpeg|jpg|png|gif|webp|svg|ico/;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET environment variable is required in production');
}
const jwtSecret = JWT_SECRET || 'dev-secret-do-not-use-in-production';

const authMiddleware = async (c: Context, next: Next) => {
  const token = c.req.header('authorization')?.split(' ')[1];
  if (!token) return c.json({ error: 'No token provided' }, 401);

  try {
    const decoded = jwt.verify(token, jwtSecret);
    c.set('admin', decoded);
    await next();
  } catch (err) {
    return c.json({ error: 'Invalid token' }, 401);
  }
};

// ============ AUTH ROUTES ============

app.post('/login', async (c) => {
  const { password, totpCode } = await c.req.json();
  if (!password) return c.json({ error: 'Password required' }, 400);

  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (!bcrypt.compareSync(password, settings.adminPassword)) {
      return c.json({ error: 'Invalid password' }, 401);
    }

    if (settings.twoFactorEnabled && settings.twoFactorSecret) {
      if (!totpCode) {
        return c.json({ requires2FA: true });
      }
    }

    const token = jwt.sign({ admin: true }, jwtSecret, { expiresIn: '7d' });
    logActivity('login', { success: true });
    return c.json({ token, message: 'Login successful' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.get('/verify', authMiddleware, (c) => {
  return c.json({ valid: true });
});

app.post('/change-password', authMiddleware, async (c) => {
  const { currentPassword, newPassword } = await c.req.json();
  if (!currentPassword || !newPassword) return c.json({ error: 'Both passwords required' }, 400);
  if (newPassword.length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400);

  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (!bcrypt.compareSync(currentPassword, settings.adminPassword)) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }
    settings.adminPassword = bcrypt.hashSync(newPassword, 10);
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    logActivity('password_changed');
    return c.json({ message: 'Password changed successfully' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ 2FA ROUTES ============

app.post('/2fa/setup', authMiddleware, (c) => {
  try {
    const secret = crypto.randomBytes(20).toString('hex');
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    settings.twoFactorSecret = secret;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));

    const otpauthUrl = `otpauth://totp/{{COMPANY_NAME_SLUG}}Admin?secret=${secret}&issuer={{COMPANY_NAME_SLUG}}`;
    return c.json({ secret, otpauthUrl });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.post('/2fa/enable', authMiddleware, (c) => {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    settings.twoFactorEnabled = true;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    logActivity('2fa_enabled');
    return c.json({ message: '2FA enabled successfully' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.post('/2fa/disable', authMiddleware, async (c) => {
  const { password } = await c.req.json();
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (!bcrypt.compareSync(password, settings.adminPassword)) {
      return c.json({ error: 'Invalid password' }, 401);
    }
    settings.twoFactorEnabled = false;
    settings.twoFactorSecret = '';
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    logActivity('2fa_disabled');
    return c.json({ message: '2FA disabled' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ SITE SETTINGS ============

app.get('/site-settings', authMiddleware, (c) => {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const { adminPassword, twoFactorSecret, ...publicSettings } = settings;
    publicSettings.twoFactorEnabled = settings.twoFactorEnabled;
    return c.json(publicSettings);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.put('/site-settings', authMiddleware, async (c) => {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const { adminPassword, twoFactorSecret, twoFactorEnabled } = settings;
    const body = await c.req.json();

    const updatedSettings = {
      ...body,
      adminPassword,
      twoFactorSecret,
      twoFactorEnabled
    };

    fs.writeFileSync(settingsFile, JSON.stringify(updatedSettings, null, 2));
    logActivity('settings_updated');
    triggerRebuild('settings updated');
    return c.json({ message: 'Settings saved' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.get('/public-settings', (c) => {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    return c.json({
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
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ TESTIMONIALS ============

app.get('/testimonials', (c) => {
  try {
    const testimonials = JSON.parse(fs.readFileSync(testimonialsFile, 'utf8'));
    return c.json(testimonials);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.post('/testimonials', authMiddleware, async (c) => {
  const { text, author, location, rating, featured, image } = await c.req.json();
  if (!text || !author) return c.json({ error: 'Text and author required' }, 400);

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
    return c.json({ message: 'Testimonial added', testimonial: newTestimonial });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Reorder testimonials (must be before /:id routes)
app.put('/testimonials/reorder', authMiddleware, async (c) => {
  const { order } = await c.req.json();
  try {
    const testimonials = JSON.parse(fs.readFileSync(testimonialsFile, 'utf8'));
    const reordered = order.map((id: string) => testimonials.find((t: any) => t.id === id)).filter(Boolean);
    fs.writeFileSync(testimonialsFile, JSON.stringify(reordered, null, 2));
    return c.json({ message: 'Order updated' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.put('/testimonials/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  try {
    const testimonials = JSON.parse(fs.readFileSync(testimonialsFile, 'utf8'));
    const index = testimonials.findIndex((t: any) => t.id === id);
    if (index === -1) return c.json({ error: 'Testimonial not found' }, 404);

    testimonials[index] = { ...testimonials[index], ...body, updatedAt: new Date().toISOString() };
    fs.writeFileSync(testimonialsFile, JSON.stringify(testimonials, null, 2));
    logActivity('testimonial_updated', { id });
    triggerRebuild('testimonial updated');
    return c.json({ message: 'Testimonial updated', testimonial: testimonials[index] });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.delete('/testimonials/:id', authMiddleware, (c) => {
  const id = c.req.param('id');
  try {
    let testimonials = JSON.parse(fs.readFileSync(testimonialsFile, 'utf8'));
    testimonials = testimonials.filter((t: any) => t.id !== id);
    fs.writeFileSync(testimonialsFile, JSON.stringify(testimonials, null, 2));
    logActivity('testimonial_deleted', { id });
    triggerRebuild('testimonial deleted');
    return c.json({ message: 'Testimonial deleted' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ SERVICES MANAGEMENT ============

app.get('/services-data', (c) => {
  try {
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    return c.json(services.sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0)));
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Reorder services (must be before /:id routes so Hono doesn't match 'reorder' as an id)
app.put('/services-data/reorder', authMiddleware, async (c) => {
  const { order } = await c.req.json();
  try {
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    order.forEach((id: string, index: number) => {
      const service = services.find((s: any) => s.id === id);
      if (service) service.sortOrder = index + 1;
    });
    services.sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
    fs.writeFileSync(servicesDataFile, JSON.stringify(services, null, 2));
    return c.json({ message: 'Order updated' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Public: Get sub-service by parentId/subId (used by SubServicePage)
app.get('/services-data/:serviceId/:subId', (c) => {
  try {
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    const parent = services.find((s: any) => s.id === c.req.param('serviceId'));
    if (!parent) return c.json({ error: 'Service not found' }, 404);
    const sub = (parent.subServices || []).find((s: any) => s.id === c.req.param('subId'));
    if (!sub) return c.json({ error: 'Sub-service not found' }, 404);
    return c.json({ ...sub, parentId: parent.id, parentTitle: parent.title });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Public: Get single service by ID (used by ServicePage)
app.get('/services-data/:id', (c) => {
  try {
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    const service = services.find((s: any) => s.id === c.req.param('id'));
    if (!service) return c.json({ error: 'Service not found' }, 404);
    return c.json(service);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.post('/services-data', authMiddleware, async (c) => {
  const body = await c.req.json();
  const { id, title } = body;
  if (!id || !title) return c.json({ error: 'ID and title required' }, 400);

  try {
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    if (services.find((s: any) => s.id === id)) {
      return c.json({ error: 'Service with this ID already exists' }, 400);
    }

    const newService = {
      id,
      title,
      description: body.description || '',
      image: body.image || '',
      icon: body.icon || '🔧',
      sortOrder: services.length + 1,
      links: body.links || [],
      featured: body.featured !== false,
      // Page content fields
      tagline: body.tagline || '',
      heroDescription: body.heroDescription || '',
      heroImage: body.heroImage || '',
      fullDescription: body.fullDescription || '',
      offerings: body.offerings || [],
      materials: body.materials || [],
      features: body.features || [],
      faqs: body.faqs || []
    };
    services.push(newService);
    fs.writeFileSync(servicesDataFile, JSON.stringify(services, null, 2));
    logActivity('service_created', { id, title });
    triggerRebuild('service created: ' + id);
    return c.json({ message: 'Service added', service: newService });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.put('/services-data/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  try {
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    const index = services.findIndex((s: any) => s.id === id);
    if (index === -1) return c.json({ error: 'Service not found' }, 404);

    services[index] = { ...services[index], ...body };
    fs.writeFileSync(servicesDataFile, JSON.stringify(services, null, 2));
    logActivity('service_updated', { id });
    triggerRebuild('service updated: ' + id);
    return c.json({ message: 'Service updated', service: services[index] });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.delete('/services-data/:id', authMiddleware, (c) => {
  const id = c.req.param('id');
  try {
    let services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    services = services.filter((s: any) => s.id !== id);
    fs.writeFileSync(servicesDataFile, JSON.stringify(services, null, 2));
    logActivity('service_deleted', { id });
    triggerRebuild('service deleted: ' + id);
    return c.json({ message: 'Service deleted' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ HOMEPAGE CONTENT ============

app.get('/homepage', (c) => {
  try {
    const homepage = JSON.parse(fs.readFileSync(homepageFile, 'utf8'));
    return c.json(homepage);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.put('/homepage', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    fs.writeFileSync(homepageFile, JSON.stringify(body, null, 2));
    logActivity('homepage_updated');
    triggerRebuild('homepage updated');
    return c.json({ message: 'Homepage saved' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ CONTENT TEMPLATES ============

app.get('/templates', authMiddleware, (c) => {
  try {
    const templates = JSON.parse(fs.readFileSync(templatesFile, 'utf8'));
    return c.json(templates);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.post('/templates', authMiddleware, async (c) => {
  const { id, name, description, content, heroDescription, tagline } = await c.req.json();
  if (!id || !name) return c.json({ error: 'ID and name required' }, 400);

  try {
    const templates = JSON.parse(fs.readFileSync(templatesFile, 'utf8'));
    if (templates.find((t: any) => t.id === id)) {
      return c.json({ error: 'Template with this ID already exists' }, 400);
    }

    const newTemplate = { id, name, description, content, heroDescription, tagline };
    templates.push(newTemplate);
    fs.writeFileSync(templatesFile, JSON.stringify(templates, null, 2));
    return c.json({ message: 'Template created', template: newTemplate });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ PREVIEW LINKS ============

app.post('/preview-token', authMiddleware, async (c) => {
  const { pageId } = await c.req.json();
  try {
    const tokens = JSON.parse(fs.readFileSync(previewTokensFile, 'utf8'));
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    tokens[token] = { pageId, expiresAt, createdAt: new Date().toISOString() };
    fs.writeFileSync(previewTokensFile, JSON.stringify(tokens, null, 2));

    return c.json({ token, expiresAt });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.get('/preview/:token', (c) => {
  const token = c.req.param('token');
  try {
    const tokens = JSON.parse(fs.readFileSync(previewTokensFile, 'utf8'));
    const tokenData = tokens[token];

    if (!tokenData || new Date(tokenData.expiresAt) < new Date()) {
      return c.json({ error: 'Invalid or expired preview link' }, 404);
    }

    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const page = pages[tokenData.pageId];

    if (!page) return c.json({ error: 'Page not found' }, 404);

    return c.json({ page, pageId: tokenData.pageId });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ ANALYTICS ============

app.get('/analytics', authMiddleware, (c) => {
  try {
    const raw = JSON.parse(fs.readFileSync(analyticsFile, 'utf8'));
    const analytics = ensureAnalyticsSchema(raw);
    const leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));

    // Period filter: ?period=7 | 30 | 90 (default 30)
    const period = Math.min(90, Math.max(1, parseInt(c.req.query('period') || '30') || 30));
    const cutoff = new Date(Date.now() - period * 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Total page views in period
    const periodViews = Object.entries(analytics.dailyViews)
      .filter(([d]) => d >= cutoff)
      .reduce((s, [, n]) => s + (n as number), 0);
    const totalViews = Object.values(analytics.pageViews).reduce((s: number, p: any) => s + p.total, 0);

    // Unique sessions in period
    const periodSessions = Object.entries(analytics.uniqueSessions || {})
      .filter(([d]) => d >= cutoff)
      .reduce((s, [, n]) => s + (n as number), 0);

    // Lead metrics
    const leadsInPeriod = leads.filter((l: any) => {
      const d = (l.createdAt || l.submittedAt || '').slice(0, 10);
      return d >= cutoff;
    });
    const conversionRate = periodViews > 0
      ? ((leadsInPeriod.length / periodViews) * 100).toFixed(2)
      : '0.00';

    // Daily views array for chart
    const dailyArray: any[] = [];
    let d = new Date(cutoff);
    const end = new Date(today);
    while (d <= end) {
      const key = d.toISOString().split('T')[0];
      dailyArray.push({
        date: key,
        views: analytics.dailyViews[key] || 0,
        sessions: (analytics.uniqueSessions || {})[key] || 0,
        leads: leads.filter((l: any) => (l.createdAt || l.submittedAt || '').startsWith(key)).length
      });
      d.setDate(d.getDate() + 1);
    }

    // Traffic sources in period
    const sourcesInPeriod: any = {};
    Object.entries(analytics.dailySources || {})
      .filter(([d]) => d >= cutoff)
      .forEach(([, dayData]: [string, any]) => {
        Object.entries(dayData).forEach(([src, n]) => {
          sourcesInPeriod[src] = (sourcesInPeriod[src] || 0) + (n as number);
        });
      });

    // Source labels for display
    const sourceLabels: any = {
      google: 'Google Search',
      search: 'Other Search',
      social: 'Social Media',
      paid: 'Paid Ads',
      referral: 'Referral',
      direct: 'Direct / Unknown'
    };
    const sourcesArray = Object.entries(sourcesInPeriod)
      .map(([src, n]) => ({ source: src, label: sourceLabels[src] || src, visits: n }))
      .sort((a: any, b: any) => b.visits - a.visits);

    // Devices (all-time, normalized to period if possible)
    const devicesArray = Object.entries(analytics.devices || {})
      .map(([device, n]) => ({ device, count: n }))
      .sort((a: any, b: any) => b.count - a.count);

    // Top pages in period
    const topPages = Object.entries(analytics.pageViews)
      .map(([page, data]: [string, any]) => {
        const periodCount = Object.entries(data.daily || {})
          .filter(([d]) => d >= cutoff)
          .reduce((s, [, n]) => s + (n as number), 0);
        return { page, views: periodCount, total: data.total };
      })
      .filter(p => p.views > 0)
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    // UTM campaigns
    const utmArray = Object.entries(analytics.utmCampaigns || {})
      .map(([campaign, visits]) => ({ campaign, visits }))
      .sort((a: any, b: any) => b.visits - a.visits)
      .slice(0, 10);

    // Lead source attribution
    const leadSources: any = {};
    leads.forEach((l: any) => {
      const src = l.source || classifyReferrer(l.referrer || '');
      leadSources[src] = (leadSources[src] || 0) + 1;
    });
    const leadSourcesArray = Object.entries(leadSources)
      .map(([source, count]) => ({ source, label: sourceLabels[source] || source, count }))
      .sort((a: any, b: any) => b.count - a.count);

    // Funnel: views -> contact page views -> leads submitted
    const contactPageViews = Object.entries(analytics.pageViews)
      .filter(([p]) => p === 'contact' || p === 'contact-us' || p === '/')
      .reduce((s, [, d]: [string, any]) => {
        return s + Object.entries(d.daily || {}).filter(([dt]) => dt >= cutoff).reduce((ss, [, n]) => ss + (n as number), 0);
      }, 0);

    const funnel = [
      { label: 'Total Visitors', value: periodViews },
      { label: 'Viewed Contact Page', value: contactPageViews },
      { label: 'Submitted Form', value: leadsInPeriod.length }
    ];

    return c.json({
      period,
      summary: {
        totalViews,
        periodViews,
        todayViews: analytics.dailyViews[today] || 0,
        yesterdayViews: analytics.dailyViews[yesterday] || 0,
        periodSessions,
        totalLeads: leads.length,
        periodLeads: leadsInPeriod.length,
        newLeads: leads.filter((l: any) => l.status === 'new').length,
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
    return c.json({ error: 'Server error' }, 500);
  }
});

app.post('/track', async (c) => {
  const { pageId, referrer, userAgent, utm, sessionId } = await c.req.json();
  if (pageId) {
    trackPageView(pageId, referrer || c.req.header('referer') || '', userAgent || c.req.header('user-agent') || '', utm || {}, sessionId || '');
  }
  return c.json({ ok: true });
});

// ============ SITEMAP & ROBOTS ============

app.get('/sitemap.xml', (c) => {
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

    services.forEach((service: any) => {
      xml += `  <url>\n    <loc>${baseUrl}/services/${service.slug}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
    });

    Object.entries(pages).forEach(([id, page]: [string, any]) => {
      if (page.status === 'published' && page.isCustomPage) {
        xml += `  <url>\n    <loc>${baseUrl}/${id}</loc>\n    <lastmod>${page.updatedAt || page.createdAt}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
      }
    });

    xml += '</urlset>';

    return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
  } catch (err) {
    return c.text('Error generating sitemap', 500);
  }
});

app.get('/robots.txt', (c) => {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    return new Response(settings.robotsTxt || 'User-agent: *\nAllow: /', {
      headers: { 'Content-Type': 'text/plain' }
    });
  } catch (err) {
    return new Response('User-agent: *\nAllow: /', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
});

// ============ BROKEN LINK CHECKER ============

app.post('/check-links', authMiddleware, async (c) => {
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const brokenLinks: any[] = [];

    const urlRegex = /href=["']([^"']+)["']/g;

    for (const [pageId, page] of Object.entries(pages) as [string, any][]) {
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

    return c.json({ brokenLinks, checkedAt: new Date().toISOString() });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ LEADS / FORM SUBMISSIONS ============

app.get('/leads', authMiddleware, (c) => {
  try {
    const leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
    return c.json(leads);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.post('/leads', async (c) => {
  const { name, email, phone, service, services, message, source, address } = await c.req.json();

  if (!name || (!email && !phone)) {
    return c.json({ error: 'Name and either email or phone are required' }, 400);
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

    sendEmailNotification(newLead).catch(e => console.error('[Email] notification failed:', e));

    // Forward lead to CRM if configured
    const CRM_API_URL = process.env.CRM_API_URL;
    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || process.env.JWT_SECRET;
    if (CRM_API_URL && WEBHOOK_SECRET) {
      try {
        const webhookRes = await fetch(`${CRM_API_URL}/api/webhooks/leads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
          body: JSON.stringify({ name, email, phone, service, message, source: source || 'website', address }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!webhookRes.ok) console.error('[Webhook] CRM forward failed:', webhookRes.status);
      } catch (e) {
        console.warn('[Leads] Failed to forward lead to CRM:', (e as any).message);
      }
    }

    return c.json({ message: 'Form submitted successfully', id: newLead.id });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.put('/leads/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const updates = await c.req.json();

  try {
    const leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
    const index = leads.findIndex((l: any) => l.id === id);

    if (index === -1) {
      return c.json({ error: 'Lead not found' }, 404);
    }

    leads[index] = { ...leads[index], ...updates, updatedAt: new Date().toISOString() };
    fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));
    logActivity('lead_updated', { id, status: updates.status });

    return c.json({ message: 'Lead updated', lead: leads[index] });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.delete('/leads/:id', authMiddleware, (c) => {
  const id = c.req.param('id');

  try {
    let leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
    leads = leads.filter((l: any) => l.id !== id);
    fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));
    logActivity('lead_deleted', { id });
    return c.json({ message: 'Lead deleted' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ PAGE ROUTES ============

// Helper: extract pageId from route params
function getPageIdFromParams(c: Context, hasSubId = false): string {
  if (hasSubId) {
    return `${c.req.param('parentId')}/${c.req.param('subId')}`;
  }
  return decodeURIComponent(c.req.param('pageId')!);
}

app.get('/pages', authMiddleware, (c) => {
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    return c.json(pages);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

function handleGetPage(c: Context, hasSubId = false) {
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const pageId = getPageIdFromParams(c, hasSubId);

    // Check pages.json first
    if (pages[pageId]) return c.json(pages[pageId]);

    // Fall back to services.json for sub-service pages
    if (pageId.includes('/')) {
      const [parentId, subId] = pageId.split('/');
      try {
        const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
        const parent = services.find((s: any) => s.id === parentId);
        if (parent && parent.subServices) {
          const sub = parent.subServices.find((s: any) => s.id === subId);
          if (sub) {
            return c.json({
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

    return c.json(null);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
}
app.get('/pages/:parentId/:subId', (c) => handleGetPage(c, true));
app.get('/pages/:pageId', (c) => handleGetPage(c, false));

async function handleUpdatePage(c: Context, hasSubId = false) {
  const pageId = getPageIdFromParams(c, hasSubId);
  const content = await c.req.json();

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
          const parent = services.find((s: any) => s.id === parentId);
          if (parent && parent.subServices) {
            const subIdx = parent.subServices.findIndex((s: any) => s.id === slug);
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
    return c.json({ message: 'Page saved successfully', page: pages[pageId] });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
}
app.put('/pages/:parentId/:subId', authMiddleware, (c) => handleUpdatePage(c, true));
app.put('/pages/:pageId', authMiddleware, (c) => handleUpdatePage(c, false));

function handleDeletePage(c: Context, hasSubId = false) {
  const pageId = getPageIdFromParams(c, hasSubId);

  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const slug = pageId.includes('/') ? pageId.split('/').pop()! : pageId;
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
        const parent = services.find((s: any) => s.id === parentId);
        if (parent && parent.subServices) {
          const before = parent.subServices.length;
          parent.subServices = parent.subServices.filter((s: any) => s.id !== slug);
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
    if (pages[pageId] === undefined && !deletedFromServices) {
      return c.json({ error: 'Page not found' }, 404);
    }

    // Remove from nav config
    try {
      const navConfig = JSON.parse(fs.readFileSync(navConfigFile, 'utf8'));
      navConfig.items.forEach((item: any) => {
        if (item.children) {
          item.children = item.children.filter((ch: any) => ch.id !== slug && ch.customPageId !== pageId);
        }
      });
      fs.writeFileSync(navConfigFile, JSON.stringify(navConfig, null, 2));
    } catch (navErr) { /* nav cleanup is non-critical */ }

    logActivity('page_deleted', { pageId });
    triggerRebuild('page deleted: ' + pageId);
    return c.json({ message: 'Page deleted' });
  } catch (err) {
    console.error('Delete page error:', err);
    return c.json({ error: 'Server error' }, 500);
  }
}
app.delete('/pages/:parentId/:subId', authMiddleware, (c) => handleDeletePage(c, true));
app.delete('/pages/:pageId', authMiddleware, (c) => handleDeletePage(c, false));

app.post('/pages', authMiddleware, async (c) => {
  const body = await c.req.json();
  const { pageId, title, type, template, placement } = body;

  if (!pageId || !title) {
    return c.json({ error: 'Page ID and title are required' }, 400);
  }

  // Allow slashes for sub-service pages (e.g. "roofing/storm-damage")
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(pageId)) {
    return c.json({ error: 'Page ID can only contain lowercase letters, numbers, hyphens, and one optional slash' }, 400);
  }

  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));

    if (pages[pageId]) {
      return c.json({ error: 'A page with this ID already exists' }, 400);
    }

    let templateContent: any = {};
    if (template) {
      try {
        const templates = JSON.parse(fs.readFileSync(templatesFile, 'utf8'));
        const tpl = templates.find((t: any) => t.id === template);
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

    const slug = pageId.includes('/') ? pageId.split('/').pop()! : pageId;

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
        const parent = services.find((s: any) => s.id === detectedParent);
        if (parent) {
          if (!parent.subServices) parent.subServices = [];
          // Remove existing entry with same slug to avoid duplicates
          parent.subServices = parent.subServices.filter((s: any) => s.id !== slug);

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
            const afterIdx = parent.subServices.findIndex((s: any) => s.id === afterId);
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
        const parentItem = navConfig.items.find((item: any) => item.id === detectedParent);
        if (parentItem) {
          // Remove existing entry to avoid duplicates
          parentItem.children = (parentItem.children || []).filter((ch: any) => ch.id !== slug);

          const navEntry = {
            id: slug,
            label: title,
            href: `/services/${detectedParent}/${slug}`,
            visible: true,
            builtIn: true
          };

          if (pl.position && pl.position.startsWith('after:')) {
            const afterId = pl.position.replace('after:', '');
            const afterIndex = parentItem.children.findIndex((ch: any) => ch.id === afterId);
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

    return c.json({ message: 'Page created successfully', page: pages[pageId] });
  } catch (err) {
    console.error('Page creation error:', err);
    return c.json({ error: 'Server error' }, 500);
  }
});

async function handleDuplicatePage(c: Context, hasSubId = false) {
  const pageId = getPageIdFromParams(c, hasSubId);
  const { newPageId } = await c.req.json();

  if (!newPageId) return c.json({ error: 'New page ID required' }, 400);

  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    if (!pages[pageId]) return c.json({ error: 'Source page not found' }, 404);
    if (pages[newPageId]) return c.json({ error: 'Target page already exists' }, 400);

    pages[newPageId] = {
      ...JSON.parse(JSON.stringify(pages[pageId])),
      title: (pages[pageId].title || 'Page') + ' (Copy)',
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));

    logActivity('page_duplicated', { sourceId: pageId, newId: newPageId });
    return c.json({ message: 'Page duplicated successfully', page: pages[newPageId] });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
}
app.post('/pages/:parentId/:subId/duplicate', authMiddleware, (c) => handleDuplicatePage(c, true));
app.post('/pages/:pageId/duplicate', authMiddleware, (c) => handleDuplicatePage(c, false));

app.put('/pages/reorder', authMiddleware, async (c) => {
  const { order } = await c.req.json();
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    // Support both formats: array of IDs (legacy) or array of {id, sortOrder}
    if (Array.isArray(order)) {
      order.forEach((item: any, index: number) => {
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
    return c.json({ message: 'Order updated' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Move a page to a different parent service (or to standalone)
async function handleMovePage(c: Context, hasSubId = false) {
  const pageId = getPageIdFromParams(c, hasSubId);
  const { newParent } = await c.req.json();

  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const page = pages[pageId];

    if (!page) return c.json({ error: 'Page not found' }, 404);

    const oldParentId = pageId.includes('/') ? pageId.split('/')[0] : (page.placement && page.placement.parent);
    const slug = pageId.split('/').pop()!;

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
        const oldParent = services.find((s: any) => s.id === oldParentId);
        if (oldParent && oldParent.subServices) {
          oldParent.subServices = oldParent.subServices.filter((s: any) => s.id !== slug);
        }
      }

      // Add to new parent in services.json
      if (newParent) {
        const newParentSvc = services.find((s: any) => s.id === newParent);
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
      return c.json({ success: true, newId });
    }

    // If moving to standalone and ID has a parent prefix, strip it
    if (!newParent && pageId.includes('/')) {
      pages[slug] = { ...page, id: slug, updatedAt: new Date().toISOString() };
      delete pages[pageId];
      fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
      logActivity('page_moved', { from: pageId, to: slug });
      return c.json({ success: true, newId: slug });
    }

    // Same parent structure, just update placement metadata
    page.updatedAt = new Date().toISOString();
    fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
    logActivity('page_moved', { pageId, newParent });
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
}
app.put('/pages/:parentId/:subId/move', authMiddleware, (c) => handleMovePage(c, true));
app.put('/pages/:pageId/move', authMiddleware, (c) => handleMovePage(c, false));

app.get('/custom-pages', authMiddleware, (c) => {
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const customPages: any[] = Object.entries(pages)
      .filter(([id, page]: [string, any]) => page.isCustomPage)
      .map(([id, page]: [string, any]) => ({ id, ...page, placement: page.placement || { type: 'standalone', parent: null } }))
      .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));

    // Also include admin-created sub-services from services.json
    // that don't already have a pages.json entry
    try {
      const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
      const existingIds = new Set(customPages.map(p => p.id));

      services.forEach((svc: any) => {
        if (svc.subServices) {
          svc.subServices.forEach((sub: any) => {
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

    return c.json(customPages);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ NAVIGATION CONFIG ============

// Public: returns nav structure for the header (no auth needed)
app.get('/public/nav-config', (c) => {
  try {
    const navConfig = JSON.parse(fs.readFileSync(navConfigFile, 'utf8'));
    // Filter out hidden items for public consumption
    const publicNav = {
      items: (navConfig.items || [])
        .filter((item: any) => item.visible !== false)
        .map((item: any) => ({
          ...item,
          children: (item.children || []).filter((ch: any) => ch.visible !== false)
        })),
      footerLinks: (navConfig.footerLinks || []).filter((link: any) => link.visible !== false)
    };
    return c.json(publicNav);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Admin: get full nav config including hidden items
app.get('/nav-config', authMiddleware, (c) => {
  try {
    const navConfig = JSON.parse(fs.readFileSync(navConfigFile, 'utf8'));
    return c.json(navConfig);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Admin: update full nav config (reorder, restructure)
app.put('/nav-config', authMiddleware, async (c) => {
  try {
    const navConfig = await c.req.json();
    fs.writeFileSync(navConfigFile, JSON.stringify(navConfig, null, 2));
    logActivity('nav_config_updated');
    triggerRebuild('nav config updated');
    return c.json({ message: 'Navigation updated' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Admin: toggle a single nav item's visibility
app.put('/nav-config/toggle/:itemId', authMiddleware, async (c) => {
  const itemId = c.req.param('itemId');
  const { parentId } = await c.req.json();

  try {
    const navConfig = JSON.parse(fs.readFileSync(navConfigFile, 'utf8'));

    if (parentId) {
      // Toggle a child item
      const parent = navConfig.items.find((i: any) => i.id === parentId);
      if (parent && parent.children) {
        const child = parent.children.find((ch: any) => ch.id === itemId);
        if (child) child.visible = !child.visible;
      }
    } else {
      // Toggle a top-level item
      const item = navConfig.items.find((i: any) => i.id === itemId);
      if (item) item.visible = !item.visible;
    }

    fs.writeFileSync(navConfigFile, JSON.stringify(navConfig, null, 2));
    logActivity('nav_item_toggled', { itemId, parentId });
    return c.json({ message: 'Visibility toggled' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.get('/pages-search', authMiddleware, (c) => {
  const q = c.req.query('q');
  if (!q) return c.json([]);

  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const query = q.toLowerCase();

    const results = Object.entries(pages)
      .filter(([id, page]: [string, any]) => {
        const searchable = `${id} ${page.title || ''} ${page.content || ''} ${page.heroDescription || ''}`.toLowerCase();
        return searchable.includes(query);
      })
      .map(([id, page]: [string, any]) => ({ id, title: page.title, status: page.status }))
      .slice(0, 20);

    return c.json(results);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ TRASH ============

app.get('/trash', authMiddleware, (c) => {
  try {
    const trash = JSON.parse(fs.readFileSync(trashFile, 'utf8'));
    return c.json(trash);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.post('/trash/:id/restore', authMiddleware, (c) => {
  const id = c.req.param('id');

  try {
    let trash = JSON.parse(fs.readFileSync(trashFile, 'utf8'));
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));

    const item = trash.find((t: any) => t.id === id);
    if (!item) return c.json({ error: 'Item not found in trash' }, 404);

    let restoreId = item.pageId;
    if (pages[restoreId]) {
      restoreId = `${item.pageId}-restored-${Date.now()}`;
    }

    pages[restoreId] = {
      ...item.page,
      updatedAt: new Date().toISOString()
    };

    trash = trash.filter((t: any) => t.id !== id);

    fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2));
    fs.writeFileSync(trashFile, JSON.stringify(trash, null, 2));
    logActivity('page_restored', { pageId: restoreId });

    return c.json({ message: 'Page restored', pageId: restoreId });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.delete('/trash/:id', authMiddleware, (c) => {
  const id = c.req.param('id');

  try {
    let trash = JSON.parse(fs.readFileSync(trashFile, 'utf8'));
    trash = trash.filter((t: any) => t.id !== id);
    fs.writeFileSync(trashFile, JSON.stringify(trash, null, 2));
    logActivity('trash_emptied_item', { id });
    return c.json({ message: 'Permanently deleted' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.delete('/trash', authMiddleware, (c) => {
  try {
    fs.writeFileSync(trashFile, JSON.stringify([], null, 2));
    logActivity('trash_emptied_all');
    return c.json({ message: 'Trash emptied' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ REDIRECTS ============

app.get('/redirects', authMiddleware, (c) => {
  try {
    const redirects = JSON.parse(fs.readFileSync(redirectsFile, 'utf8'));
    return c.json(redirects);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.post('/redirects', authMiddleware, async (c) => {
  const { from, to, type } = await c.req.json();

  if (!from || !to) {
    return c.json({ error: 'From and to paths required' }, 400);
  }

  try {
    const redirects = JSON.parse(fs.readFileSync(redirectsFile, 'utf8'));

    if (redirects.find((r: any) => r.from === from)) {
      return c.json({ error: 'Redirect from this path already exists' }, 400);
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
    return c.json({ message: 'Redirect created' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.delete('/redirects/:id', authMiddleware, (c) => {
  const id = c.req.param('id');

  try {
    let redirects = JSON.parse(fs.readFileSync(redirectsFile, 'utf8'));
    redirects = redirects.filter((r: any) => r.id !== id);
    fs.writeFileSync(redirectsFile, JSON.stringify(redirects, null, 2));
    logActivity('redirect_deleted', { id });
    return c.json({ message: 'Redirect deleted' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ REVISION ROUTES ============

app.get('/pages/:pageId/revisions', authMiddleware, (c) => {
  try {
    const revisions = JSON.parse(fs.readFileSync(revisionsFile, 'utf8'));
    return c.json(revisions[c.req.param('pageId')] || []);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.post('/pages/:pageId/revisions/:revisionId/restore', authMiddleware, (c) => {
  const pageId = c.req.param('pageId');
  const revisionId = c.req.param('revisionId');

  try {
    const revisions = JSON.parse(fs.readFileSync(revisionsFile, 'utf8'));
    const pageRevisions = revisions[pageId] || [];
    const revision = pageRevisions.find((r: any) => r.id === revisionId);

    if (!revision) return c.json({ error: 'Revision not found' }, 404);

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
    return c.json({ message: 'Revision restored successfully', page: pages[pageId] });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ ACTIVITY LOG ============

app.get('/activity', authMiddleware, (c) => {
  try {
    const activities = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
    return c.json(activities);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ EXPORT / IMPORT ============

app.get('/export', authMiddleware, (c) => {
  try {
    const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const redirects = JSON.parse(fs.readFileSync(redirectsFile, 'utf8'));
    const testimonials = JSON.parse(fs.readFileSync(testimonialsFile, 'utf8'));
    const services = JSON.parse(fs.readFileSync(servicesDataFile, 'utf8'));
    const homepage = JSON.parse(fs.readFileSync(homepageFile, 'utf8'));

    const { adminPassword, twoFactorSecret, ...publicSettings } = settings;

    return c.json({
      exportedAt: new Date().toISOString(),
      settings: publicSettings,
      pages,
      redirects,
      testimonials,
      services,
      homepage
    });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.post('/import', authMiddleware, async (c) => {
  const { pages, testimonials, services, homepage, merge } = await c.req.json();

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
    return c.json({ message: 'Import successful' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ MEDIA / IMAGE ROUTES ============

// Image optimization helper
const optimizeImage = async (inputPath: string, outputPath: string, options: any = {}) => {
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
    if ((metadata.width || 0) > maxWidth || (metadata.height || 0) > maxHeight) {
      sharpInstance = sharpInstance.resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    // Optimize based on format
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
  } catch (err: any) {
    console.error('Image optimization error:', err);
    return { optimized: false, error: err.message };
  }
};

// Generate thumbnail
const generateThumbnail = async (inputPath: string, outputPath: string, size = 300) => {
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

app.post('/upload', authMiddleware, async (c) => {
  const body = await c.req.parseBody();
  const file = body['image'] as File | undefined;

  if (!file || !(file instanceof File)) return c.json({ error: 'No image uploaded' }, 400);

  // Validate file type
  const ext = path.extname(file.name).toLowerCase();
  if (!allowedImageTypes.test(ext.replace('.', ''))) {
    return c.json({ error: 'Invalid file type' }, 400);
  }

  // Check file size (10MB)
  if (file.size > 10 * 1024 * 1024) {
    return c.json({ error: 'File too large' }, 400);
  }

  const folder = (body['folder'] as string) || 'Uncategorized';
  const altText = (body['altText'] as string) || '';
  const optimize = (body['optimize'] as string) !== 'false'; // Default to true

  try {
    const uniqueName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    const arrayBuffer = await file.arrayBuffer();
    let buffer = Buffer.from(arrayBuffer);

    let optimizationResult: any = { optimized: false };

    if (optimize && !ext.match(/\.(svg|ico)$/)) {
      // Optimize in-memory using sharp before uploading
      const tmpIn = path.join(uploadsDir, `_tmp_${uniqueName}`);
      const tmpOut = path.join(uploadsDir, `_opt_${uniqueName}`);
      fs.writeFileSync(tmpIn, buffer);
      optimizationResult = await optimizeImage(tmpIn, tmpOut);
      if (fs.existsSync(tmpOut)) {
        buffer = fs.readFileSync(tmpOut);
        try { fs.unlinkSync(tmpOut); } catch {}
      }
      try { fs.unlinkSync(tmpIn); } catch {}
    }

    // Generate thumbnail in-memory
    const thumbName = `thumb_${uniqueName}`;
    let thumbBuffer: Buffer | null = null;
    try {
      thumbBuffer = await sharp(buffer)
        .resize(300, 300, { fit: 'cover' })
        .jpeg({ quality: 70 })
        .toBuffer();
    } catch (err) {
      console.error('Thumbnail generation error:', err);
    }

    // Upload main image + thumbnail to storage (R2 or local)
    const contentType = file.type || 'image/jpeg';
    const imageUrl = await uploadFile(buffer, uniqueName, contentType);
    let thumbUrl = '';
    if (thumbBuffer) {
      thumbUrl = await uploadFile(thumbBuffer, thumbName, 'image/jpeg');
    }

    // Save metadata (folder, altText, uploadedAt) for R2 image listing
    try {
      const metaFile = path.join(dataDir, 'image-meta.json');
      let meta: any = {};
      if (fs.existsSync(metaFile)) meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      meta[uniqueName] = { folder, altText, uploadedAt: new Date().toISOString() };
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
    } catch {}

    logActivity('image_uploaded', {
      filename: uniqueName,
      folder,
      optimized: optimizationResult.optimized,
      savings: optimizationResult.savings
    });

    return c.json({
      message: 'Image uploaded',
      url: imageUrl,
      thumbnail: thumbUrl,
      filename: uniqueName,
      folder,
      altText,
      optimization: optimizationResult
    });
  } catch (err) {
    console.error('Upload error:', err);
    return c.json({ error: 'Upload processing failed' }, 500);
  }
});

app.post('/upload-multiple', authMiddleware, async (c) => {
  const body = await c.req.parseBody({ all: true });
  const files = body['images'];

  // Handle both single and multiple files
  const fileArray: File[] = [];
  if (Array.isArray(files)) {
    for (const f of files) {
      if (f instanceof File) fileArray.push(f);
    }
  } else if (files instanceof File) {
    fileArray.push(files);
  }

  if (fileArray.length === 0) {
    return c.json({ error: 'No images uploaded' }, 400);
  }

  const folder = (typeof body['folder'] === 'string' ? body['folder'] : undefined) || 'Uncategorized';
  const optimize = (typeof body['optimize'] === 'string' ? body['optimize'] : undefined) !== 'false';

  try {
    const images = await Promise.all(fileArray.map(async (file) => {
      const ext = path.extname(file.name).toLowerCase();
      const uniqueName = `${Date.now()}-${crypto.randomUUID()}${ext}`;

      const arrayBuffer = await file.arrayBuffer();
      let buffer = Buffer.from(arrayBuffer);

      let optimizationResult: any = { optimized: false };

      if (optimize && !ext.match(/\.(svg|ico)$/)) {
        const tmpIn = path.join(uploadsDir, `_tmp_${uniqueName}`);
        const tmpOut = path.join(uploadsDir, `_opt_${uniqueName}`);
        fs.writeFileSync(tmpIn, buffer);
        optimizationResult = await optimizeImage(tmpIn, tmpOut);
        if (fs.existsSync(tmpOut)) {
          buffer = fs.readFileSync(tmpOut);
          try { fs.unlinkSync(tmpOut); } catch {}
        }
        try { fs.unlinkSync(tmpIn); } catch {}
      }

      // Generate thumbnail in-memory
      const thumbName = `thumb_${uniqueName}`;
      let thumbBuffer: Buffer | null = null;
      try {
        thumbBuffer = await sharp(buffer)
          .resize(300, 300, { fit: 'cover' })
          .jpeg({ quality: 70 })
          .toBuffer();
      } catch {}

      const contentType = file.type || 'image/jpeg';
      const imageUrl = await uploadFile(buffer, uniqueName, contentType);
      let thumbUrl = '';
      if (thumbBuffer) {
        thumbUrl = await uploadFile(thumbBuffer, thumbName, 'image/jpeg');
      }

      return {
        url: imageUrl,
        thumbnail: thumbUrl,
        filename: uniqueName,
        folder,
        optimization: optimizationResult
      };
    }));

    logActivity('images_uploaded', { count: images.length, folder });
    return c.json({ message: 'Images uploaded', images });
  } catch (err) {
    console.error('Multi-upload error:', err);
    return c.json({ error: 'Upload processing failed' }, 500);
  }
});

app.get('/images', authMiddleware, async (c) => {
  try {
    const files = await listFiles();
    const metaFile = path.join(dataDir, 'image-meta.json');
    let meta: any = {};

    if (fs.existsSync(metaFile)) {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    }

    const images = files
      .filter(f => /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i.test(f) && !f.startsWith('thumb_'))
      .map(filename => {
        let uploadedAt: Date | string = meta[filename]?.uploadedAt || new Date();
        // For local storage, read mtime from disk
        if (!USE_R2) {
          try { uploadedAt = fs.statSync(path.join(uploadsDir, filename)).mtime; } catch {}
        }
        return {
          filename,
          url: getImageUrl(filename),
          uploadedAt,
          folder: meta[filename]?.folder || 'Uncategorized',
          altText: meta[filename]?.altText || ''
        };
      })
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    return c.json(images);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.put('/images/:filename', authMiddleware, async (c) => {
  const filename = c.req.param('filename');
  const { folder, altText } = await c.req.json();

  try {
    const metaFile = path.join(dataDir, 'image-meta.json');
    let meta: any = {};

    if (fs.existsSync(metaFile)) {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    }

    meta[filename] = { folder, altText };
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));

    return c.json({ message: 'Image updated' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.delete('/images/:filename', authMiddleware, async (c) => {
  const filename = c.req.param('filename');
  if (filename.includes('..') || filename.includes('/')) {
    return c.json({ error: 'Invalid filename' }, 400);
  }

  try {
    await deleteFile(filename);
    // Also delete thumbnail
    await deleteFile(`thumb_${filename}`).catch(() => {});
    logActivity('image_deleted', { filename });
    return c.json({ message: 'Image deleted' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Bulk image actions
app.post('/bulk/images', authMiddleware, async (c) => {
  const { action, filenames, folder } = await c.req.json();

  if (!action || !filenames || !Array.isArray(filenames)) {
    return c.json({ error: 'Action and filenames array required' }, 400);
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

        try {
          await deleteFile(filename);
          await deleteFile(`thumb_${filename}`).catch(() => {});
          deleted++;
        } catch (err) {
          failed++;
        }
      }

      logActivity('bulk_images_deleted', { count: deleted });
      return c.json({ message: `Deleted ${deleted} images`, deleted, failed });

    } else if (action === 'move' && folder) {
      // For future folder organization
      return c.json({ message: 'Move action not yet implemented' });

    } else {
      return c.json({ error: 'Unknown action' }, 400);
    }
  } catch (err) {
    console.error('Bulk action error:', err);
    return c.json({ error: 'Server error' }, 500);
  }
});

app.get('/media-folders', authMiddleware, (c) => {
  try {
    const folders = JSON.parse(fs.readFileSync(mediaFoldersFile, 'utf8'));
    return c.json(folders);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.post('/media-folders', authMiddleware, async (c) => {
  const { name } = await c.req.json();
  if (!name) return c.json({ error: 'Folder name required' }, 400);

  try {
    const folders = JSON.parse(fs.readFileSync(mediaFoldersFile, 'utf8'));
    if (folders.includes(name)) {
      return c.json({ error: 'Folder already exists' }, 400);
    }
    folders.push(name);
    fs.writeFileSync(mediaFoldersFile, JSON.stringify(folders, null, 2));
    return c.json({ message: 'Folder created', folders });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

app.delete('/media-folders/:name', authMiddleware, (c) => {
  const name = c.req.param('name');
  if (name === 'Uncategorized') {
    return c.json({ error: 'Cannot delete default folder' }, 400);
  }

  try {
    let folders = JSON.parse(fs.readFileSync(mediaFoldersFile, 'utf8'));
    folders = folders.filter((f: string) => f !== name);
    fs.writeFileSync(mediaFoldersFile, JSON.stringify(folders, null, 2));
    return c.json({ message: 'Folder deleted', folders });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ GALLERY / PROJECTS ROUTES ============

// Get all projects (public)
app.get('/gallery', (c) => {
  try {
    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    return c.json(projects);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Get gallery categories
app.get('/gallery/categories', (c) => {
  try {
    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const categories = [...new Set(projects.map((p: any) => p.category))].filter(Boolean);
    return c.json(categories);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Get single project (public)
app.get('/gallery/:id', (c) => {
  try {
    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const project = projects.find((p: any) => p.id === c.req.param('id'));
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(project);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Create project
app.post('/gallery', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const newProject = {
      id: uuidv4(),
      title: body.title || 'Untitled Project',
      category: body.category || 'General',
      location: body.location || '',
      description: body.description || '',
      images: body.images || [],
      featured: body.featured !== false,
      completedAt: body.completedAt || new Date().toISOString().slice(0, 7),
      createdAt: new Date().toISOString()
    };

    projects.unshift(newProject);
    fs.writeFileSync(galleryFile, JSON.stringify(projects, null, 2));
    logActivity('project_created', { title: newProject.title });
    triggerRebuild('project created');
    return c.json(newProject);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Update project
app.put('/gallery/:id', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const index = projects.findIndex((p: any) => p.id === c.req.param('id'));
    if (index === -1) return c.json({ error: 'Project not found' }, 404);

    projects[index] = {
      ...projects[index],
      title: body.title ?? projects[index].title,
      category: body.category ?? projects[index].category,
      location: body.location ?? projects[index].location,
      description: body.description ?? projects[index].description,
      images: body.images ?? projects[index].images,
      featured: body.featured ?? projects[index].featured,
      completedAt: body.completedAt ?? projects[index].completedAt,
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(galleryFile, JSON.stringify(projects, null, 2));
    logActivity('project_updated', { id: c.req.param('id'), title: projects[index].title });
    triggerRebuild('project updated');
    return c.json(projects[index]);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Delete project
app.delete('/gallery/:id', authMiddleware, (c) => {
  try {
    let projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const project = projects.find((p: any) => p.id === c.req.param('id'));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    projects = projects.filter((p: any) => p.id !== c.req.param('id'));
    fs.writeFileSync(galleryFile, JSON.stringify(projects, null, 2));
    logActivity('project_deleted', { title: project.title });
    triggerRebuild('project deleted');
    return c.json({ message: 'Project deleted' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Reorder projects
app.put('/gallery-reorder', authMiddleware, async (c) => {
  try {
    const { order } = await c.req.json();
    if (!Array.isArray(order)) return c.json({ error: 'Order array required' }, 400);

    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const reordered = order.map((id: string) => projects.find((p: any) => p.id === id)).filter(Boolean);

    // Add any missing projects at the end
    projects.forEach((p: any) => {
      if (!reordered.find((r: any) => r.id === p.id)) {
        reordered.push(p);
      }
    });

    fs.writeFileSync(galleryFile, JSON.stringify(reordered, null, 2));
    return c.json({ message: 'Order saved' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Add images to project
app.post('/gallery/:id/images', authMiddleware, async (c) => {
  try {
    const { images } = await c.req.json();
    if (!Array.isArray(images)) return c.json({ error: 'Images array required' }, 400);

    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const index = projects.findIndex((p: any) => p.id === c.req.param('id'));
    if (index === -1) return c.json({ error: 'Project not found' }, 404);

    projects[index].images = [...(projects[index].images || []), ...images];
    projects[index].updatedAt = new Date().toISOString();

    fs.writeFileSync(galleryFile, JSON.stringify(projects, null, 2));
    return c.json(projects[index]);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Remove image from project
app.delete('/gallery/:id/images/:imageIndex', authMiddleware, (c) => {
  try {
    const projects = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
    const index = projects.findIndex((p: any) => p.id === c.req.param('id'));
    if (index === -1) return c.json({ error: 'Project not found' }, 404);

    const imageIndex = parseInt(c.req.param('imageIndex'));
    if (isNaN(imageIndex) || imageIndex < 0 || imageIndex >= (projects[index].images?.length || 0)) {
      return c.json({ error: 'Invalid image index' }, 400);
    }

    projects[index].images.splice(imageIndex, 1);
    projects[index].updatedAt = new Date().toISOString();

    fs.writeFileSync(galleryFile, JSON.stringify(projects, null, 2));
    return c.json(projects[index]);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ BACKUP ROUTES ============

app.get('/backups', authMiddleware, (c) => {
  try {
    return c.json(listBackups());
  } catch (err) {
    return c.json({ error: 'Failed to list backups' }, 500);
  }
});

app.post('/backups', authMiddleware, (c) => {
  try {
    const result = createBackup();
    return c.json(result);
  } catch (err) {
    return c.json({ error: 'Failed to create backup' }, 500);
  }
});

app.get('/backups/:filename', authMiddleware, (c) => {
  try {
    const filename = c.req.param('filename');
    if (!/^backup-[\d-T]+\.tar\.gz$/.test(filename)) {
      return c.json({ error: 'Invalid filename' }, 400);
    }
    const filepath = path.join(backupsDir, filename);
    if (!fs.existsSync(filepath)) {
      return c.json({ error: 'Backup not found' }, 404);
    }
    const file = fs.readFileSync(filepath);
    return new Response(file, {
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'application/gzip',
      }
    });
  } catch (err) {
    return c.json({ error: 'Failed to download backup' }, 500);
  }
});

// ============ BLOG POSTS ============

const postsFile = path.join(dataDir, 'posts.json');
initFile(postsFile, []);

// Get all posts
app.get('/posts', authMiddleware, (c) => {
  try {
    const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
    return c.json(posts);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Get single post
app.get('/posts/:id', authMiddleware, (c) => {
  try {
    const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
    const post = posts.find((p: any) => p.id === c.req.param('id'));
    if (!post) return c.json({ error: 'Post not found' }, 404);
    return c.json(post);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Create post
app.post('/posts', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
    const newPost = {
      id: body.slug || uuidv4(),
      title: body.title || 'Untitled Post',
      slug: body.slug || '',
      excerpt: body.excerpt || '',
      content: body.content || '',
      author: body.author || '{{COMPANY_NAME}}',
      publishedAt: body.publishedAt || new Date().toISOString(),
      category: body.category || 'tips',
      tags: body.tags || [],
      image: body.image || '',
      relatedServices: body.relatedServices || [],
      featured: body.featured || false,
      published: body.published || false,
      createdAt: new Date().toISOString()
    };

    posts.unshift(newPost);
    fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2));
    logActivity('post_created', { title: newPost.title });
    triggerRebuild('blog post created');
    return c.json(newPost);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Update post
app.put('/posts/:id', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
    const index = posts.findIndex((p: any) => p.id === c.req.param('id'));
    if (index === -1) return c.json({ error: 'Post not found' }, 404);

    posts[index] = {
      ...posts[index],
      title: body.title ?? posts[index].title,
      slug: body.slug ?? posts[index].slug,
      excerpt: body.excerpt ?? posts[index].excerpt,
      content: body.content ?? posts[index].content,
      author: body.author ?? posts[index].author,
      publishedAt: body.publishedAt ?? posts[index].publishedAt,
      category: body.category ?? posts[index].category,
      tags: body.tags ?? posts[index].tags,
      image: body.image ?? posts[index].image,
      relatedServices: body.relatedServices ?? posts[index].relatedServices,
      featured: body.featured ?? posts[index].featured,
      published: body.published ?? posts[index].published,
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2));
    logActivity('post_updated', { id: c.req.param('id'), title: posts[index].title });
    triggerRebuild('blog post updated');
    return c.json(posts[index]);
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// Delete post
app.delete('/posts/:id', authMiddleware, (c) => {
  try {
    let posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
    const post = posts.find((p: any) => p.id === c.req.param('id'));
    if (!post) return c.json({ error: 'Post not found' }, 404);

    posts = posts.filter((p: any) => p.id !== c.req.param('id'));
    fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2));
    logActivity('post_deleted', { title: post.title });
    triggerRebuild('blog post deleted');
    return c.json({ message: 'Post deleted' });
  } catch (err) {
    return c.json({ error: 'Server error' }, 500);
  }
});

// ============ HELP / KNOWLEDGE BASE ============

const helpFile = path.join(dataDir, 'help-articles.json');
initFile(helpFile, []);

app.get('/help/kb', (c) => {
  try {
    const articles = JSON.parse(fs.readFileSync(helpFile, 'utf8'));
    const search = (c.req.query('search') || '').toLowerCase();
    const category = c.req.query('category') || '';
    let filtered = articles.filter((a: any) => a.published !== false);
    if (search) {
      filtered = filtered.filter((a: any) =>
        a.title.toLowerCase().includes(search) || a.content.toLowerCase().includes(search) ||
        (a.tags || []).some((t: string) => t.toLowerCase().includes(search))
      );
    }
    if (category) filtered = filtered.filter((a: any) => a.category === category);
    filtered.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
    return c.json(filtered);
  } catch { return c.json([]); }
});

app.post('/help/kb', authMiddleware, (c) => {
  try {
    const articles = JSON.parse(fs.readFileSync(helpFile, 'utf8'));
    return (c.req.json() as Promise<any>).then((data) => {
      const article = {
        id: uuidv4(), title: data.title || '', content: data.content || '',
        category: data.category || null, tags: data.tags || [], is_faq: data.is_faq || false,
        published: true, sort_order: data.sort_order || 0, view_count: 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      articles.push(article);
      fs.writeFileSync(helpFile, JSON.stringify(articles, null, 2));
      logActivity('help_article_created', { title: article.title });
      return c.json(article, 201);
    });
  } catch { return c.json({ error: 'Server error' }, 500); }
});

app.put('/help/kb/:id', authMiddleware, async (c) => {
  try {
    const articles = JSON.parse(fs.readFileSync(helpFile, 'utf8'));
    const idx = articles.findIndex((a: any) => a.id === c.req.param('id'));
    if (idx === -1) return c.json({ error: 'Not found' }, 404);
    const data = await c.req.json();
    articles[idx] = { ...articles[idx], title: data.title ?? articles[idx].title, content: data.content ?? articles[idx].content, category: data.category ?? articles[idx].category, tags: data.tags ?? articles[idx].tags, is_faq: data.is_faq ?? articles[idx].is_faq, published: data.published ?? articles[idx].published, sort_order: data.sort_order ?? articles[idx].sort_order, updated_at: new Date().toISOString() };
    fs.writeFileSync(helpFile, JSON.stringify(articles, null, 2));
    logActivity('help_article_updated', { title: articles[idx].title });
    return c.json(articles[idx]);
  } catch { return c.json({ error: 'Server error' }, 500); }
});

app.delete('/help/kb/:id', authMiddleware, (c) => {
  try {
    let articles = JSON.parse(fs.readFileSync(helpFile, 'utf8'));
    const article = articles.find((a: any) => a.id === c.req.param('id'));
    if (!article) return c.json({ error: 'Not found' }, 404);
    articles = articles.filter((a: any) => a.id !== c.req.param('id'));
    fs.writeFileSync(helpFile, JSON.stringify(articles, null, 2));
    logActivity('help_article_deleted', { title: article.title });
    return c.json({ message: 'Deleted' });
  } catch { return c.json({ error: 'Server error' }, 500); }
});

app.post('/help/ai-chat', authMiddleware, async (c) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ reply: 'AI support is not configured. Please contact your administrator.' });
  const { message, conversationHistory } = await c.req.json();
  let kbContext = '';
  try {
    const articles = JSON.parse(fs.readFileSync(helpFile, 'utf8')).filter((a: any) => a.published !== false);
    if (articles.length > 0) kbContext = '\n\nKnowledge Base Articles:\n' + articles.map((a: any) => `## ${a.title}\n${a.content}`).join('\n\n');
  } catch {}
  const systemPrompt = `You are a helpful support assistant for a website content management system. Answer questions about managing pages, media, blog posts, SEO, navigation, and other website features based on the knowledge base articles provided. If you cannot find a relevant answer, suggest the user submit a support ticket.${kbContext}`;
  const messages = [...(conversationHistory || []).slice(-20).map((m: any) => ({ role: m.role, content: m.content })), { role: 'user' as const, content: message }];
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: systemPrompt, messages }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return c.json({ reply: 'AI service returned an error. Please try again later.' });
    const data = await res.json() as any;
    return c.json({ reply: data.content?.[0]?.text || 'Sorry, I could not process that request.' });
  } catch { return c.json({ reply: 'AI service is temporarily unavailable. Please try again later.' }); }
});

export default app;
