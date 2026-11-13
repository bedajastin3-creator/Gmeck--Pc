import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Package,
  ZoomIn,
  Store,
  Tag,
  Maximize2,
} from 'lucide-react';
import { Product, ProductImage } from '../../types';
import { getProductGalleryImages } from '../../utils/imageUtils';
import { formatCurrency } from '../../utils/formatters';

interface ProductImageViewerModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  initialIndex?: number;
  currencySymbol?: string;
}

export const ProductImageViewerModal: React.FC<ProductImageViewerModalProps> = ({
  product,
  isOpen,
  onClose,
  initialIndex = 0,
  currencySymbol = 'TSh',
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isZoomed, setIsZoomed] = useState(false);

  const images: ProductImage[] = product ? getProductGalleryImages(product) : [];
  const totalImages = images.length;

  useEffect(() => {
    setCurrentIndex(initialIndex);
    setIsZoomed(false);
  }, [initialIndex, product, isOpen]);

  const handleNext = useCallback(() => {
    if (totalImages <= 1) return;
    setCurrentIndex(prev => (prev + 1) % totalImages);
  }, [totalImages]);

  const handlePrev = useCallback(() => {
    if (totalImages <= 1) return;
    setCurrentIndex(prev => (prev - 1 + totalImages) % totalImages);
  }, [totalImages]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleNext, handlePrev, onClose]);

  if (!isOpen || !product) return null;

  const currentImage = images[currentIndex] || images[0];

  return (
    <div
      id="product-image-viewer-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full flex flex-col shadow-2xl overflow-hidden max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="p-2 rounded-lg bg-blue-600/15 border border-blue-500/20 text-blue-400 shrink-0">
              <Package className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">{product.name}</h3>
              <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-0.5">
                <span>SKU: {product.sku}</span>
                <span>•</span>
                <span className="text-emerald-400 font-semibold">
                  {formatCurrency(product.sellingPrice, currencySymbol)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Image counter indicator (1 / 1, 1 / 2, 1 / 3) */}
            {totalImages > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700/80 text-xs font-mono font-semibold text-slate-200 shadow-inner">
                {currentIndex + 1} / {totalImages}
              </span>
            )}

            <button
              id="close-image-viewer-btn"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Close viewer (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Main Image Display Area (One Image at a Time) */}
        <div className="relative flex-1 min-h-[320px] max-h-[62vh] flex items-center justify-center p-4 bg-slate-950/60 select-none overflow-hidden">
          {currentImage ? (
            <div className="relative max-w-full max-h-full flex items-center justify-center">
              <img
                src={currentImage.dataUrl || currentImage.thumbnailUrl}
                alt={`${product.name} - Image ${currentIndex + 1}`}
                referrerPolicy="no-referrer"
                className={`max-w-full max-h-[56vh] object-contain rounded-lg shadow-xl transition-transform duration-200 ${
                  isZoomed ? 'scale-125 cursor-zoom-out' : 'cursor-zoom-in'
                }`}
                onClick={() => setIsZoomed(!isZoomed)}
              />

              {/* Order Label badge */}
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-slate-950/80 backdrop-blur-sm border border-slate-700/60 text-[10px] font-semibold text-slate-300">
                {currentIndex === 0 ? '★ Main Image (Picha Kuu)' : `Image ${currentIndex + 1}`}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-500 py-12">
              <Package className="w-16 h-16 mb-2 opacity-30 text-slate-400" />
              <p className="text-sm font-medium">No product image available</p>
              <p className="text-xs text-slate-600 mt-1">Default placeholder is active</p>
            </div>
          )}

          {/* Left / Previous Arrow (only if 2 or 3 images) */}
          {totalImages > 1 && (
            <button
              id="prev-image-btn"
              onClick={handlePrev}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-slate-900/90 hover:bg-blue-600 text-white border border-slate-700/80 shadow-xl transition-all hover:scale-110 active:scale-95"
              title="Previous image (Left Arrow)"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}

          {/* Right / Next Arrow (only if 2 or 3 images) */}
          {totalImages > 1 && (
            <button
              id="next-image-btn"
              onClick={handleNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-slate-900/90 hover:bg-blue-600 text-white border border-slate-700/80 shadow-xl transition-all hover:scale-110 active:scale-95"
              title="Next image (Right Arrow)"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Thumbnail Selector Strip (if 2 or 3 images) */}
        {totalImages > 1 && (
          <div className="px-4 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-center gap-3">
            {images.map((img, idx) => (
              <button
                key={img.imageId || idx}
                onClick={() => {
                  setCurrentIndex(idx);
                  setIsZoomed(false);
                }}
                className={`relative w-14 h-14 rounded-xl overflow-hidden border-2 transition-all ${
                  currentIndex === idx
                    ? 'border-blue-500 ring-2 ring-blue-500/30 scale-105 shadow-md'
                    : 'border-slate-800 opacity-60 hover:opacity-100 hover:border-slate-600'
                }`}
              >
                <img
                  src={img.thumbnailUrl || img.dataUrl}
                  alt={`Thumbnail ${idx + 1}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-0.5 right-0.5 px-1 bg-slate-950/90 rounded text-[9px] font-mono text-white">
                  {idx + 1}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Footer info */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <span>
              Stock: <strong className="text-white font-mono">{product.currentStock} {product.unit}</strong>
            </span>
            <span>•</span>
            <span>
              Status:{' '}
              <strong className={product.status === 'ACTIVE' ? 'text-emerald-400' : 'text-rose-400'}>
                {product.status}
              </strong>
            </span>
          </div>

          <div className="text-[11px] text-slate-500">
            {totalImages > 1 ? 'Use ‹ Left and Right › arrows to switch photos' : 'Stored locally for offline viewing'}
          </div>
        </div>
      </div>
    </div>
  );
};
