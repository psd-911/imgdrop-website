/**
 * ImgDrop Web - Master Application Controller
 * Handles drag-and-drop, UI state, live conversions, and download actions.
 */

import { ImageProcessor } from './processor.js';
import { PDFBuilder } from './pdf-builder.js';
import { InteractiveCropper } from './cropper.js';

export class ImgDropApp {
  constructor(config = {}) {
    this.defaultMode = config.defaultMode || 'convert'; // 'convert' | 'compress' | 'resize' | 'crop' | 'pdf'
    this.currentFormat = config.defaultFormat || 'image/jpeg';
    this.currentQuality = 0.85;
    this.targetSizeKB = config.defaultTargetKb || (this.defaultMode === 'compress' ? 50 : null);
    this.currentScale = 1.0;
    this.reqWidth = null;
    this.reqHeight = null;
    this.preserveAspect = true;
    this.cropRatio = 'free';
    this.cropRect = null;
    this.rotation = 0;
    this.flipH = false;
    this.flipV = false;

    this.currentFiles = [];
    this.currentResult = null;
    this.cropperInstance = null;

    this.init();
  }

  static trackEvent(eventName, eventParams = {}) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, eventParams);
    }
  }

  init() {
    this._initTheme();
    this._initDropzone();
    this._initControls();
    this._initMarketingTracking();
  }

  _initTheme() {
    const btn = document.getElementById('themeToggleBtn');
    const saved = localStorage.getItem('imgdrop_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    if (btn) {
      btn.textContent = saved === 'dark' ? '☀️ Light' : '🌙 Dark';
      btn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('imgdrop_theme', next);
        btn.textContent = next === 'dark' ? '☀️ Light' : '🌙 Dark';
      });
    }
  }

  _initMarketingTracking() {
    document.querySelectorAll('.chrome-install-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        ImgDropApp.trackEvent('add_to_chrome_clicked', { source: window.location.pathname });
      });
    });
  }

  _initDropzone() {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');

    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.handleFilesLoaded(Array.from(e.target.files));
      }
    });

    ['dragenter', 'dragover'].forEach(name => {
      document.body.addEventListener(name, (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-active');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      document.body.addEventListener(name, (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-active');
      });
    });

    document.body.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.handleFilesLoaded(Array.from(e.dataTransfer.files));
      }
    });
  }

  async handleFilesLoaded(files) {
    this.currentFiles = files;
    ImgDropApp.trackEvent('file_uploaded', { count: files.length, type: files[0]?.type });

    const dropzone = document.getElementById('dropzone');
    const resultSection = document.getElementById('resultSection');

    if (dropzone) dropzone.classList.add('hidden');
    if (resultSection) resultSection.classList.remove('hidden');

    if (this.defaultMode === 'crop') {
      this._setupCropper(files[0]);
    } else {
      await this.processActive();
    }
  }

  _setupCropper(file) {
    const cropperSlot = document.getElementById('cropperSlot');
    const previewImg = document.getElementById('previewImg');
    if (!cropperSlot) return;

    if (previewImg) previewImg.classList.add('hidden');
    cropperSlot.classList.remove('hidden');

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (this.cropperInstance) this.cropperInstance.destroy();
      this.cropperInstance = new InteractiveCropper(cropperSlot, (rect) => {
        this.cropRect = rect;
        const wInput = document.getElementById('cropWidth');
        const hInput = document.getElementById('cropHeight');
        if (wInput) wInput.value = rect.width;
        if (hInput) hInput.value = rect.height;
        this.processActive();
      });
      this.cropperInstance.setImage(url, img.width, img.height);
      this.cropperInstance.setRatio(this.cropRatio);
    };
    img.src = url;
  }

  async processActive() {
    if (this.currentFiles.length === 0) return;

    const file = this.currentFiles[0];
    const options = {
      format: this.currentFormat,
      quality: this.currentQuality,
      targetSizeKB: this.targetSizeKB,
      scale: this.currentScale,
      width: this.reqWidth,
      height: this.reqHeight,
      preserveAspect: this.preserveAspect,
      crop: this.cropRect,
      rotation: this.rotation,
      flipH: this.flipH,
      flipV: this.flipV
    };

    if (this.defaultMode === 'pdf' && this.currentFiles.length > 0) {
      const pdfBlob = await PDFBuilder.buildPDF(this.currentFiles, { orientation: 'auto' });
      const pdfUrl = URL.createObjectURL(pdfBlob);
      this.currentResult = {
        blob: pdfBlob,
        blobUrl: pdfUrl,
        filename: 'imgdrop_document.pdf',
        size: pdfBlob.size,
        origSize: this.currentFiles.reduce((acc, f) => acc + f.size, 0)
      };
      this._updateUIResult();
      ImgDropApp.trackEvent('file_converted', { mode: 'pdf' });
      return;
    }

    try {
      this.currentResult = await ImageProcessor.process(file, options);
      this._updateUIResult();
      ImgDropApp.trackEvent('file_converted', { mode: this.defaultMode, format: this.currentFormat });
    } catch (err) {
      console.error('Processing error:', err);
    }
  }

  _updateUIResult() {
    if (!this.currentResult) return;

    const previewImg = document.getElementById('previewImg');
    const origSizeEl = document.getElementById('origSizeText');
    const outputSizeEl = document.getElementById('outputSizeText');
    const savingsBadge = document.getElementById('savingsBadge');
    const dimText = document.getElementById('dimText');

    if (previewImg && this.defaultMode !== 'crop') {
      previewImg.src = this.currentResult.blobUrl;
      previewImg.classList.remove('hidden');
    }

    if (origSizeEl) origSizeEl.textContent = ImageProcessor.formatBytes(this.currentResult.origSize);
    if (outputSizeEl) outputSizeEl.textContent = ImageProcessor.formatBytes(this.currentResult.size);
    if (dimText && this.currentResult.width) dimText.textContent = `${this.currentResult.width} × ${this.currentResult.height} px`;

    if (savingsBadge) {
      if (this.currentResult.reductionPercent > 0) {
        savingsBadge.textContent = `-${this.currentResult.reductionPercent}% Savings`;
        savingsBadge.classList.remove('hidden');
      } else {
        savingsBadge.classList.add('hidden');
      }
    }
  }

  _initControls() {
    // Format Preset Pills
    document.querySelectorAll('.format-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.format-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFormat = btn.dataset.format;
        this.processActive();
      });
    });

    // Quality Slider & Checkbox
    const qualSlider = document.getElementById('qualitySlider');
    const qualVal = document.getElementById('qualityValText');
    const qualCheckbox = document.getElementById('qualityCheckbox');
    const targetInput = document.getElementById('targetSizeInput');

    if (qualCheckbox && qualSlider) {
      // Pre-disabled by default
      qualSlider.disabled = !qualCheckbox.checked;
      qualSlider.style.opacity = qualCheckbox.checked ? '1' : '0.4';
      qualSlider.style.cursor = qualCheckbox.checked ? 'pointer' : 'not-allowed';
      if (qualVal) {
        qualVal.textContent = qualCheckbox.checked ? `${qualSlider.value}%` : 'Disabled';
        qualVal.style.color = qualCheckbox.checked ? 'var(--text-primary)' : 'var(--text-muted)';
      }

      qualCheckbox.addEventListener('change', () => {
        const isChecked = qualCheckbox.checked;
        qualSlider.disabled = !isChecked;
        qualSlider.style.opacity = isChecked ? '1' : '0.4';
        qualSlider.style.cursor = isChecked ? 'pointer' : 'not-allowed';

        if (isChecked) {
          // Manual Slider Enabled: clear Target Max File Size
          if (targetInput) targetInput.value = '';
          this.targetSizeKB = null;
          document.querySelectorAll('.target-size-preset').forEach(b => b.classList.remove('active'));

          const val = parseInt(qualSlider.value);
          this.currentQuality = val / 100;
          if (qualVal) {
            qualVal.textContent = `${val}%`;
            qualVal.style.color = 'var(--text-primary)';
          }
        } else {
          // Slider Disabled: fall back to Target Size
          if (qualVal) {
            qualVal.textContent = 'Disabled';
            qualVal.style.color = 'var(--text-muted)';
          }
          if (targetInput && (!targetInput.value || targetInput.value.trim() === '')) {
            targetInput.value = '50';
            this.targetSizeKB = 50;
          }
        }
        this.processActive();
      });
    }

    if (qualSlider) {
      qualSlider.addEventListener('input', (e) => {
        if (qualSlider.disabled) return;
        const val = parseInt(e.target.value);
        this.currentQuality = val / 100;
        if (qualVal) qualVal.textContent = `${val}%`;

        // Reset Target Max File Size when using Quality Slider
        if (targetInput) {
          targetInput.value = '';
        }
        this.targetSizeKB = null;
        document.querySelectorAll('.target-size-preset').forEach(b => b.classList.remove('active'));

        this.processActive();
      });
    }

    // Target KB Size Input
    if (targetInput) {
      if (this.targetSizeKB) {
        targetInput.value = this.targetSizeKB;
      }
      targetInput.addEventListener('input', (e) => {
        const rawVal = e.target.value.trim();
        const val = parseFloat(rawVal);
        if (val && !isNaN(val) && val > 0) {
          this.targetSizeKB = val;
          // Uncheck and disable slider when using target size
          if (qualCheckbox && qualSlider) {
            qualCheckbox.checked = false;
            qualSlider.disabled = true;
            qualSlider.style.opacity = '0.4';
            qualSlider.style.cursor = 'not-allowed';
            if (qualVal) {
              qualVal.textContent = 'Auto (Target KB)';
              qualVal.style.color = 'var(--text-muted)';
            }
          }
        } else {
          this.targetSizeKB = null;
          document.querySelectorAll('.target-size-preset').forEach(b => b.classList.remove('active'));
        }
        this.processActive();
      });
    }

    // Target KB Size Quick Presets (e.g. 20KB, 50KB, 100KB, 200KB)
    document.querySelectorAll('.target-size-preset').forEach(btn => {
      const kb = parseFloat(btn.dataset.kb);
      if (this.targetSizeKB && kb === this.targetSizeKB) {
        document.querySelectorAll('.target-size-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
      btn.addEventListener('click', () => {
        document.querySelectorAll('.target-size-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (targetInput) targetInput.value = kb;
        this.targetSizeKB = kb;

        // Uncheck and disable slider when clicking preset
        if (qualCheckbox && qualSlider) {
          qualCheckbox.checked = false;
          qualSlider.disabled = true;
          qualSlider.style.opacity = '0.4';
          qualSlider.style.cursor = 'not-allowed';
          if (qualVal) {
            qualVal.textContent = 'Auto (Target KB)';
            qualVal.style.color = 'var(--text-muted)';
          }
        }
        this.processActive();
      });
    });

    // Dimensions Inputs
    const wInput = document.getElementById('resizeWidth');
    const hInput = document.getElementById('resizeHeight');
    const lockAspect = document.getElementById('lockAspect');
    if (wInput) {
      wInput.addEventListener('input', () => {
        this.reqWidth = parseInt(wInput.value) || null;
        this.processActive();
      });
    }
    if (hInput) {
      hInput.addEventListener('input', () => {
        this.reqHeight = parseInt(hInput.value) || null;
        this.processActive();
      });
    }
    if (lockAspect) {
      lockAspect.addEventListener('change', () => {
        this.preserveAspect = lockAspect.checked;
        this.processActive();
      });
    }

    // Crop Aspect Ratio Pills
    document.querySelectorAll('.crop-ratio-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.crop-ratio-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.cropRatio = btn.dataset.ratio;
        if (this.cropperInstance) this.cropperInstance.setRatio(this.cropRatio);
      });
    });

    // Crop Zoom Slider
    const cropZoom = document.getElementById('cropZoomSlider');
    if (cropZoom) {
      cropZoom.addEventListener('input', (e) => {
        const z = parseInt(e.target.value) / 100;
        if (this.cropperInstance) this.cropperInstance.setZoom(z);
      });
    }

    // Download Button
    const btnDownload = document.getElementById('btnDownload');
    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        if (!this.currentResult) return;
        ImgDropApp.trackEvent('file_downloaded', { mode: this.defaultMode, size: this.currentResult.size });
        const a = document.createElement('a');
        a.href = this.currentResult.blobUrl;
        a.download = this.currentResult.filename;
        a.click();
      });
    }

    // Reset Button
    const btnReset = document.getElementById('btnReset');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.currentFiles = [];
        this.currentResult = null;
        if (this.cropperInstance) this.cropperInstance.destroy();
        document.getElementById('dropzone').classList.remove('hidden');
        document.getElementById('resultSection').classList.add('hidden');
      });
    }
  }
}
