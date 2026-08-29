/**
 * ImgDrop Web - Interactive Canvas Visual Cropper
 * Smooth drag-to-crop, multi-touch, aspect-ratio locking, and zoom/pan.
 */

export class InteractiveCropper {
  constructor(container, onChange, onDragMove) {
    this.container = container;
    this.onChange = onChange;
    this.onDragMove = onDragMove;

    this.imgSrc = null;
    this.origWidth = 0;
    this.origHeight = 0;
    this.aspectRatio = null; // null = free, number = locked w/h ratio

    this.box = { x: 0, y: 0, w: 0, h: 0 };
    this.isDragging = false;
    this.dragType = null;
    this.dragStart = { pX: 0, pY: 0, bx: 0, by: 0, bw: 0, bh: 0, panX: 0, panY: 0 };

    this.dispW = 0;
    this.dispH = 0;
    this.zoomLevel = 1.0;
    this.imgOffset = { x: 0, y: 0 };

    this.wrapper = null;
    this.imgEl = null;
    this.boxEl = null;
    this.maskTop = null;
    this.maskBottom = null;
    this.maskLeft = null;
    this.maskRight = null;

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  setImage(src, origWidth, origHeight) {
    this.imgSrc = src;
    this.origWidth = origWidth;
    this.origHeight = origHeight;
    this._render();
  }

  setRatio(ratioStr) {
    const map = { '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3, '3:2': 3 / 2 };
    this.aspectRatio = typeof ratioStr === 'number' ? ratioStr : (map[ratioStr] ?? null);

    if (this.dispW > 0 && this.dispH > 0) {
      this._resetBox();
      this._updateUI();
      this._notifyChange();
    }
  }

  setZoom(zoom) {
    this.zoomLevel = Math.max(1.0, Math.min(3.0, zoom));
    this._applyImageTransform();
  }

  destroy() {
    window.removeEventListener('mousemove', this._onPointerMove);
    window.removeEventListener('mouseup', this._onPointerUp);
    window.removeEventListener('touchmove', this._onPointerMove);
    window.removeEventListener('touchend', this._onPointerUp);
    if (this.container) this.container.innerHTML = '';
  }

  _render() {
    if (!this.container) return;
    this.container.innerHTML = '';

    const maxW = this.container.clientWidth || 600;
    const maxH = Math.min(450, window.innerHeight * 0.55);

    const imgAspect = this.origWidth / this.origHeight;
    let w = maxW;
    let h = w / imgAspect;

    if (h > maxH) {
      h = maxH;
      w = h * imgAspect;
    }

    this.dispW = Math.round(w);
    this.dispH = Math.round(h);

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'imgdrop-cropper-wrapper';
    this.wrapper.style.width = `${this.dispW}px`;
    this.wrapper.style.height = `${this.dispH}px`;

    this.imgEl = document.createElement('img');
    this.imgEl.src = this.imgSrc;
    this.imgEl.className = 'imgdrop-cropper-img';
    this.wrapper.appendChild(this.imgEl);

    // Dark semi-transparent masks
    this.maskTop = document.createElement('div');
    this.maskBottom = document.createElement('div');
    this.maskLeft = document.createElement('div');
    this.maskRight = document.createElement('div');
    [this.maskTop, this.maskBottom, this.maskLeft, this.maskRight].forEach(m => {
      m.className = 'imgdrop-crop-mask';
      this.wrapper.appendChild(m);
    });

    // Interactive Crop Box
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'imgdrop-crop-box';

    // 8 resize handles
    const handles = ['nw', 'ne', 'se', 'sw', 'n', 's', 'e', 'w'];
    handles.forEach(pos => {
      const hEl = document.createElement('div');
      hEl.className = `imgdrop-crop-handle handle-${pos}`;
      hEl.dataset.drag = pos;
      this.boxEl.appendChild(hEl);
    });

    // Rule of thirds grid lines
    const grid = document.createElement('div');
    grid.className = 'imgdrop-crop-grid';
    grid.innerHTML = '<div class="gh"></div><div class="gh"></div><div class="gv"></div><div class="gv"></div>';
    this.boxEl.appendChild(grid);

    this.wrapper.appendChild(this.boxEl);
    this.container.appendChild(this.wrapper);

    this._resetBox();
    this._updateUI();
    this._attachEvents();
    this._notifyChange();
  }

  _resetBox() {
    const pad = 0.1;
    let bw = this.dispW * (1 - pad * 2);
    let bh = this.dispH * (1 - pad * 2);

    if (this.aspectRatio) {
      if (bw / bh > this.aspectRatio) {
        bw = bh * this.aspectRatio;
      } else {
        bh = bw / this.aspectRatio;
      }
    }

    this.box = {
      x: (this.dispW - bw) / 2,
      y: (this.dispH - bh) / 2,
      w: bw,
      h: bh
    };
  }

  _attachEvents() {
    const onStart = (e) => {
      const p = e.touches ? e.touches[0] : e;
      const target = e.target;

      this.isDragging = true;
      this.dragType = target.dataset.drag || (target.closest('.imgdrop-crop-box') ? 'move' : 'pan');
      this.dragStart = {
        pX: p.clientX,
        pY: p.clientY,
        bx: this.box.x,
        by: this.box.y,
        bw: this.box.w,
        bh: this.box.h,
        panX: this.imgOffset.x,
        panY: this.imgOffset.y
      };

      e.preventDefault();
    };

    this.wrapper.addEventListener('mousedown', onStart);
    this.wrapper.addEventListener('touchstart', onStart, { passive: false });

    window.addEventListener('mousemove', this._onPointerMove);
    window.addEventListener('touchmove', this._onPointerMove, { passive: false });
    window.addEventListener('mouseup', this._onPointerUp);
    window.addEventListener('touchend', this._onPointerUp);
  }

  _onPointerMove(e) {
    if (!this.isDragging) return;
    const p = e.touches ? e.touches[0] : e;
    const dx = p.clientX - this.dragStart.pX;
    const dy = p.clientY - this.dragStart.pY;

    if (this.dragType === 'pan') {
      this.imgOffset.x = this.dragStart.panX + dx;
      this.imgOffset.y = this.dragStart.panY + dy;
      this._applyImageTransform();
      return;
    }

    if (this.dragType === 'move') {
      this.box.x = Math.max(0, Math.min(this.dispW - this.box.w, this.dragStart.bx + dx));
      this.box.y = Math.max(0, Math.min(this.dispH - this.box.h, this.dragStart.by + dy));
    } else {
      this._resizeBox(this.dragType, dx, dy);
    }

    this._updateUI();
    if (this.onDragMove) this._notifyChange(this.onDragMove);
    e.preventDefault();
  }

  _onPointerUp() {
    if (!this.isDragging) return;
    this.isDragging = false;
    this._notifyChange(this.onChange);
  }

  _resizeBox(type, dx, dy) {
    const minSize = 24;
    let { bx, by, bw, bh } = this.dragStart;

    if (type.includes('e')) bw += dx;
    if (type.includes('s')) bh += dy;
    if (type.includes('w')) {
      bw -= dx;
      bx += dx;
    }
    if (type.includes('n')) {
      bh -= dy;
      by += dy;
    }

    if (this.aspectRatio) {
      if (type === 'e' || type === 'w') {
        bh = bw / this.aspectRatio;
      } else if (type === 'n' || type === 's') {
        bw = bh * this.aspectRatio;
      } else {
        if (bw / bh > this.aspectRatio) {
          bw = bh * this.aspectRatio;
        } else {
          bh = bw / this.aspectRatio;
        }
      }
    }

    if (bw >= minSize && bh >= minSize) {
      this.box.x = Math.max(0, Math.min(this.dispW - bw, bx));
      this.box.y = Math.max(0, Math.min(this.dispH - bh, by));
      this.box.w = Math.min(this.dispW - this.box.x, bw);
      this.box.h = Math.min(this.dispH - this.box.y, bh);
    }
  }

  _updateUI() {
    if (!this.boxEl) return;
    const { x, y, w, h } = this.box;

    this.boxEl.style.transform = `translate(${x}px, ${y}px)`;
    this.boxEl.style.width = `${w}px`;
    this.boxEl.style.height = `${h}px`;

    this.maskTop.style.cssText = `top:0; left:0; width:100%; height:${y}px;`;
    this.maskBottom.style.cssText = `top:${y + h}px; left:0; width:100%; height:${this.dispH - (y + h)}px;`;
    this.maskLeft.style.cssText = `top:${y}px; left:0; width:${x}px; height:${h}px;`;
    this.maskRight.style.cssText = `top:${y}px; left:${x + w}px; width:${this.dispW - (x + w)}px; height:${h}px;`;
  }

  _applyImageTransform() {
    if (!this.imgEl) return;
    this.imgEl.style.transform = `scale(${this.zoomLevel}) translate(${this.imgOffset.x / this.zoomLevel}px, ${this.imgOffset.y / this.zoomLevel}px)`;
  }

  _notifyChange(cb = this.onChange) {
    if (!cb) return;
    const scaleX = this.origWidth / this.dispW;
    const scaleY = this.origHeight / this.dispH;

    cb({
      x: Math.round(this.box.x * scaleX),
      y: Math.round(this.box.y * scaleY),
      width: Math.round(this.box.w * scaleX),
      height: Math.round(this.box.h * scaleY)
    });
  }
}
