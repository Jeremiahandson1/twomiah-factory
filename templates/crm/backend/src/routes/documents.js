import express from 'express';
import path from 'path';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, NotFoundError, ValidationError } from '../utils/errors.js';
import fileService, { upload, setUploadSubdir, handleUploadError } from '../services/fileUpload.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(authenticate);

// List documents
router.get('/', asyncHandler(async (req, res) => {
  const { projectId, contactId, type, search, page = 1, limit = 25 } = req.query;
  const skip = (page - 1) * limit;

  const where = { companyId: req.user.companyId };
  if (projectId) where.projectId = projectId;
  if (contactId) where.contactId = contactId;
  if (type) where.type = type;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [documents, total] = await Promise.all([
    req.prisma.document.findMany({
      where,
      include: { 
        project: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: parseInt(skip),
      take: parseInt(limit),
    }),
    req.prisma.document.count({ where }),
  ]);

  res.json({
    data: documents,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  });
}));

// Get single document
router.get('/:id', asyncHandler(async (req, res) => {
  const document = await req.prisma.document.findFirst({
    where: { id: req.params.id, companyId: req.user.companyId },
    include: {
      project: { select: { id: true, name: true, number: true } },
      contact: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (!document) throw new NotFoundError('Document');
  res.json(document);
}));

// Upload document
router.post('/',
  setUploadSubdir('documents'),
  upload.single('file', 'all'),
  handleUploadError,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError('No file uploaded');
    }

    const { name, description, type, projectId, contactId, jobId, invoiceId } = req.body;

    // Process image if it's an image type
    let filePath = req.file.path;
    let thumbnailPath = null;
    
    if (req.file.mimetype.startsWith('image/')) {
      try {
        filePath = await fileService.processImage(filePath, { width: 2000, height: 2000 });
        thumbnailPath = await fileService.generateThumbnail(filePath, 200);
      } catch (err) {
        logger.logError(err, req, { action: 'processImage' });
      }
    }

    const document = await req.prisma.document.create({
      data: {
        companyId: req.user.companyId,
        name: name || req.file.originalname,
        description,
        type: type || 'general',
        filename: path.basename(filePath),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        path: filePath,
        thumbnailPath,
        url: fileService.getFileUrl(filePath, req.user.companyId),
        thumbnailUrl: thumbnailPath ? fileService.getFileUrl(thumbnailPath, req.user.companyId) : null,
        projectId: projectId || null,
        contactId: contactId || null,
        jobId: jobId || null,
        invoiceId: invoiceId || null,
        uploadedById: req.user.userId,
      },
      include: {
        uploadedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    logger.audit('document_upload', req.user.userId, req.user.companyId, {
      documentId: document.id,
      filename: document.originalName,
    });

    res.status(201).json(document);
  })
);

// Upload multiple documents
router.post('/bulk',
  setUploadSubdir('documents'),
  upload.multiple('files', 10, 'all'),
  handleUploadError,
  asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0) {
      throw new ValidationError('No files uploaded');
    }

    const { projectId, contactId, type } = req.body;
    const documents = [];

    for (const file of req.files) {
      let filePath = file.path;
      let thumbnailPath = null;

      if (file.mimetype.startsWith('image/')) {
        try {
          filePath = await fileService.processImage(filePath, { width: 2000, height: 2000 });
          thumbnailPath = await fileService.generateThumbnail(filePath, 200);
        } catch (err) {
          logger.logError(err, req, { action: 'processImage', file: file.originalname });
        }
      }

      const document = await req.prisma.document.create({
        data: {
          companyId: req.user.companyId,
          name: file.originalname,
          type: type || 'general',
          filename: path.basename(filePath),
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          path: filePath,
          thumbnailPath,
          url: fileService.getFileUrl(filePath, req.user.companyId),
          thumbnailUrl: thumbnailPath ? fileService.getFileUrl(thumbnailPath, req.user.companyId) : null,
          projectId: projectId || null,
          contactId: contactId || null,
          uploadedById: req.user.userId,
        },
      });

      documents.push(document);
    }

    logger.audit('bulk_document_upload', req.user.userId, req.user.companyId, {
      count: documents.length,
    });

    res.status(201).json({ data: documents, count: documents.length });
  })
);

// Update document metadata
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, description, type, projectId, contactId } = req.body;

  const existing = await req.prisma.document.findFirst({
    where: { id: req.params.id, companyId: req.user.companyId },
  });

  if (!existing) throw new NotFoundError('Document');

  const document = await req.prisma.document.update({
    where: { id: req.params.id },
    data: {
      name,
      description,
      type,
      projectId: projectId || null,
      contactId: contactId || null,
    },
    include: {
      project: { select: { id: true, name: true } },
      contact: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  res.json(document);
}));

// Delete document
router.delete('/:id', asyncHandler(async (req, res) => {
  const document = await req.prisma.document.findFirst({
    where: { id: req.params.id, companyId: req.user.companyId },
  });

  if (!document) throw new NotFoundError('Document');

  // Delete physical files
  try {
    if (document.path) fileService.deleteFile(document.path);
    if (document.thumbnailPath) fileService.deleteFile(document.thumbnailPath);
  } catch (err) {
    logger.logError(err, req, { action: 'deleteFile', documentId: document.id });
  }

  await req.prisma.document.delete({ where: { id: req.params.id } });

  logger.audit('document_delete', req.user.userId, req.user.companyId, {
    documentId: document.id,
    filename: document.originalName,
  });

  res.json({ success: true });
}));

// Download document
router.get('/:id/download', asyncHandler(async (req, res) => {
  const document = await req.prisma.document.findFirst({
    where: { id: req.params.id, companyId: req.user.companyId },
  });

  if (!document) throw new NotFoundError('Document');
  if (!document.path) throw new NotFoundError('File');

  res.download(document.path, document.originalName);
}));

export default router;
