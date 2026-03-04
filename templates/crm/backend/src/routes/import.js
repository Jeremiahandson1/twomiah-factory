import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';
import importService from '../services/import.js';
import audit from '../services/audit.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('admin', 'owner'));

// Multer for CSV upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

// Get CSV template
router.get('/template/:type', (req, res) => {
  const { type } = req.params;
  const template = importService.getTemplate(type);
  
  if (!template) {
    return res.status(400).json({ error: 'Invalid template type' });
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${type}-template.csv`);
  res.send(template);
});

// Preview import (validate without saving)
router.post('/preview/:type', upload.single('file'), async (req, res, next) => {
  try {
    const { type } = req.params;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvContent = req.file.buffer.toString('utf-8');
    const preview = await importService.previewImport(csvContent, type, req.user.companyId);
    
    res.json(preview);
  } catch (error) {
    next(error);
  }
});

// Import contacts
router.post('/contacts', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvContent = req.file.buffer.toString('utf-8');
    const options = {
      skipDuplicates: req.body.skipDuplicates !== 'false',
      updateExisting: req.body.updateExisting === 'true',
      defaultType: req.body.defaultType || 'client',
    };

    const results = await importService.importContacts(csvContent, req.user.companyId, options);

    audit.log({
      action: 'IMPORT',
      entity: 'contacts',
      metadata: { 
        imported: results.imported, 
        skipped: results.skipped,
        filename: req.file.originalname,
      },
      req,
    });

    res.json(results);
  } catch (error) {
    next(error);
  }
});

// Import projects
router.post('/projects', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvContent = req.file.buffer.toString('utf-8');
    const options = {
      skipDuplicates: req.body.skipDuplicates !== 'false',
    };

    const results = await importService.importProjects(csvContent, req.user.companyId, options);

    audit.log({
      action: 'IMPORT',
      entity: 'projects',
      metadata: { imported: results.imported, skipped: results.skipped },
      req,
    });

    res.json(results);
  } catch (error) {
    next(error);
  }
});

// Import jobs
router.post('/jobs', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvContent = req.file.buffer.toString('utf-8');
    const results = await importService.importJobs(csvContent, req.user.companyId);

    audit.log({
      action: 'IMPORT',
      entity: 'jobs',
      metadata: { imported: results.imported, skipped: results.skipped },
      req,
    });

    res.json(results);
  } catch (error) {
    next(error);
  }
});

// Import products
router.post('/products', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvContent = req.file.buffer.toString('utf-8');
    const results = await importService.importProducts(csvContent, req.user.companyId);

    audit.log({
      action: 'IMPORT',
      entity: 'products',
      metadata: { imported: results.imported, skipped: results.skipped },
      req,
    });

    res.json(results);
  } catch (error) {
    next(error);
  }
});

export default router;
