import { dataUrlToParts } from './encoding';

export interface PreparedImage {
  id: string;
  base64: string;
  mime: string;
  alt: string;
  width: number;
  height: number;
  /** Object URL for the in-popup thumbnail; revoke when discarded. */
  previewUrl: string;
}

export const MAX_IMAGES = 4;

/** Bluesky rejects blobs over ~976 KB; stay safely under. */
const MAX_BYTES = 950_000;
const MAX_DIMENSION = 2000;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const JPEG_QUALITY_STEPS = [0.9, 0.8, 0.7, 0.55];

export const IMAGE_INPUT_ACCEPT = ACCEPTED_TYPES.join(',');

/**
 * Validate, downscale, and compress an image until it fits Bluesky's blob
 * limit. Small files pass through untouched (which also preserves GIF
 * animation); large ones are re-encoded as JPEG.
 */
export async function prepareImage(file: File | Blob): Promise<PreparedImage> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('Only JPEG, PNG, WebP, and GIF images are supported.');
  }

  if (file.size <= MAX_BYTES) {
    const { width, height } = await readDimensions(file);
    return toPrepared(file, file.type, width, height);
  }

  if (file.type === 'image/gif') {
    throw new Error('GIFs over 950 KB can’t be posted. Try a smaller one.');
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process this image.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  for (const quality of JPEG_QUALITY_STEPS) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (blob.size <= MAX_BYTES) {
      return toPrepared(blob, 'image/jpeg', canvas.width, canvas.height);
    }
  }
  throw new Error('Could not compress this image under Bluesky’s 1 MB limit.');
}

export function releaseImage(_image: PreparedImage): void {
  // Data URLs don't need revocation; kept for API stability.
}

async function readDimensions(file: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode this image.'))),
      type,
      quality,
    );
  });
}

async function toPrepared(
  blob: Blob,
  mime: string,
  width: number,
  height: number,
): Promise<PreparedImage> {
  const dataUrl = await blobToDataUrl(blob);
  const { base64 } = dataUrlToParts(dataUrl);
  return {
    id: crypto.randomUUID(),
    base64,
    mime,
    alt: '',
    width,
    height,
    previewUrl: dataUrl,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read this image.'));
    reader.readAsDataURL(blob);
  });
}
