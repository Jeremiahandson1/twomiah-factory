import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from './logger';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET = process.env.R2_BUCKET!;

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

export async function uploadFile(
  key: string,
  body: Buffer | Uint8Array | ReadableStream,
  contentType: string
): Promise<string> {
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: body as any,
        ContentType: contentType,
      })
    );
    const publicUrl = `https://${R2_BUCKET}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
    logger.info(`File uploaded to R2: ${key}`);
    return publicUrl;
  } catch (err) {
    logger.error('R2 upload failed', { error: (err as Error).message, key });
    throw err;
  }
}

export async function getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    });
    const url = await awsGetSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (err) {
    logger.error('R2 getSignedUrl failed', { error: (err as Error).message, key });
    throw err;
  }
}

export async function deleteFile(key: string): Promise<void> {
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      })
    );
    logger.info(`File deleted from R2: ${key}`);
  } catch (err) {
    logger.error('R2 delete failed', { error: (err as Error).message, key });
    throw err;
  }
}
