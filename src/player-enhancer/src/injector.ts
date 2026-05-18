import { injectStyles } from './styles';
import { createFrameStepButtons, stepFrames } from './framestepper';
import { takeScreenshot } from './screenshot';
import { initGestures } from './gestures';
import { t } from './i18n';
import { ICON_SCREENSHOT } from './icons';
import type { PlaybackManager, JellyfinEvents } from './types/jellyfin';

const ROOT_ID = 'jfs-enhancer-root';

let _observer: MutationObserver | null = null;
let _playbackManager: PlaybackManager | null = null;
let _currentVideoEl: HTMLVideoElement | null = null;
let _buttonsInjected = false;

export function initInjector(playbackManager: PlaybackManager, events: JellyfinEvents): void {
  injectStyles();
  _playbackManager = playbackManager;

  events.on(playbackManager, 'playbackstart', () => {
    // Reset brightness for new video
    if (_currentVideoEl) _currentVideoEl.style.filter = '';
    // Allow re-injection (video source may have changed)
    _buttonsInjected = false;
    document.getElementById(ROOT_ID)?.remove();
    tryInject();
  });

  _observer = new MutationObserver(() => tryInject());
  _observer.observe(document.body, { childList: true, subtree: true });

  tryInject();
}

function tryInject(): void {
  const container = document.querySelector('.videoPlayerContainer');
  if (!container) return;

  const videoEl = container.querySelector<HTMLVideoElement>('video.htmlvideoplayer');
  if (!videoEl) return;

  _currentVideoEl = videoEl;

  // Ensure root marker exists
  if (!document.getElementById(ROOT_ID)) {
    const root = document.createElement('div');
    root.id = ROOT_ID;
    container.appendChild(root);
  }

  // Inject OSD buttons once OSD controls are available
  if (!_buttonsInjected) {
    const osdButtons = container.querySelector<HTMLElement>(
      '.osdControls .buttons.focuscontainer-x'
    );
    if (osdButtons) {
      injectPlayerButtons(osdButtons, videoEl);
      if (_playbackManager) initGestures(videoEl, _playbackManager);
      _buttonsInjected = true;
    }
  }
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

  const getItemId = () => _playbackManager?.currentItem()?.Id ?? '';

  btnBack10.addEventListener('click', () => stepFrames(videoEl, -10, getItemId()));
  btnBack1.addEventListener('click',  () => stepFrames(videoEl, -1,  getItemId()));
  btnFwd1.addEventListener('click',   () => stepFrames(videoEl,  1,  getItemId()));
  btnFwd10.addEventListener('click',  () => stepFrames(videoEl,  10, getItemId()));

  osdButtons.prepend(frameStepWrap);

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
  const switchText = document.createTextNode(t('screenshot.subtitles'));
  switchLabel.appendChild(checkbox);
  switchLabel.appendChild(switchText);

  screenshotBtn.addEventListener('click', () => {
    const title = _playbackManager?.currentItem()?.Name;
    takeScreenshot(videoEl, checkbox.checked, title);
  });

  screenshotWrap.appendChild(screenshotBtn);
  screenshotWrap.appendChild(switchLabel);
  osdButtons.prepend(screenshotWrap);
}

export function getPlaybackManager(): PlaybackManager | null {
  return _playbackManager;
}
