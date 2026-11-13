import React from 'react';
import { Package, Eye } from 'lucide-react';
import { Product } from '../../types';
import { getMainProductImageUrl, getProductGalleryImages } from '../../utils/imageUtils';

interface ProductThumbnailProps {
  product?: Product | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onClick?: () => void;
  showBadge?: boolean;
  altText?: string;
}

export const ProductThumbnail: React.FC<ProductThumbnailProps> = ({
  product,
  size = 'md',
  className = '',
  onClick,
  showBadge = true,
  altText,
}) => {
  const mainImage = getMainProductImageUrl(product);
  const gallery = getProductGalleryImages(product);
  const imageCount = gallery.length;

  const sizeClasses = {
    xs: 'w-7 h-7 min-w-[28px]',
    sm: 'w-9 h-9 min-w-[36px]',
    md: 'w-11 h-11 min-w-[44px]',
    lg: 'w-14 h-14 min-w-[56px]',
    xl: 'w-20 h-20 min-w-[80px]',
  }[size];

  const iconSizes = {
    xs: 'w-3.5 h-3.5',
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
    xl: 'w-8 h-8',
  }[size];

  // If no image exists, render the professional default placeholder (NO broken image)
  if (!mainImage) {
    return (
      <div
        className={`relative ${sizeClasses} rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 shrink-0 select-none ${className}`}
        title={product?.name || 'Product'}
      >
        <Package className={`${iconSizes} opacity-60 text-slate-500`} />
      </div>
    );
  }

  const isClickable = !!onClick || imageCount > 0;

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      className={`relative ${sizeClasses} rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shrink-0 group ${
        isClickable ? 'cursor-pointer hover:border-blue-500/60 hover:shadow-md transition-all' : ''
      } ${className}`}
      title={isClickable ? `Click to view product image gallery (${imageCount} photo${imageCount > 1 ? 's' : ''})` : product?.name}
    >
      <img
        src={mainImage}
        alt={altText || product?.name || 'Product'}
        referrerPolicy="no-referrer"
        loading="lazy"
        className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-200"
      />

      {/* Hover visual overlay */}
      {isClickable && (
        <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
          <Eye className="w-3.5 h-3.5 text-white drop-shadow" />
        </div>
      )}

      {/* Subtle indicator for multiple images (2 or 3) */}
      {showBadge && imageCount > 1 && (
        <span className="absolute bottom-0.5 right-0.5 px-1 py-0.2 rounded-md bg-slate-950/80 backdrop-blur-xs text-[9px] font-mono font-bold text-white border border-slate-700/50 leading-none">
          {imageCount}
        </span>
      )}
    </div>
  );
};
