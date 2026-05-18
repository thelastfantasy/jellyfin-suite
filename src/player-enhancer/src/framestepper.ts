import { ICON_BACK10, ICON_BACK1, ICON_FORWARD1, ICON_FORWARD10 } from './icons';
import { t } from './i18n';
import { getFps } from './fps-cache';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function makeBtn(svgHtml: string, tooltip: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'jfs-enhancer-btn';
  btn.title = tooltip;
  btn.innerHTML = svgHtml;
  return btn;
}

export function createFrameStepButtons(): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'jfs-enhancer-framestep-wrap';
  wrap.style.cssText = 'display:inline-flex;align-items:center;';

  wrap.appendChild(makeBtn(ICON_BACK10,    t('framestepper.back10')));
  wrap.appendChild(makeBtn(ICON_BACK1,     t('framestepper.back1')));
  wrap.appendChild(makeBtn(ICON_FORWARD1,  t('framestepper.forward1')));
  wrap.appendChild(makeBtn(ICON_FORWARD10, t('framestepper.forward10')));

  return wrap;
}

export async function stepFrames(
  videoEl: HTMLVideoElement,
  delta: number,
  itemId: string
): Promise<void> {
  const fps = await getFps(itemId);
  if (!videoEl.paused) videoEl.pause();
  videoEl.currentTime = clamp(
    videoEl.currentTime + delta / fps,
    0,
    videoEl.duration || 0
  );
}
