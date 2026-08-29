/**
 * ImgDrop Web - Client-Side Multi-Page PDF Builder
 * Generates PDF documents from image blobs directly in browser.
 */

export class PDFBuilder {
  /**
   * Builds a multi-page PDF Blob from an array of image items
   * @param {Array<{blob: Blob|File, width?: number, height?: number}>} items
   * @param {Object} options - { orientation: 'auto'|'portrait'|'landscape' }
   * @returns {Promise<Blob>}
   */
  static async buildPDF(items, options = {}) {
    if (!items || items.length === 0) {
      throw new Error('No images provided for PDF generation');
    }

    const orientation = options.orientation || 'auto';
    const pages = [];

    for (const item of items) {
      const source = item.blob || item;
      const imgData = await this._loadImageData(source);
      pages.push(imgData);
    }

    return this._compileRawPDF(pages, orientation);
  }

  static _loadImageData(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        canvas.toBlob((jpegBlob) => {
          const reader = new FileReader();
          reader.onload = () => {
            URL.revokeObjectURL(url);
            resolve({
              width: canvas.width,
              height: canvas.height,
              data: new Uint8Array(reader.result)
            });
          };
          reader.onerror = reject;
          reader.readAsArrayBuffer(jpegBlob);
        }, 'image/jpeg', 0.92);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image for PDF'));
      };
      img.src = url;
    });
  }

  static _compileRawPDF(pages, defaultOrientation) {
    const objects = [];
    let offset = 0;
    const offsets = [];

    const append = (str) => {
      const enc = new TextEncoder().encode(str);
      return enc;
    };

    const chunks = [];
    const pushChunk = (uint8) => {
      chunks.push(uint8);
      offset += uint8.length;
    };

    pushChunk(append('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));

    // Obj 1: Catalog
    offsets.push(offset);
    pushChunk(append('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));

    // Obj 2: Pages container (placeholder, will know kids count)
    const pageObjStart = 3;
    const pageObjCount = pages.length;
    const kids = [];
    for (let i = 0; i < pageObjCount; i++) {
      kids.push(`${pageObjStart + i * 3} 0 R`);
    }

    offsets.push(offset);
    pushChunk(append(`2 0 obj\n<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageObjCount} >>\nendobj\n`));

    // For each page: Page Object (3+3*i), Content Stream (4+3*i), Image XObject (5+3*i)
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const pageNum = pageObjStart + i * 3;
      const contentNum = pageNum + 1;
      const imageNum = pageNum + 2;

      let pW = 595.28; // Standard A4 width in pt (72 dpi)
      let pH = 841.89; // Standard A4 height in pt

      if (defaultOrientation === 'landscape' || (defaultOrientation === 'auto' && p.width > p.height)) {
        pW = 841.89;
        pH = 595.28;
      }

      // Calculate fitted image dimensions maintaining aspect ratio inside page margins
      const margin = 20;
      const maxW = pW - margin * 2;
      const maxH = pH - margin * 2;
      const scale = Math.min(maxW / p.width, maxH / p.height);
      const drawW = p.width * scale;
      const drawH = p.height * scale;
      const drawX = (pW - drawW) / 2;
      const drawY = (pH - drawH) / 2;

      // Page Object
      offsets.push(offset);
      pushChunk(append(
        `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pW.toFixed(2)} ${pH.toFixed(2)}] /Contents ${contentNum} 0 R /Resources << /XObject << /Im${i + 1} ${imageNum} 0 R >> /ProcSet [/PDF /ImageC] >> >>\nendobj\n`
      ));

      // Content Stream
      const streamContent = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm\n/Im${i + 1} Do\nQ\n`;
      offsets.push(offset);
      pushChunk(append(
        `${contentNum} 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}endstream\nendobj\n`
      ));

      // Image XObject
      offsets.push(offset);
      const imgHeader = `${imageNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.data.length} >>\nstream\n`;
      pushChunk(append(imgHeader));
      pushChunk(p.data);
      pushChunk(append('\nendstream\nendobj\n'));
    }

    // XRef Table
    const xrefOffset = offset;
    const totalObjs = 2 + pages.length * 3;
    let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) {
      xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    pushChunk(append(xref));

    return new Blob(chunks, { type: 'application/pdf' });
  }
}
