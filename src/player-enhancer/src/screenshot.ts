import { t } from './i18n';

function sanitize(name: string): string {
  return name.replace(/[^\w一-鿿぀-ヿ가-힯\- ]/g, '_').trim() || 'screenshot';
}

function showToast(msg: string): void {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:rgba(0,0,0,0.8);color:#fff;padding:10px 18px;border-radius:6px;
    font-size:14px;z-index:99999;pointer-events:none;
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function takeScreenshot(
  videoEl: HTMLVideoElement,
  includeSubtitles: boolean,
  itemTitle?: string
): Promise<void> {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) return;

  // DOM-attached canvas works around Firefox Android hardware-decode black-frame bug
  // (OffscreenCanvas cannot read hardware-decoded frames on Firefox for Android)
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }

  try {
    try {
      // createImageBitmap is a dedicated frame-capture path, handles hardware frames better
      const bmp = await createImageBitmap(videoEl);
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
    } catch {
      ctx.drawImage(videoEl, 0, 0, w, h);
    }
  } catch (e) {
    canvas.remove();
    if (e instanceof DOMException && e.name === 'SecurityError') {
      showToast(t('screenshot.drm'));
      return;
    }
    throw e;
  }

  if (includeSubtitles) {
    // ASS/SSA via libass canvas
    const assCanvas = document.querySelector<HTMLCanvasElement>(
      '.libassjs-canvas-parent canvas'
    );
    if (assCanvas) {
      try { ctx.drawImage(assCanvas, 0, 0, w, h); } catch { /* cross-origin guard */ }
    }
    // SRT/VTT native ::cue — cannot be captured by Canvas API, silently skipped
  }

  await new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.remove();
      if (!blob) { reject(new Error('toBlob returned null')); return; }
      const title = sanitize(itemTitle ?? 'screenshot');
      downloadBlob(blob, `jellyfin-screenshot-${title}-${Date.now()}.png`);
      resolve();
    }, 'image/png');
  });
}
