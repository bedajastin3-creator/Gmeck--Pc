import React, { useState, useRef, useCallback } from 'react';
import {
  Upload,
  Plus,
  Trash2,
  RefreshCw,
  Star,
  Image as ImageIcon,
  AlertCircle,
  Camera,
  Check,
  MoveLeft,
  MoveRight,
  X,
  SwitchCamera,
  Zap,
} from 'lucide-react';
import { ProductImage } from '../../types';
import {
  MAX_PRODUCT_IMAGES,
  validateImageFile,
  processAndCompressImage,
  normalizeProductImages,
} from '../../utils/imageUtils';

interface ProductImageUploadProps {
  images: ProductImage[];
  onChange: (images: ProductImage[]) => void;
  productId?: string;
  disabled?: boolean;
}

export const ProductImageUpload: React.FC<ProductImageUploadProps> = ({
  images,
  onChange,
  productId,
  disabled = false,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);

  // Camera state
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const count = images.length;
  const canAddMore = count < MAX_PRODUCT_IMAGES;

  // Cleanup camera on unmount
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
    setIsCameraReady(false);
  }, []);

  React.useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const startCamera = async () => {
    setErrorMessage(null);
    setCameraError(null);
    
    if (!canAddMore) {
      setErrorMessage('Maximum of 3 images allowed for each product.');
      return;
    }

    try {
      // Check if browser supports getUserMedia
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        // Fallback to mobile-style file input for older browsers
        cameraInputRef.current?.click();
        return;
      }

      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setIsCameraOpen(true);

      // Wait for video to be ready
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setIsCameraReady(true);
        }
      }, 100);
    } catch (err: any) {
      console.error('Camera error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('Camera permission denied. Please allow camera access in your browser settings.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError('No camera found on this device. You can upload from gallery instead.');
      } else if (err.name === 'NotReadableError') {
        setCameraError('Camera is already in use by another application.');
      } else {
        setCameraError(`Camera error: ${err.message}`);
      }
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Set canvas size to match video
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert to data URL
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    // Convert data URL to File
    const blob = dataURLtoBlob(dataUrl);
    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });

    // Process the captured image
    processCapturedImage(file);

    // Stop camera
    stopCamera();
  };

  const dataURLtoBlob = (dataUrl: string): Blob => {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const binary = atob(parts[1]);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      array[i] = binary.charCodeAt(i);
    }
    return new Blob([array], { type: mime });
  };

  const switchCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
    // Restart camera with new facing mode
    stopCamera();
    setTimeout(() => {
      startCamera();
    }, 300);
  };

  const processCapturedImage = async (file: File) => {
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const validation = validateImageFile(file);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid image file.');
      }

      const newOrder = images.length;
      const processed = await processAndCompressImage(file, productId, newOrder);
      
      const updated = normalizeProductImages([...images, processed]);
      onChange(updated);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to process camera image.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTriggerUpload = () => {
    setErrorMessage(null);
    if (!canAddMore) {
      setErrorMessage('Maximum of 3 images allowed for each product.');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleTriggerReplace = (index: number) => {
    setErrorMessage(null);
    setReplaceIndex(index);
    replaceFileInputRef.current?.click();
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setErrorMessage(null);

    const availableSlots = MAX_PRODUCT_IMAGES - images.length;
    if (files.length > availableSlots) {
      setErrorMessage('Maximum of 3 images allowed for each product.');
    }

    const filesToProcess: File[] = (Array.from(files) as File[]).slice(0, availableSlots);
    if (filesToProcess.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsProcessing(true);

    try {
      const processedList: ProductImage[] = [];

      for (let i = 0; i < filesToProcess.length; i++) {
        const file = filesToProcess[i];
        const validation = validateImageFile(file);
        if (!validation.valid) {
          throw new Error(validation.error || 'Invalid image file.');
        }

        const newOrder = images.length + processedList.length;
        const processed = await processAndCompressImage(file, productId, newOrder);
        processedList.push(processed);
      }

      const updated = normalizeProductImages([...images, ...processedList]);
      onChange(updated);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to process image.');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || replaceIndex === null) return;

    setErrorMessage(null);
    setIsProcessing(true);

    try {
      const validation = validateImageFile(file);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid image file.');
      }

      const processed = await processAndCompressImage(file, productId, replaceIndex);
      const oldImg = images[replaceIndex];
      processed.version = (oldImg?.version || 1) + 1;
      processed.syncStatus = 'MODIFIED_LOCALLY';

      const updated = [...images];
      updated[replaceIndex] = processed;
      onChange(normalizeProductImages(updated));
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to replace image.');
    } finally {
      setIsProcessing(false);
      setReplaceIndex(null);
      if (replaceFileInputRef.current) replaceFileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = (indexToRemove: number) => {
    setErrorMessage(null);
    const updated = images.filter((_, idx) => idx !== indexToRemove);
    onChange(normalizeProductImages(updated));
  };

  const handleSetAsMain = (indexToPromote: number) => {
    if (indexToPromote === 0 || indexToPromote >= images.length) return;
    const target = images[indexToPromote];
    const rest = images.filter((_, idx) => idx !== indexToPromote);
    const reordered = [target, ...rest];
    onChange(normalizeProductImages(reordered));
  };

  const handleMove = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= images.length) return;
    const item = images[fromIndex];
    const updated = [...images];
    updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, item);
    onChange(normalizeProductImages(updated));
  };

  return (
    <div id="product-images-section" className="space-y-2.5">
      {/* Header Label */}
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-slate-300 font-semibold text-xs flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-blue-400" />
            <span>Product Images (Optional)</span>
          </label>
          <p className="text-[11px] text-slate-400 mt-0.5">
            You can add up to 3 images. Image 1 is automatically the Main Thumbnail.
          </p>
        </div>

        <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700/60 text-[10px] font-mono text-slate-300">
          {count} / {MAX_PRODUCT_IMAGES} images
        </span>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={handleFilesSelected}
        disabled={disabled || isProcessing}
      />
      <input
        ref={replaceFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleReplaceFile}
        disabled={disabled || isProcessing}
      />
      {/* Hidden canvas for capturing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Camera Modal */}
      {isCameraOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl">
            {/* Camera Header */}
            <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-2 text-white">
                <Camera className="w-5 h-5 text-emerald-400" />
                <span className="text-sm font-bold">Take Photo</span>
              </div>
              <button
                onClick={stopCamera}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Camera Error Display */}
            {cameraError && (
              <div className="p-4 text-center">
                <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
                <p className="text-xs text-rose-300">{cameraError}</p>
                <button
                  onClick={stopCamera}
                  className="mt-3 px-4 py-2 rounded-lg bg-slate-800 text-white text-xs"
                >
                  Close
                </button>
              </div>
            )}

            {/* Video Preview */}
            {!cameraError && (
              <div className="relative bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-[400px] object-cover"
                />
                
                {/* Camera Ready Indicator */}
                {!isCameraReady && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <RefreshCw className="w-8 h-8 text-white animate-spin" />
                  </div>
                )}
              </div>
            )}

            {/* Camera Controls */}
            {isCameraReady && !cameraError && (
              <div className="flex items-center justify-between p-4 bg-slate-950">
                {/* Switch Camera */}
                <button
                  onClick={switchCamera}
                  className="p-3 rounded-full bg-slate-800 hover:bg-slate-700 text-white transition"
                  title="Switch Camera"
                >
                  <SwitchCamera className="w-5 h-5" />
                </button>

                {/* Capture Button */}
                <button
                  onClick={capturePhoto}
                  className="w-16 h-16 rounded-full bg-white hover:bg-slate-200 flex items-center justify-center shadow-lg transition"
                  title="Capture Photo"
                >
                  <div className="w-12 h-12 rounded-full border-4 border-slate-900 bg-white" />
                </button>

                {/* Close Button */}
                <button
                  onClick={stopCamera}
                  className="p-3 rounded-full bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white transition"
                  title="Close Camera"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Uploaded Images Grid */}
      <div className="grid grid-cols-3 gap-3">
        {/* Existing images */}
        {images.map((img, index) => {
          const isMain = index === 0;
          return (
            <div
              key={img.imageId || index}
              className={`relative bg-slate-950 border rounded-xl overflow-hidden flex flex-col group transition-all ${
                isMain ? 'border-blue-500/80 shadow-md ring-1 ring-blue-500/30' : 'border-slate-800'
              }`}
            >
              <div className="relative h-28 w-full bg-slate-900 overflow-hidden flex items-center justify-center">
                <img
                  src={img.thumbnailUrl || img.dataUrl}
                  alt={`Product Image ${index + 1}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                />

                <div className="absolute top-1.5 left-1.5">
                  {isMain ? (
                    <span className="px-1.5 py-0.5 rounded-md bg-blue-600/90 text-white text-[9px] font-bold tracking-wider flex items-center gap-1 shadow">
                      <Star className="w-2.5 h-2.5 fill-current" />
                      <span>MAIN</span>
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded-md bg-slate-900/80 backdrop-blur-sm text-slate-300 text-[9px] font-mono border border-slate-700/60">
                      #{index + 1}
                    </span>
                  )}
                </div>

                <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1.5 transition-opacity p-2">
                  <button
                    type="button"
                    onClick={() => handleTriggerReplace(index)}
                    disabled={disabled || isProcessing}
                    title="Replace this image"
                    className="p-1.5 rounded-lg bg-slate-800/90 hover:bg-blue-600 text-white text-xs transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(index)}
                    disabled={disabled || isProcessing}
                    title="Remove this image"
                    className="p-1.5 rounded-lg bg-slate-800/90 hover:bg-rose-600 text-white text-xs transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="p-1.5 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-[10px]">
                {!isMain ? (
                  <button
                    type="button"
                    onClick={() => handleSetAsMain(index)}
                    className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-0.5 hover:underline"
                  >
                    <Star className="w-2.5 h-2.5" />
                    <span>Set Main</span>
                  </button>
                ) : (
                  <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
                    <Check className="w-2.5 h-2.5" />
                    <span>Main Image</span>
                  </span>
                )}

                <div className="flex items-center gap-0.5">
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => handleMove(index, index - 1)}
                      title="Move Left"
                      className="p-1 text-slate-400 hover:text-white"
                    >
                      <MoveLeft className="w-3 h-3" />
                    </button>
                  )}
                  {index < images.length - 1 && (
                    <button
                      type="button"
                      onClick={() => handleMove(index, index + 1)}
                      title="Move Right"
                      className="p-1 text-slate-400 hover:text-white"
                    >
                      <MoveRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Add Image Slots */}
        {canAddMore && (
          <>
            {/* Gallery Upload Button */}
            <button
              type="button"
              onClick={handleTriggerUpload}
              disabled={disabled || isProcessing}
              className="h-36 rounded-xl border-2 border-dashed border-slate-700/80 hover:border-blue-500/60 bg-slate-950/40 hover:bg-slate-900/60 flex flex-col items-center justify-center gap-1.5 p-3 text-slate-400 hover:text-blue-300 transition-all cursor-pointer group"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" />
                  <span className="text-[11px] font-medium text-slate-300">Processing...</span>
                </>
              ) : (
                <>
                  <div className="w-8 h-8 rounded-full bg-slate-800 group-hover:bg-blue-600/20 text-slate-300 group-hover:text-blue-400 flex items-center justify-center transition">
                    <Upload className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-semibold text-slate-300 group-hover:text-white">
                    Upload
                  </span>
                  <span className="text-[10px] text-slate-500">Gallery</span>
                </>
              )}
            </button>

            {/* Camera Button */}
            <button
              type="button"
              onClick={startCamera}
              disabled={disabled || isProcessing}
              className="h-36 rounded-xl border-2 border-dashed border-emerald-700/80 hover:border-emerald-500/60 bg-emerald-950/20 hover:bg-emerald-900/40 flex flex-col items-center justify-center gap-1.5 p-3 text-emerald-400 hover:text-emerald-300 transition-all cursor-pointer group"
            >
              <div className="w-8 h-8 rounded-full bg-emerald-900/50 group-hover:bg-emerald-600/20 text-emerald-400 flex items-center justify-center transition">
                <Camera className="w-4 h-4" />
              </div>
              <span className="text-xs font-semibold text-emerald-300 group-hover:text-white">
                Camera
              </span>
              <span className="text-[10px] text-emerald-600">Take Photo</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
