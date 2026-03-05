import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

import logger from './services/logger.js';
import { initializeSocket } from './services/socket.js';
import { applySecurity } from './middleware/security.js';
import { errorHandler, notFoundHandler, handleUncaughtExceptions } from './utils/errors.js';

// Routes
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import clientsRoutes from './routes/clients.js';
import caregiversRoutes from './routes/caregivers.js';
import schedulingRoutes from './routes/scheduling.js';
import timeTrackingRoutes from './routes/timeTracking.js';
import billingRoutes from './routes/billing.js';
import payrollRoutes from './routes/payroll.js';
import complianceRoutes from './routes/compliance.js';
import communicationRoutes from './routes/communication.js';
import documentsRoutes from './routes/documents.js';
import notificationsRoutes from './routes/notifications.js';
import pushRoutes from './routes/push.js';
import smsRoutes from './routes/sms.js';
import portalRoutes from './routes/portal.js';
import reportsRoutes from './routes/reports.js';
import formsRoutes from './routes/forms.js';
import evvRoutes from './routes/evv.js';
import ediRoutes from './routes/edi.js';
import claimsRoutes from './routes/claims.js';
import remittanceRoutes from './routes/remittance.js';
import authorizationsRoutes from './routes/authorizations.js';
import serviceCodesRoutes from './routes/serviceCodes.js';
import payersRoutes from './routes/payers.js';
import auditRoutes from './routes/audit.js';
import companyRoutes from './routes/company.js';
import stripeRoutes from './routes/stripe.js';
import optimizerRoutes from './routes/optimizer.js';

dotenv.config();

handleUncaughtExceptions();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

const io = initializeSocket(server);

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

export { prisma, io };

app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

applySecurity(app);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 200 : 1000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many authentication attempts' },
});
app.use('/api/auth/login', authLimiter);

const uploadsDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
app.use('/uploads', express.static(uploadsDir));

app.use((req, res, next) => {
  req.prisma = prisma;
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/caregivers', caregiversRoutes);
app.use('/api/scheduling', schedulingRoutes);
app.use('/api/time-tracking', timeTrackingRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/communication', communicationRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/forms', formsRoutes);
app.use('/api/evv', evvRoutes);
app.use('/api/edi', ediRoutes);
app.use('/api/claims', claimsRoutes);
app.use('/api/remittance', remittanceRoutes);
app.use('/api/authorizations', authorizationsRoutes);
app.use('/api/service-codes', serviceCodesRoutes);
app.use('/api/payers', payersRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/optimizer', optimizerRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const shutdown = async (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  logger.info(`{{COMPANY_NAME}} Care API running on port ${PORT}`, {
    env: process.env.NODE_ENV || 'development',
    port: PORT,
  });
});

export default app;
