require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

// Routes
const servicesRoutes = require('./routes/services');
const adminRoutes = require('./routes/admin');
const { startSchedule: startBackups } = require('./services/autoBackup');
const { rebuildMiddleware } = require('./rebuild-middleware');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;

// Ensure uploads directory exists
const appPaths = require('./config/paths');
const uploadsDir = appPaths.uploads;
const BASE_URL = process.env.BASE_URL || '{{SITE_URL}}';

// Check if we have a build directory
const buildDir = path.join(__dirname, 'build');
const hasBuild = fs.existsSync(buildDir);

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

if (hasBuild && process.env.NODE_ENV === 'production') {
  // Serve static HTML files
  app.use(express.static(buildDir));
  
  // Admin panel (React SPA)
  const frontendDist = path.join(__dirname, '../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use('/admin', express.static(frontendDist));
    
    app.get('/admin*', (req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }
  
  // 404 fallback for static site
  app.get('*', (req, res) => {
    const notFoundPath = path.join(buildDir, '404.html');
    if (fs.existsSync(notFoundPath)) {
      res.status(404).sendFile(notFoundPath);
    } else {
      res.status(404).send('Page not found');
    }
  });
} else {
  // Development mode - serve React app
  const distPath = path.join(__dirname, '../frontend/dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

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
║   Mode: ${hasBuild && process.env.NODE_ENV === 'production' ? 'Static Site (SSG)' : 'Development (SPA)'}              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);

  startBackups();
});

module.exports = app;
