import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { syncFeatures } from './startup/featureSync.js';
import { PrismaClient } from '@prisma/client';

// Services
import logger from './services/logger.js';
import { initializeSocket } from './services/socket.js';

// Middleware
import { applySecurity } from './middleware/security.js';
import { errorHandler, notFoundHandler, handleUncaughtExceptions } from './utils/errors.js';

// Routes
import authRoutes from './routes/auth.js';
import contactsRoutes from './routes/contacts.js';
import projectsRoutes from './routes/projects.js';
import jobsRoutes from './routes/jobs.js';
import quotesRoutes from './routes/quotes.js';
import invoicesRoutes from './routes/invoices.js';
import timeRoutes from './routes/time.js';
import expensesRoutes from './routes/expenses.js';
import rfisRoutes from './routes/rfis.js';
import changeOrdersRoutes from './routes/changeOrders.js';
import punchListsRoutes from './routes/punchLists.js';
import dailyLogsRoutes from './routes/dailyLogs.js';
import inspectionsRoutes from './routes/inspections.js';
import bidsRoutes from './routes/bids.js';
import teamRoutes from './routes/team.js';
import companyRoutes from './routes/company.js';
import dashboardRoutes from './routes/dashboard.js';
import documentsRoutes from './routes/documents.js';
import billingRoutes from './routes/billing.js';
import integrationsRoutes from './routes/integrations.js';

// Auto-wired feature routes
import agencyAdminRoutes from './routes/agencyAdmin.js';
import agreementsRoutes from './routes/agreements.js';
import auditRoutes from './routes/audit.js';
import bookingRoutes from './routes/booking.js';
import bulkRoutes from './routes/bulk.js';
import calltrackingRoutes from './routes/calltracking.js';
import commentsRoutes from './routes/comments.js';
import equipmentRoutes from './routes/equipment.js';
import exportRoutes from './routes/export.js';
import fleetRoutes from './routes/fleet.js';
import gapFeaturesRoutes from './routes/gapFeatures.js';
import geofencingRoutes from './routes/geofencing.js';
import importRoutes from './routes/import.js';
import inventoryRoutes from './routes/inventory.js';
import mapsRoutes from './routes/maps.js';
import marketingRoutes from './routes/marketing.js';
import photosRoutes from './routes/photos.js';
import portalRoutes from './routes/portal.js';
import portalSelectionsRoutes from './routes/portal-selections.js';
import pricebookRoutes from './routes/pricebook.js';
import pushRoutes from './routes/push.js';
import quickbooksRoutes from './routes/quickbooks.js';
import recurringRoutes from './routes/recurring.js';
import reportingRoutes from './routes/reporting.js';
import reviewsRoutes from './routes/reviews.js';
import routingRoutes from './routes/routing.js';
import schedulingRoutes from './routes/scheduling.js';
import searchRoutes from './routes/search.js';
import selectionsRoutes from './routes/selections.js';
import smsRoutes from './routes/sms.js';
import stripeRoutes from './routes/stripe.js';
import takeoffsRoutes from './routes/takeoffs.js';
import tasksRoutes from './routes/tasks.js';
import timeTrackingRoutes from './routes/timeTracking.js';
import warrantiesRoutes from './routes/warranties.js';
import weatherRoutes from './routes/weather.js';
import wisetackRoutes from './routes/wisetack.js';

dotenv.config();

// Handle uncaught exceptions
handleUncaughtExceptions();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// Initialize WebSocket
const io = initializeSocket(server);

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

export { prisma, io };

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const allowed = (process.env.FRONTEND_URL || 'http://localhost:5173')
      .split(',').map(s => s.trim());
    if (allowed.some(u => origin === u || origin.endsWith('.onrender.com'))) {
      return callback(null, true);
    }
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-ID'],
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Apply security middleware
applySecurity(app);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many authentication attempts, please try again later' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

// Static files (uploads)
const uploadsDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
app.use('/uploads', express.static(uploadsDir));

// Make prisma available to routes
app.use((req, res, next) => {
  req.prisma = prisma;
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/time', timeRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/rfis', rfisRoutes);
app.use('/api/change-orders', changeOrdersRoutes);
app.use('/api/punch-lists', punchListsRoutes);
app.use('/api/daily-logs', dailyLogsRoutes);
app.use('/api/inspections', inspectionsRoutes);
app.use('/api/bids', bidsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/integrations', integrationsRoutes);

// Feature routes
app.use('/api/agency', agencyAdminRoutes);
app.use('/api/agreements', agreementsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/bulk', bulkRoutes);
app.use('/api/calltracking', calltrackingRoutes);
app.use('/api/comments', commentsRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/fleet', fleetRoutes);
app.use('/api/gap-features', gapFeaturesRoutes);
app.use('/api/geofencing', geofencingRoutes);
app.use('/api/import', importRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/maps', mapsRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/photos', photosRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/portal/selections', portalSelectionsRoutes);
app.use('/api/pricebook', pricebookRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/quickbooks', quickbooksRoutes);
app.use('/api/recurring', recurringRoutes);
app.use('/api/reports', reportingRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/routing', routingRoutes);
app.use('/api/scheduling', schedulingRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/selections', selectionsRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/takeoffs', takeoffsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/time-tracking', timeTrackingRoutes);
app.use('/api/warranties', warrantiesRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/wisetack', wisetackRoutes);

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Graceful shutdown
const shutdown = async (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
const PORT = process.env.PORT || 3001;

// Sync features from FEATURE_PACKAGE env var before accepting traffic
await syncFeatures(prisma).catch(console.error);

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, {
    env: process.env.NODE_ENV || 'development',
    port: PORT,
    websocket: 'enabled',
  });
});

export default app;
