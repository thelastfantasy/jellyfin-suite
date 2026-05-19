import { injectStyles } from './styles';
import { createFrameStepButtons, stepFrames } from './framestepper';
import { takeScreenshot } from './screenshot';
import { initGestures, setSeekSeconds } from './gestures';
import { t } from './i18n';
import { ICON_SCREENSHOT } from './icons';

const ROOT_ID = 'jfs-enhancer-root';

let _currentVideoEl: HTMLVideoElement | null = null;
let _cachedItemId = '';

async function loadGestureConfig(): Promise<void> {
  try {
    const res = await fetch('/JellyfinSuite/PlayerEnhancer/GestureConfig');
    if (res.ok) {
      const cfg = await res.json() as { seekSeconds?: number };
      if (typeof cfg.seekSeconds === 'number' && cfg.seekSeconds > 0) {
        setSeekSeconds(cfg.seekSeconds);
      }
    }
  } catch {
    // keep default
  }
}

function extractItemIdFromSearch(search: string): string {
  return new URLSearchParams(search).get('id') ?? '';
}

function extractItemIdFromUrl(url: string): string {
  const qIndex = url.indexOf('?');
  if (qIndex < 0) return '';
  return extractItemIdFromSearch(url.slice(qIndex + 1));
}

function getItemId(): string {
  return extractItemIdFromUrl(window.location.href) || _cachedItemId;
}

export function initInjector(): void {
  injectStyles();
  loadGestureConfig();
  window.addEventListener('jfs:seekSecondsChanged', (e: Event) => {
    const { seconds } = (e as CustomEvent<{ seconds: number }>).detail;
    if (typeof seconds === 'number' && seconds > 0) setSeekSeconds(seconds);
  });

  // Jellyfin uses @remix-run/router with history.pushState — no hashchange fires.
  // Intercept pushState to capture item ID before the URL changes.
  const _origPushState = history.pushState.bind(history);
  history.pushState = function (data: unknown, unused: string, url?: string | URL | null) {
    const id = extractItemIdFromUrl(window.location.href);
    if (id) _cachedItemId = id;
    return _origPushState(data, unused, url);
  };

  const observer = new MutationObserver(() => tryInject());
  observer.observe(document.body, { childList: true, subtree: true });
  tryInject();
}

function tryInject(): void {
  const container = document.querySelector('.videoPlayerContainer');
  if (!container) return;

  const videoEl = container.querySelector<HTMLVideoElement>('video.htmlvideoplayer');
  if (!videoEl) return;

  // Reset filter and re-init gestures when video element changes
  if (videoEl !== _currentVideoEl) {
    if (_currentVideoEl) _currentVideoEl.style.filter = '';
    _currentVideoEl = videoEl;
    initGestures(videoEl);
  }

  // Ensure root marker exists (idempotent)
  if (!document.getElementById(ROOT_ID)) {
    const root = document.createElement('div');
    root.id = ROOT_ID;
    container.appendChild(root);
  }

  // Inject OSD buttons; presence-check so we re-inject if Jellyfin rebuilds the OSD
  const osdButtons = document.querySelector<HTMLElement>(
    '.osdControls .buttons.focuscontainer-x'
  );
  if (osdButtons && !osdButtons.querySelector('.jfs-enhancer-framestep-wrap')) {
    injectPlayerButtons(osdButtons, videoEl);
  }
}

function initF10Adaptive(back10: HTMLElement, fwd10: HTMLElement, osdButtons: HTMLElement): void {
  let rafId = 0;
  function update(): void {
    cancelAnimationFrame(rafId);
    // 先显示让布局包含它们，再检测是否换行
    back10.style.display = '';
    fwd10.style.display = '';
    rafId = requestAnimationFrame(() => {
      const children = [...osdButtons.children] as HTMLElement[];
      if (children.length < 2) return;
      const refTop = children[0].getBoundingClientRect().top;
      const wraps = children.some(c => Math.abs(c.getBoundingClientRect().top - refTop) > 4);
      if (wraps) {
        back10.style.display = 'none';
        fwd10.style.display = 'none';
      }
    });
  }
  const ro = new ResizeObserver(update);
  ro.observe(osdButtons);
  update();
}

function injectPlayerButtons(
  osdButtons: HTMLElement,
  videoEl: HTMLVideoElement
): void {
  // ── Frame step buttons ──────────────────────────────────────────────────
  const frameStepWrap = createFrameStepButtons();
  const [btnBack10, btnBack1, btnFwd1, btnFwd10] = Array.from(
    frameStepWrap.querySelectorAll('button')
  );

  btnBack10.addEventListener('click', () => stepFrames(videoEl, -10, getItemId()));
  btnBack1.addEventListener('click',  () => stepFrames(videoEl, -1,  getItemId()));
  btnFwd1.addEventListener('click',   () => stepFrames(videoEl,  1,  getItemId()));
  btnFwd10.addEventListener('click',  () => stepFrames(videoEl,  10, getItemId()));

  // ── Screenshot button + subtitle switch ────────────────────────────────
  const screenshotWrap = document.createElement('div');
  screenshotWrap.className = 'jfs-enhancer-screenshot-wrap';

  const screenshotBtn = document.createElement('button');
  screenshotBtn.className = 'jfs-enhancer-btn';
  screenshotBtn.title = t('screenshot.button');
  screenshotBtn.innerHTML = ICON_SCREENSHOT;

  const switchLabel = document.createElement('label');
  switchLabel.className = 'jfs-enhancer-switch';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = false;
  const toggleTrack = document.createElement('span');
  toggleTrack.className = 'jfs-enhancer-toggle-track';
  switchLabel.appendChild(checkbox);
  switchLabel.appendChild(toggleTrack);
  switchLabel.appendChild(document.createTextNode(t('screenshot.subtitles')));

  screenshotBtn.addEventListener('click', () => {
    const title = document.title.replace(/\s*[-|]\s*Jellyfin\s*$/i, '').trim() || undefined;
    takeScreenshot(videoEl, checkbox.checked, title);
  });

  // Firefox mobile 上 label>checkbox 的 touch 联动不可靠，直接处理 touchend
  switchLabel.addEventListener('touchend', (e) => {
    e.preventDefault(); // 阻止合成 click 造成二次触发
    checkbox.checked = !checkbox.checked;
  }, { passive: false });

  screenshotWrap.appendChild(screenshotBtn);
  screenshotWrap.appendChild(switchLabel);

  // Show subtitle toggle only when subtitles are actually active
  function updateSubtitleToggleVisibility() {
    const hasAssSubtitles = !!document.querySelector('.libassjs-canvas-parent canvas');
    const srtEl = document.querySelector('.videoSubtitles');
    const hasSrtSubtitles = !!srtEl && srtEl.textContent!.trim().length > 0;
    const active = hasAssSubtitles || hasSrtSubtitles;
    switchLabel.style.display = active ? '' : 'none';
    screenshotWrap.classList.toggle('jfs-has-subtitles', active);
  }
  updateSubtitleToggleVisibility();
  const subtitleObserver = new MutationObserver(updateSubtitleToggleVisibility);
  subtitleObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

  // Insert after the native controls (dir="ltr" div), before secondary controls
  const dirLtr = osdButtons.querySelector<HTMLElement>('div[dir="ltr"]');
  if (dirLtr) {
    dirLtr.after(frameStepWrap);
    frameStepWrap.after(screenshotWrap);
  } else {
    osdButtons.append(frameStepWrap);
    osdButtons.append(screenshotWrap);
  }

  // F±10 自适应：宽度够就显示，否则隐藏
  initF10Adaptive(btnBack10 as HTMLElement, btnFwd10 as HTMLElement, osdButtons);
}
