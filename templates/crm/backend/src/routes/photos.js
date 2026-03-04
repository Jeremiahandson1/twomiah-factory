import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import photoService from '../services/photos.js';
import audit from '../services/audit.js';

const router = Router();
router.use(authenticate);

// Multer config for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images are allowed'));
    }
  },
});

// Get photos
router.get('/', requirePermission('documents:read'), async (req, res, next) => {
  try {
    const { projectId, jobId, category, page = '1', limit = '50' } = req.query;
    
    const result = await photoService.getPhotos({
      companyId: req.user.companyId,
      projectId,
      jobId,
      category,
      page: parseInt(page),
      limit: parseInt(limit),
    });
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get single photo
router.get('/:id', requirePermission('documents:read'), async (req, res, next) => {
  try {
    const photo = await photoService.getPhoto(req.params.id, req.user.companyId);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    res.json(photo);
  } catch (error) {
    next(error);
  }
});

// Get photo file
router.get('/:id/file', requirePermission('documents:read'), async (req, res, next) => {
  try {
    const photo = await photoService.getPhoto(req.params.id, req.user.companyId);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    const filePath = photoService.getPhotoPath(photo.filename);
    res.sendFile(filePath, { root: '.' });
  } catch (error) {
    next(error);
  }
});

// Get thumbnail
router.get('/:id/thumbnail', requirePermission('documents:read'), async (req, res, next) => {
  try {
    const photo = await photoService.getPhoto(req.params.id, req.user.companyId);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    const filePath = photoService.getThumbnailPath(photo.thumbnailPath);
    res.sendFile(filePath, { root: '.' });
  } catch (error) {
    next(error);
  }
});

// Upload single photo
router.post('/', requirePermission('documents:create'), upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded' });
    }
    
    const { projectId, jobId, caption, category } = req.body;
    
    const photo = await photoService.processPhoto(req.file, {
      companyId: req.user.companyId,
      projectId: projectId || null,
      jobId: jobId || null,
      userId: req.user.userId,
      caption,
      category,
    });
    
    audit.log({
      action: audit.ACTIONS.CREATE,
      entity: 'photo',
      entityId: photo.id,
      entityName: photo.originalName,
      req,
    });
    
    res.status(201).json(photo);
  } catch (error) {
    next(error);
  }
});

// Upload multiple photos
router.post('/bulk', requirePermission('documents:create'), upload.array('photos', 20), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No photos uploaded' });
    }
    
    const { projectId, jobId, category } = req.body;
    
    const results = await photoService.processPhotos(req.files, {
      companyId: req.user.companyId,
      projectId: projectId || null,
      jobId: jobId || null,
      userId: req.user.userId,
      category,
    });
    
    const successful = results.filter(r => r.success);
    if (successful.length > 0) {
      audit.log({
        action: audit.ACTIONS.CREATE,
        entity: 'photo',
        entityName: `${successful.length} photos uploaded`,
        metadata: { count: successful.length, projectId, jobId },
        req,
      });
    }
    
    res.status(201).json({
      uploaded: successful.length,
      failed: results.length - successful.length,
      results,
    });
  } catch (error) {
    next(error);
  }
});

// Update photo
router.put('/:id', requirePermission('documents:update'), async (req, res, next) => {
  try {
    const { caption, category, projectId, jobId } = req.body;
    
    const photo = await photoService.updatePhoto(req.params.id, req.user.companyId, {
      caption,
      category,
      projectId,
      jobId,
    });
    
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    res.json(photo);
  } catch (error) {
    next(error);
  }
});

// Delete photo
router.delete('/:id', requirePermission('documents:delete'), async (req, res, next) => {
  try {
    const photo = await photoService.getPhoto(req.params.id, req.user.companyId);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    await photoService.deletePhoto(req.params.id, req.user.companyId);
    
    audit.log({
      action: audit.ACTIONS.DELETE,
      entity: 'photo',
      entityId: req.params.id,
      entityName: photo.originalName,
      req,
    });
    
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Get categories
router.get('/meta/categories', (req, res) => {
  res.json(photoService.PHOTO_CATEGORIES);
});

export default router;
