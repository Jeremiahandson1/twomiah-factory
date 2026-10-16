// A visit photo as the server takes it: a JPEG data URI, downscaled to 1600px at ~82%, at most
// ~5 MB (POST /api/time-entries/:id/photos refuses more). One helper for the clock-out sheet and the
// mid-visit photo button, so both send the same thing.
export const PHOTO_MAX_INPUT = 15_000_000;
export const PHOTO_MAX_BYTES = 5_000_000;

export async function compressPhoto(file: File): Promise<{ dataUri: string; sizeBytes: number }> {
  if (!file) throw new Error('Pick a photo');
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file');
  if (file.size > PHOTO_MAX_INPUT) throw new Error('Photo too large (15MB max)');
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That photo could not be read'));
    reader.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('That photo could not be read')); img.src = dataUrl; });
  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUri = canvas.toDataURL('image/jpeg', 0.82);
  const sizeBytes = Math.floor(dataUri.length * 0.75);
  if (sizeBytes > PHOTO_MAX_BYTES) throw new Error('Photo too large after compression');
  return { dataUri, sizeBytes };
}
