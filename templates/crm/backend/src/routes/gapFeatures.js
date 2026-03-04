/**
 * Routes for the 5 remaining competitive gap features:
 * 1. Online Booking
 * 2. Job Costing
 * 3. Custom Forms
 * 4. Lien Waivers
 * 5. Draw Schedules
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import booking from '../services/booking.js';
import jobCosting from '../services/jobCosting.js';
import customForms from '../services/customForms.js';
import lienWaivers from '../services/lienWaivers.js';
import drawSchedules from '../services/drawSchedules.js';

// ============================================
// 1. ONLINE BOOKING
// ============================================
export const bookingRoutes = Router();

// PUBLIC (no auth) - for the embeddable widget
bookingRoutes.get('/public/:slug', async (req, res, next) => {
  try {
    const settings = await booking.getBookingSettingsBySlug(req.params.slug);
    const services = await booking.getBookableServicesBySlug(req.params.slug);
    res.json({ settings, services });
  } catch (e) { next(e); }
});

bookingRoutes.get('/public/:slug/dates', async (req, res, next) => {
  try {
    const dates = await booking.getAvailableDatesBySlug(req.params.slug);
    res.json(dates);
  } catch (e) { next(e); }
});

bookingRoutes.get('/public/:slug/slots', async (req, res, next) => {
  try {
    const { date, serviceId } = req.query;
    const slots = await booking.getAvailableSlotsBySlug(req.params.slug, date, serviceId);
    res.json(slots);
  } catch (e) { next(e); }
});

bookingRoutes.post('/public/:slug', async (req, res, next) => {
  try {
    const result = await booking.createBooking(req.params.slug, req.body);
    res.status(201).json(result);
  } catch (e) { next(e); }
});

// ADMIN (authenticated)
bookingRoutes.use(authenticate);

bookingRoutes.get('/settings', async (req, res, next) => {
  try {
    const settings = await booking.getBookingSettings(req.user.companyId);
    res.json(settings);
  } catch (e) { next(e); }
});

bookingRoutes.put('/settings', async (req, res, next) => {
  try {
    const settings = await booking.updateBookingSettings(req.user.companyId, req.body);
    res.json(settings);
  } catch (e) { next(e); }
});

bookingRoutes.get('/services', async (req, res, next) => {
  try {
    const services = await booking.getBookableServices(req.user.companyId);
    res.json(services);
  } catch (e) { next(e); }
});

bookingRoutes.post('/services', async (req, res, next) => {
  try {
    const service = await booking.createBookableService(req.user.companyId, req.body);
    res.status(201).json(service);
  } catch (e) { next(e); }
});

bookingRoutes.get('/embed-code', async (req, res, next) => {
  try {
    const code = booking.generateEmbedCode(req.user.company?.slug);
    res.json({ embedCode: code });
  } catch (e) { next(e); }
});

// ============================================
// 2. JOB COSTING
// ============================================
export const jobCostingRoutes = Router();
jobCostingRoutes.use(authenticate);

jobCostingRoutes.get('/job/:jobId', async (req, res, next) => {
  try {
    const analysis = await jobCosting.getJobCostAnalysis(req.params.jobId, req.user.companyId);
    res.json(analysis);
  } catch (e) { next(e); }
});

jobCostingRoutes.get('/report', async (req, res, next) => {
  try {
    const { startDate, endDate, status, limit } = req.query;
    const report = await jobCosting.getJobCostingReport(req.user.companyId, { startDate, endDate, status, limit: +limit || 100 });
    res.json(report);
  } catch (e) { next(e); }
});

jobCostingRoutes.get('/trends', async (req, res, next) => {
  try {
    const { months } = req.query;
    const trends = await jobCosting.getProfitabilityTrends(req.user.companyId, { months: +months || 12 });
    res.json(trends);
  } catch (e) { next(e); }
});

// ============================================
// 3. CUSTOM FORMS
// ============================================
export const customFormsRoutes = Router();
customFormsRoutes.use(authenticate);

// Templates
customFormsRoutes.get('/templates', async (req, res, next) => {
  try {
    const { category } = req.query;
    const templates = await customForms.getFormTemplates(req.user.companyId, { category });
    res.json(templates);
  } catch (e) { next(e); }
});

customFormsRoutes.get('/templates/:id', async (req, res, next) => {
  try {
    const template = await customForms.getFormTemplate(req.params.id, req.user.companyId);
    if (!template) return res.status(404).json({ error: 'Not found' });
    res.json(template);
  } catch (e) { next(e); }
});

customFormsRoutes.post('/templates', async (req, res, next) => {
  try {
    const template = await customForms.createFormTemplate(req.user.companyId, req.body);
    res.status(201).json(template);
  } catch (e) { next(e); }
});

customFormsRoutes.put('/templates/:id', async (req, res, next) => {
  try {
    await customForms.updateFormTemplate(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (e) { next(e); }
});

customFormsRoutes.post('/templates/seed-defaults', async (req, res, next) => {
  try {
    await customForms.seedDefaultTemplates(req.user.companyId);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// Submissions
customFormsRoutes.get('/submissions', async (req, res, next) => {
  try {
    const { jobId, projectId, templateId } = req.query;
    const submissions = await customForms.getSubmissions(req.user.companyId, { jobId, projectId, templateId });
    res.json(submissions);
  } catch (e) { next(e); }
});

customFormsRoutes.get('/submissions/:id', async (req, res, next) => {
  try {
    const submission = await customForms.getSubmission(req.params.id, req.user.companyId);
    if (!submission) return res.status(404).json({ error: 'Not found' });
    res.json(submission);
  } catch (e) { next(e); }
});

customFormsRoutes.post('/submissions', async (req, res, next) => {
  try {
    const submission = await customForms.submitForm(req.user.companyId, {
      ...req.body,
      submittedById: req.user.id,
    });
    res.status(201).json(submission);
  } catch (e) { next(e); }
});

// ============================================
// 4. LIEN WAIVERS
// ============================================
export const lienWaiverRoutes = Router();
lienWaiverRoutes.use(authenticate);

lienWaiverRoutes.get('/', async (req, res, next) => {
  try {
    const { status, projectId, page, limit } = req.query;
    const waivers = await lienWaivers.getAllWaivers(req.user.companyId, { status, projectId, page: +page || 1, limit: +limit || 50 });
    res.json(waivers);
  } catch (e) { next(e); }
});

lienWaiverRoutes.get('/project/:projectId', async (req, res, next) => {
  try {
    const { status, vendorId } = req.query;
    const waivers = await lienWaivers.getProjectWaivers(req.params.projectId, req.user.companyId, { status, vendorId });
    res.json(waivers);
  } catch (e) { next(e); }
});

lienWaiverRoutes.get('/project/:projectId/compliance', async (req, res, next) => {
  try {
    const compliance = await lienWaivers.getProjectCompliance(req.params.projectId, req.user.companyId);
    res.json(compliance);
  } catch (e) { next(e); }
});

lienWaiverRoutes.get('/outstanding', async (req, res, next) => {
  try {
    const { projectId } = req.query;
    const outstanding = await lienWaivers.getOutstandingWaivers(req.user.companyId, { projectId });
    res.json(outstanding);
  } catch (e) { next(e); }
});

lienWaiverRoutes.post('/', async (req, res, next) => {
  try {
    const waiver = await lienWaivers.createWaiverRequest(req.user.companyId, req.body);
    res.status(201).json(waiver);
  } catch (e) { next(e); }
});

lienWaiverRoutes.put('/:id/upload', async (req, res, next) => {
  try {
    await lienWaivers.uploadSignedWaiver(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (e) { next(e); }
});

lienWaiverRoutes.put('/:id/approve', async (req, res, next) => {
  try {
    await lienWaivers.approveWaiver(req.params.id, req.user.companyId, {
      approvedById: req.user.id,
      notes: req.body.notes,
    });
    res.json({ success: true });
  } catch (e) { next(e); }
});

lienWaiverRoutes.put('/:id/reject', async (req, res, next) => {
  try {
    await lienWaivers.rejectWaiver(req.params.id, req.user.companyId, {
      rejectedById: req.user.id,
      reason: req.body.reason,
    });
    res.json({ success: true });
  } catch (e) { next(e); }
});

// ============================================
// 5. DRAW SCHEDULES
// ============================================
export const drawScheduleRoutes = Router();
drawScheduleRoutes.use(authenticate);

// Schedule of Values
drawScheduleRoutes.get('/sov/:projectId', async (req, res, next) => {
  try {
    const sov = await drawSchedules.getScheduleOfValues(req.params.projectId, req.user.companyId);
    res.json(sov);
  } catch (e) { next(e); }
});

drawScheduleRoutes.post('/sov', async (req, res, next) => {
  try {
    const { projectId, ...data } = req.body;
    const sov = await drawSchedules.createScheduleOfValues(req.user.companyId, projectId, data);
    res.status(201).json(sov);
  } catch (e) { next(e); }
});

drawScheduleRoutes.put('/sov/line-item/:id', async (req, res, next) => {
  try {
    await drawSchedules.updateSOVLineItem(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (e) { next(e); }
});

drawScheduleRoutes.post('/sov/:sovId/line-item', async (req, res, next) => {
  try {
    const item = await drawSchedules.addSOVLineItem(req.params.sovId, req.user.companyId, req.body);
    res.status(201).json(item);
  } catch (e) { next(e); }
});

// Draw Requests
drawScheduleRoutes.get('/project/:projectId', async (req, res, next) => {
  try {
    const draws = await drawSchedules.getProjectDraws(req.params.projectId, req.user.companyId);
    res.json(draws);
  } catch (e) { next(e); }
});

drawScheduleRoutes.get('/:id', async (req, res, next) => {
  try {
    const draw = await drawSchedules.getDrawRequest(req.params.id, req.user.companyId);
    if (!draw) return res.status(404).json({ error: 'Not found' });
    res.json(draw);
  } catch (e) { next(e); }
});

drawScheduleRoutes.post('/', async (req, res, next) => {
  try {
    const { sovId, ...data } = req.body;
    const draw = await drawSchedules.createDrawRequest(req.user.companyId, sovId, data);
    res.status(201).json(draw);
  } catch (e) { next(e); }
});

drawScheduleRoutes.put('/:id', async (req, res, next) => {
  try {
    await drawSchedules.updateDrawRequest(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (e) { next(e); }
});

drawScheduleRoutes.post('/:id/submit', async (req, res, next) => {
  try {
    const draw = await drawSchedules.submitDrawRequest(req.params.id, req.user.companyId);
    res.json(draw);
  } catch (e) { next(e); }
});

drawScheduleRoutes.post('/:id/approve', async (req, res, next) => {
  try {
    const draw = await drawSchedules.approveDrawRequest(req.params.id, req.user.companyId, {
      approvedById: req.user.id,
      notes: req.body.notes,
    });
    res.json(draw);
  } catch (e) { next(e); }
});

drawScheduleRoutes.post('/:id/reject', async (req, res, next) => {
  try {
    await drawSchedules.rejectDrawRequest(req.params.id, req.user.companyId, {
      rejectedById: req.user.id,
      reason: req.body.reason,
    });
    res.json({ success: true });
  } catch (e) { next(e); }
});

// G702/G703 generation
drawScheduleRoutes.get('/:id/g702', async (req, res, next) => {
  try {
    const data = await drawSchedules.generateG702Data(req.params.id, req.user.companyId);
    res.json(data);
  } catch (e) { next(e); }
});

drawScheduleRoutes.get('/:id/g703', async (req, res, next) => {
  try {
    const data = await drawSchedules.generateG703Data(req.params.id, req.user.companyId);
    res.json(data);
  } catch (e) { next(e); }
});

export default {
  bookingRoutes,
  jobCostingRoutes,
  customFormsRoutes,
  lienWaiverRoutes,
  drawScheduleRoutes,
};
