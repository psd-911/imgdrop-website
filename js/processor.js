/**
 * ImgDrop Web - High Performance Client-Side Image Processing Engine
 * 100% In-Browser Canvas API processing. Zero server upload.
 */

export class ImageProcessor {
  /**
   * Process a single File or Blob according to specified options
   * @param {File|Blob|string} imageInput
   * @param {Object} options
   * @returns {Promise<Object>} Processed result containing blob, url, dimensions, sizes
   */
  static async process(imageInput, options = {}) {
    const format = options.format || 'image/jpeg';
    let quality = options.quality !== undefined ? parseFloat(options.quality) : 0.85;
    const preserveAspect = options.preserveAspect !== false;
    const rotation = options.rotation || 0;
    const flipH = !!options.flipH;
    const flipV = !!options.flipV;
    const crop = options.crop || null; // { x, y, width, height }
    const targetSizeKB = options.targetSizeKB ? parseFloat(options.targetSizeKB) : null;

    // Load source into HTMLImageElement
    const img = await this._loadImage(imageInput);
    const origWidth = img.naturalWidth || img.width;
    const origHeight = img.naturalHeight || img.height;
    const origSize = imageInput instanceof Blob ? imageInput.size : 0;

    // Calculate crop source bounds
    let srcX = 0;
    let srcY = 0;
    let srcW = origWidth;
    let srcH = origHeight;

    if (crop && crop.width > 0 && crop.height > 0) {
      srcX = Math.max(0, Math.min(crop.x, origWidth));
      srcY = Math.max(0, Math.min(crop.y, origHeight));
      srcW = Math.max(1, Math.min(crop.width, origWidth - srcX));
      srcH = Math.max(1, Math.min(crop.height, origHeight - srcY));
    }

    // Calculate target output dimensions
    let outW = srcW;
    let outH = srcH;

    if (options.width || options.height) {
      if (options.width && options.height) {
        if (preserveAspect) {
          const scale = Math.min(options.width / srcW, options.height / srcH);
          outW = Math.round(srcW * scale);
          outH = Math.round(srcH * scale);
        } else {
          outW = Math.round(options.width);
          outH = Math.round(options.height);
        }
      } else if (options.width) {
        outW = Math.round(options.width);
        outH = preserveAspect ? Math.round((srcH / srcW) * outW) : srcH;
      } else if (options.height) {
        outH = Math.round(options.height);
        outW = preserveAspect ? Math.round((srcW / srcH) * outH) : srcW;
      }
    } else if (options.scale && options.scale !== 1.0) {
      outW = Math.round(srcW * options.scale);
      outH = Math.round(srcH * options.scale);
    }

    outW = Math.max(1, outW);
    outH = Math.max(1, outH);

    // Canvas orientation setup
    const isSideways = (rotation % 180 !== 0);
    const canvas = document.createElement('canvas');
    canvas.width = isSideways ? outH : outW;
    canvas.height = isSideways ? outW : outH;

    const ctx = canvas.getContext('2d', { alpha: format === 'image/png' || format === 'image/webp' });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Apply rotation & flip transforms
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (rotation !== 0) {
      ctx.rotate((rotation * Math.PI) / 180);
    }
    if (flipH || flipV) {
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    }

    // Fill white background for JPEG exports with transparent inputs
    if (format === 'image/jpeg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(-outW / 2, -outH / 2, outW, outH);
    }

    ctx.drawImage(img, srcX, srcY, srcW, srcH, -outW / 2, -outH / 2, outW, outH);
    ctx.restore();

    // Compression Handling
    let finalBlob;
    if (targetSizeKB && targetSizeKB > 0 && (format === 'image/jpeg' || format === 'image/webp')) {
      finalBlob = await this._compressToTargetSize(canvas, format, targetSizeKB);
    } else {
      finalBlob = await this._canvasToBlob(canvas, format, quality);
    }

    const blobUrl = URL.createObjectURL(finalBlob);
    const filename = this._generateFilename(imageInput.name || 'image', format, options.filenamePattern);

    return {
      blob: finalBlob,
      blobUrl: blobUrl,
      filename: filename,
      width: canvas.width,
      height: canvas.height,
      origSize: origSize,
      size: finalBlob.size,
      format: format,
      reductionPercent: origSize > 0 ? Math.round(((origSize - finalBlob.size) / origSize) * 100) : 0
    };
  }

  /**
   * Helper: Binary search compression to strictly stay under target max file size (in KB)
   */
  static async _compressToTargetSize(canvas, format, targetKB) {
    // 0.5% safety threshold ensures displayed size never rounds over targetKB
    const targetBytes = Math.floor(targetKB * 1024 * 0.995);
    let minQ = 0.01;
    let maxQ = 0.99;
    let bestFittingBlob = null;

    // 8 binary search iterations gives ~0.39% quality precision
    for (let i = 0; i < 8; i++) {
      const midQ = (minQ + maxQ) / 2;
      const blob = await this._canvasToBlob(canvas, format, midQ);

      if (blob.size <= targetBytes) {
        // Fits under target limit! Save candidate and try higher quality
        bestFittingBlob = blob;
        minQ = midQ;
      } else {
        // Exceeded limit: must reduce quality
        maxQ = midQ;
      }
    }

    if (bestFittingBlob) {
      return bestFittingBlob;
    }

    // If lowest quality still exceeds target size, scale down dimensions
    let scale = 0.9;
    while (scale >= 0.1) {
      const scaledCanvas = document.createElement('canvas');
      scaledCanvas.width = Math.max(1, Math.round(canvas.width * scale));
      scaledCanvas.height = Math.max(1, Math.round(canvas.height * scale));
      const ctx = scaledCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (format === 'image/jpeg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, scaledCanvas.width, scaledCanvas.height);
      }
      ctx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);

      let sMinQ = 0.1;
      let sMaxQ = 0.95;
      let sFittingBlob = null;

      for (let j = 0; j < 6; j++) {
        const sMidQ = (sMinQ + sMaxQ) / 2;
        const blob = await this._canvasToBlob(scaledCanvas, format, sMidQ);
        if (blob.size <= targetBytes) {
          sFittingBlob = blob;
          sMinQ = sMidQ;
        } else {
          sMaxQ = sMidQ;
        }
      }

      if (sFittingBlob) {
        return sFittingBlob;
      }

      scale -= 0.15;
    }

    // Absolute fallback: minimal quality
    return await this._canvasToBlob(canvas, format, 0.01);
  }

  static _canvasToBlob(canvas, format, quality) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob || new Blob([], { type: format }));
      }, format, quality);
    });
  }

  static _loadImage(input) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      if (input instanceof File || input instanceof Blob) {
        const url = URL.createObjectURL(input);
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        img.onerror = (e) => {
          URL.revokeObjectURL(url);
          reject(new Error('Failed to load image file'));
        };
        img.src = url;
      } else if (typeof input === 'string') {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image from URL'));
        img.src = input;
      } else {
        reject(new Error('Unsupported image input'));
      }
    });
  }

  static _generateFilename(originalName, format, pattern = '{name}_imgdrop') {
    const base = originalName.replace(/\.[^/.]+$/, '');
    const extMap = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/avif': 'avif',
      'application/pdf': 'pdf'
    };
    const ext = extMap[format] || 'jpg';

    if (!pattern || pattern.trim() === '') {
      return `${base}.${ext}`;
    }

    let result = pattern
      .replace('{name}', base)
      .replace('{format}', ext)
      .replace('{ext}', ext);

    if (!result.endsWith(`.${ext}`)) {
      result += `.${ext}`;
    }
    return result;
  }

  static formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
}
