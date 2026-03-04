import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import logger from './logger.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024; // 10MB
const ALLOWED_MIMES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  spreadsheet: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'],
  all: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'],
};

// Ensure upload directories exist
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Create company-specific upload path
function getCompanyPath(companyId, subdir = '') {
  const companyDir = path.join(UPLOAD_DIR, companyId, subdir);
  ensureDir(companyDir);
  return companyDir;
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const companyId = req.user?.companyId || 'temp';
    const subdir = req.uploadSubdir || 'general';
    const uploadPath = getCompanyPath(companyId, subdir);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  },
});

// File filter
const fileFilter = (allowedTypes) => (req, file, cb) => {
  const mimes = ALLOWED_MIMES[allowedTypes] || ALLOWED_MIMES.all;
  if (mimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: ${allowedTypes}`), false);
  }
};

// Multer instances
export const upload = {
  single: (fieldName, allowedTypes = 'all') => multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: fileFilter(allowedTypes),
  }).single(fieldName),

  multiple: (fieldName, maxCount = 10, allowedTypes = 'all') => multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: fileFilter(allowedTypes),
  }).array(fieldName, maxCount),

  fields: (fields, allowedTypes = 'all') => multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: fileFilter(allowedTypes),
  }).fields(fields),
};

// Image processing
export async function processImage(filePath, options = {}) {
  const {
    width = 1200,
    height = 1200,
    quality = 80,
    format = 'jpeg',
    fit = 'inside',
  } = options;

  const ext = path.extname(filePath);
  const outputPath = filePath.replace(ext, `.processed.${format}`);

  try {
    await sharp(filePath)
      .resize(width, height, { fit, withoutEnlargement: true })
      .toFormat(format, { quality })
      .toFile(outputPath);

    // Remove original
    fs.unlinkSync(filePath);
    
    // Rename processed to original name
    const finalPath = filePath.replace(ext, `.${format}`);
    fs.renameSync(outputPath, finalPath);

    return finalPath;
  } catch (error) {
    logger.logError(error, null, { filePath, options });
    throw error;
  }
}

// Generate thumbnail
export async function generateThumbnail(filePath, size = 200) {
  const ext = path.extname(filePath);
  const basename = path.basename(filePath, ext);
  const dirname = path.dirname(filePath);
  const thumbPath = path.join(dirname, `${basename}_thumb${ext}`);

  try {
    await sharp(filePath)
      .resize(size, size, { fit: 'cover' })
      .toFile(thumbPath);

    return thumbPath;
  } catch (error) {
    logger.logError(error, null, { filePath, size });
    throw error;
  }
}

// Delete file
export function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info('File deleted', { filePath });
      return true;
    }
    return false;
  } catch (error) {
    logger.logError(error, null, { filePath });
    throw error;
  }
}

// Get file URL (for serving)
export function getFileUrl(filePath, companyId) {
  const relativePath = filePath.replace(UPLOAD_DIR, '').replace(/\\/g, '/');
  return `/uploads${relativePath}`;
}

// File info
export function getFileInfo(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return {
      name: path.basename(filePath),
      path: filePath,
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      extension: path.extname(filePath).toLowerCase(),
    };
  } catch (error) {
    return null;
  }
}

// Middleware to set upload subdirectory
export function setUploadSubdir(subdir) {
  return (req, res, next) => {
    req.uploadSubdir = subdir;
    next();
  };
}

// Error handling middleware for multer
export function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: 'File too large', 
        maxSize: `${MAX_FILE_SIZE / 1024 / 1024}MB` 
      });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
}

export default {
  upload,
  processImage,
  generateThumbnail,
  deleteFile,
  getFileUrl,
  getFileInfo,
  setUploadSubdir,
  handleUploadError,
  UPLOAD_DIR,
  MAX_FILE_SIZE,
  ALLOWED_MIMES,
};
