// File storage — shared implementation (packages/tenant-backend/src/files/storage.ts), vendored into
// this tenant as ../shared at generation: a PRIVATE per-tenant R2 bucket, streamed back only through
// authenticated company-scoped routes.
//
// Roof already had services/storage.ts, but that is the low-level R2 client (uploadFile/getObject by
// key) used by job photos and the media route. Documents needs the higher-level surface — saveFile,
// thumbnails, size and MIME limits — which is the same one every other template uses. Both sit on the
// same bucket; this adds the layer roof was missing, it does not replace anything.
import { createFileStorage } from '../shared/index.ts'

const storage = createFileStorage()
export const { saveFile, saveFiles, processImage, generateThumbnail, deleteFile, getFileUrl, getObject, storageConfigured, MAX_FILE_SIZE, ALLOWED_MIMES } = storage
export default storage
