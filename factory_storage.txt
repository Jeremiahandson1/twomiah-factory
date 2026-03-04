/**
 * Factory Zip Storage
 *
 * Stores generated zip files in R2/S3 (production) or local disk (dev).
 * Falls back to local if S3 is not configured.
 *
 * Env vars (same as fileUpload.js):
 *   STORAGE_BACKEND=s3
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *   -- or --
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME
 */

import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import logger from '../logger.js';

const STORAGE_BACKEND = process.env.STORAGE_BACKEND || 'local';
const USE_S3 = STORAGE_BACKEND === 's3';

// ── S3/R2 client ──────────────────────────────────────────────────────────────
let s3Client = null;
let S3_BUCKET = null;

if (USE_S3) {
  const isR2 = !!process.env.R2_ACCOUNT_ID;
  if (isR2) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    S3_BUCKET = process.env.R2_BUCKET_NAME;
    logger.info('[FactoryStorage] Using Cloudflare R2', { bucket: S3_BUCKET });
  } else {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    S3_BUCKET = process.env.S3_BUCKET_NAME;
    logger.info('[FactoryStorage] Using AWS S3', { bucket: S3_BUCKET });
  }
} else {
  logger.warn('[FactoryStorage] Using LOCAL disk — zips will be lost on Render redeploy. Set STORAGE_BACKEND=s3 for production.');
}

const S3_PREFIX = 'factory-builds/';

/**
 * Upload a zip file to S3/R2 after generation.
 * Returns the S3 key (for persistent storage in DB) or the local path.
 *
 * @param {string} localZipPath  Path to the zip on disk
 * @param {string} zipName       Filename e.g. "claflin-construction-twomiah-build.zip"
 * @returns {Promise<{ storageKey: string, storageType: 's3'|'local' }>}
 */
export async function uploadZip(localZipPath, zipName) {
  if (!USE_S3 || !s3Client) {
    // Local mode — just return the path as-is
    return { storageKey: localZipPath, storageType: 'local' };
  }

  const key = `${S3_PREFIX}${zipName}`;
  const fileBuffer = fs.readFileSync(localZipPath);

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: 'application/zip',
    ContentDisposition: `attachment; filename="${zipName}"`,
  }));

  logger.info(`[FactoryStorage] Uploaded zip to S3: ${key}`);

  // Clean up local file after successful upload
  try { fs.unlinkSync(localZipPath); } catch {}

  return { storageKey: key, storageType: 's3' };
}

/**
 * Get a presigned download URL (S3) or confirm local file exists.
 * Returns null if file not found.
 *
 * @param {string} storageKey   S3 key or local path (from DB)
 * @param {string} storageType  's3' or 'local'
 * @param {number} expiresIn    Seconds until presigned URL expires (default 1 hour)
 * @returns {Promise<string|null>}
 */
export async function getZipDownloadUrl(storageKey, storageType, expiresIn = 3600) {
  if (storageType === 's3' && s3Client) {
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: storageKey });
    return getSignedUrl(s3Client, command, { expiresIn });
  }

  // Local — check it still exists
  if (fs.existsSync(storageKey)) {
    return storageKey; // caller will use res.download()
  }

  return null;
}

/**
 * Stream a zip from S3 directly to the Express response.
 * Falls back to res.download() for local files.
 */
export async function streamZipToResponse(storageKey, storageType, filename, res) {
  if (storageType === 's3' && s3Client) {
    // Generate a short-lived presigned URL and redirect to it
    const url = await getZipDownloadUrl(storageKey, storageType, 300); // 5 min
    return res.redirect(url);
  }

  // Local
  if (!fs.existsSync(storageKey)) {
    return res.status(404).json({ error: 'Build file not found. It may have expired.' });
  }

  res.download(storageKey, filename, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Download failed' });
    }
  });
}

/**
 * Delete a zip from storage (called when build record is deleted)
 */
export async function deleteZip(storageKey, storageType) {
  try {
    if (storageType === 's3' && s3Client) {
      await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: storageKey }));
      logger.info(`[FactoryStorage] Deleted S3 zip: ${storageKey}`);
    } else if (fs.existsSync(storageKey)) {
      fs.unlinkSync(storageKey);
    }
  } catch (err) {
    logger.warn(`[FactoryStorage] Failed to delete zip: ${err.message}`);
  }
}


/**
 * Download a zip from S3/R2 to a local temp path for processing.
 */
export async function downloadZip(storageKey, storageType) {
  if (storageType === 's3' && s3Client) {
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: storageKey });
    const response = await s3Client.send(command);
    const localPath = `/tmp/${path.basename(storageKey)}`;
    const chunks = [];
    for await (const chunk of response.Body) { chunks.push(chunk); }
    fs.writeFileSync(localPath, Buffer.concat(chunks));
    return localPath;
  }
  return storageKey;
}
export const factoryStorage = { uploadZip, getZipDownloadUrl, streamZipToResponse, deleteZip, downloadZip, USE_S3 };
export default factoryStorage;
