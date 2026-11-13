import { Product, ProductImage } from '../types';
import { generateUUID } from './crypto';

export const MAX_PRODUCT_IMAGES = 3;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB before compression

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate image file format and size
 */
export function validateImageFile(file: File): ImageValidationResult {
  if (!file) {
    return { valid: false, error: 'No file selected.' };
  }

  const mimeType = file.type?.toLowerCase();
  const fileName = file.name?.toLowerCase() || '';

  const isAllowedMime = ALLOWED_IMAGE_TYPES.includes(mimeType);
  const isAllowedExt =
    fileName.endsWith('.jpg') ||
    fileName.endsWith('.jpeg') ||
    fileName.endsWith('.png') ||
    fileName.endsWith('.webp');

  if (!isAllowedMime && !isAllowedExt) {
    return {
      valid: false,
      error: `Unsupported image format (${file.type || 'unknown'}). Supported formats: JPG, PNG, WebP.`,
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `Image file is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum allowed is 10MB.`,
    };
  }

  return { valid: true };
}

/**
 * Deterministic hash generator for image sync versioning
 */
export function computeImageChecksum(data: string, fileName?: string, size?: number): string {
  let hash = 0;
  const sample = `${fileName || 'img'}_${size || 0}_${data.slice(0, 100)}_${data.slice(-100)}_${data.length}`;
  for (let i = 0; i < sample.length; i++) {
    const char = sample.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `hash_${Math.abs(hash).toString(16)}_${data.length}`;
}

/**
 * Resize and compress an image file to both a gallery-size dataUrl and an ultra-fast thumbnail dataUrl.
 */
export async function processAndCompressImage(
  file: File,
  productId?: string,
  imageOrder: number = 0
): Promise<ProductImage> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = e => {
      const srcUrl = e.target?.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to decode image data.'));
      img.onload = () => {
        try {
          const originalWidth = img.width;
          const originalHeight = img.height;

          // 1. Generate Gallery View Image (Max 1200px dimension, high crispness, optimized)
          const maxGalleryDim = 1200;
          let gWidth = originalWidth;
          let gHeight = originalHeight;

          if (gWidth > maxGalleryDim || gHeight > maxGalleryDim) {
            if (gWidth > gHeight) {
              gHeight = Math.round((gHeight * maxGalleryDim) / gWidth);
              gWidth = maxGalleryDim;
            } else {
              gWidth = Math.round((gWidth * maxGalleryDim) / gHeight);
              gHeight = maxGalleryDim;
            }
          }

          const galleryCanvas = document.createElement('canvas');
          galleryCanvas.width = gWidth;
          galleryCanvas.height = gHeight;
          const gCtx = galleryCanvas.getContext('2d');
          if (!gCtx) throw new Error('Canvas context not available.');

          // High quality image rendering
          gCtx.imageSmoothingEnabled = true;
          gCtx.imageSmoothingQuality = 'high';
          gCtx.drawImage(img, 0, 0, gWidth, gHeight);

          // Export gallery image as JPEG/WebP
          const galleryMime = file.type === 'image/png' ? 'image/jpeg' : (file.type || 'image/jpeg');
          const galleryDataUrl = galleryCanvas.toDataURL(galleryMime, 0.85);

          // 2. Generate Ultra-Fast Thumbnail (Max 160px for compact tables & POS cards)
          const maxThumbDim = 160;
          let tWidth = originalWidth;
          let tHeight = originalHeight;

          if (tWidth > maxThumbDim || tHeight > maxThumbDim) {
            if (tWidth > tHeight) {
              tHeight = Math.round((tHeight * maxThumbDim) / tWidth);
              tWidth = maxThumbDim;
            } else {
              tWidth = Math.round((tWidth * maxThumbDim) / tHeight);
              tHeight = maxThumbDim;
            }
          }

          const thumbCanvas = document.createElement('canvas');
          thumbCanvas.width = tWidth;
          thumbCanvas.height = tHeight;
          const tCtx = thumbCanvas.getContext('2d');
          if (!tCtx) throw new Error('Thumbnail canvas context not available.');

          tCtx.imageSmoothingEnabled = true;
          tCtx.imageSmoothingQuality = 'medium';
          tCtx.drawImage(img, 0, 0, tWidth, tHeight);

          const thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.75);

          const imageId = `img-${generateUUID()}`;
          const checksum = computeImageChecksum(galleryDataUrl, file.name, galleryDataUrl.length);
          const now = new Date().toISOString();

          const productImage: ProductImage = {
            imageId,
            productId: productId || undefined,
            imageOrder,
            version: 1,
            dataUrl: galleryDataUrl,
            thumbnailUrl: thumbDataUrl,
            filename: file.name,
            mimeType: galleryMime,
            fileSize: Math.round(galleryDataUrl.length * 0.75), // approximate byte size of base64
            width: gWidth,
            height: gHeight,
            hash: checksum,
            syncStatus: 'LOCAL_ONLY',
            createdAt: now,
            updatedAt: now,
          };

          resolve(productImage);
        } catch (err: any) {
          reject(new Error(err.message || 'Image processing failed.'));
        }
      };
      img.src = srcUrl;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Re-indexes a list of images so that imageOrder is strictly [0, 1, 2]
 * and version/metadata is kept intact.
 */
export function normalizeProductImages(images: ProductImage[]): ProductImage[] {
  return images.slice(0, MAX_PRODUCT_IMAGES).map((img, index) => ({
    ...img,
    imageOrder: index,
  }));
}

/**
 * Get the main thumbnail or dataUrl for a product safely with fallbacks.
 */
export function getMainProductImageUrl(product?: Product | null): string | undefined {
  if (!product) return undefined;
  if (product.images && product.images.length > 0) {
    const main = product.images.find(img => img.imageOrder === 0) || product.images[0];
    return main.thumbnailUrl || main.dataUrl;
  }
  return product.imageUrl;
}

/**
 * Get all available gallery images for a product.
 */
export function getProductGalleryImages(product?: Product | null): ProductImage[] {
  if (!product) return [];
  if (product.images && product.images.length > 0) {
    return [...product.images].sort((a, b) => a.imageOrder - b.imageOrder);
  }
  if (product.imageUrl) {
    return [
      {
        imageId: `legacy-${product.id}`,
        productId: product.id,
        imageOrder: 0,
        version: 1,
        dataUrl: product.imageUrl,
        thumbnailUrl: product.imageUrl,
        mimeType: 'image/jpeg',
        fileSize: 0,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      },
    ];
  }
  return [];
}
