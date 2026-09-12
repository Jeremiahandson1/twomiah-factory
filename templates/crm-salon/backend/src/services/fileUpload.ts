// File storage — shared implementation (packages/tenant-backend/src/files/storage.ts), vendored into this
// tenant as ../shared at generation: a PRIVATE per-tenant R2 bucket, streamed back only through
// authenticated company-scoped routes. Same surface every caller (documents, photos, portal) used before.
import { createFileStorage } from '../shared/index.ts'

const storage = createFileStorage()
export const { saveFile, saveFiles, processImage, generateThumbnail, deleteFile, getFileUrl, getObject, storageConfigured, MAX_FILE_SIZE, ALLOWED_MIMES } = storage
export default storage
