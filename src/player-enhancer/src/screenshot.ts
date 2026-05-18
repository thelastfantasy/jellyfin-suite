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

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  try {
    ctx.drawImage(videoEl, 0, 0, w, h);
  } catch (e) {
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

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const title = sanitize(itemTitle ?? 'screenshot');
  downloadBlob(blob, `jellyfin-screenshot-${title}-${Date.now()}.png`);
}
