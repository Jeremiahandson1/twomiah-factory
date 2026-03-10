import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { rateLimiter } from 'hono-rate-limiter';
import { serveStatic } from 'hono/bun';
import { logger } from './services/logger';
import { errorHandler } from './utils/errors';
import { handleUncaughtExceptions } from './utils/errors';

// Route imports
import authRoutes from './routes/auth';
import pricebookRoutes from './routes/pricebook';
import territoriesRoutes from './routes/territories';
import promotionsRoutes from './routes/promotions';
import resourceLibraryRoutes from './routes/resourceLibrary';
import contractsRoutes from './routes/contracts';
import quotesRoutes from './routes/quotes';
import financingRoutes from './routes/financing';
import inflationRoutes from './routes/inflation';
import commissionsRoutes from './routes/commissions';
import analyticsRoutes from './routes/analytics';
import repsRoutes from './routes/reps';
import settingsRoutes from './routes/settings';
import importRoutes from './routes/import';
import syncRoutes from './routes/sync';

// Handle uncaught exceptions
handleUncaughtExceptions();

const app = new Hono();

// Global middleware
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Disposition'],
    maxAge: 86400,
  })
);

app.use('*', secureHeaders());

// Rate limiter: 100 requests per minute per IP
app.use(
  '/api/*',
  rateLimiter({
    windowMs: 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-6',
    keyGenerator: (c) =>
      c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'anonymous',
  })
);

// Request logging
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  logger.info(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
});

// Health endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API routes
app.route('/api/auth', authRoutes);
app.route('/api/pricebook', pricebookRoutes);
app.route('/api/territories', territoriesRoutes);
app.route('/api/promotions', promotionsRoutes);
app.route('/api/resource-library', resourceLibraryRoutes);
app.route('/api/contracts', contractsRoutes);
app.route('/api/quotes', quotesRoutes);
app.route('/api/financing', financingRoutes);
app.route('/api/inflation', inflationRoutes);
app.route('/api/commissions', commissionsRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/reps', repsRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/import', importRoutes);
app.route('/api/sync', syncRoutes);

// Serve frontend SPA from frontend-dist
app.use('/assets/*', serveStatic({ root: './frontend-dist' }));
app.use('/favicon.ico', serveStatic({ path: './frontend-dist/favicon.ico' }));

// SPA fallback: serve index.html for non-API routes
app.get('*', serveStatic({ path: './frontend-dist/index.html' }));

// Global error handler
app.onError(errorHandler);

// Start server
const port = parseInt(process.env.PORT || '3000');

logger.info(`Starting Pricing Backend on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
