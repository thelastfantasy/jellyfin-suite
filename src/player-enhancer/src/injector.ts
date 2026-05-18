import { injectStyles } from './styles';
import type { PlaybackManager, JellyfinEvents } from './types/jellyfin';

const ROOT_ID = 'jfs-enhancer-root';

let _observer: MutationObserver | null = null;
let _playbackManager: PlaybackManager | null = null;

export function initInjector(playbackManager: PlaybackManager, events: JellyfinEvents): void {
  injectStyles();
  _playbackManager = playbackManager;

  // Fallback: fire on every playbackstart in case the observer misses the transition
  events.on(playbackManager, 'playbackstart', () => tryInject());

  // Primary: MutationObserver watches for .videoPlayerContainer appearing in DOM
  _observer = new MutationObserver(() => tryInject());
  _observer.observe(document.body, { childList: true, subtree: true });

  // Try immediately in case the player is already in the DOM
  tryInject();
}

function tryInject(): void {
  const container = document.querySelector('.videoPlayerContainer');
  if (!container) return;
  if (document.getElementById(ROOT_ID)) return; // idempotent

  const videoEl = container.querySelector<HTMLVideoElement>('video.htmlvideoplayer');
  if (!videoEl) return;

  const root = document.createElement('div');
  root.id = ROOT_ID;
  container.appendChild(root);
}

export function getPlaybackManager(): PlaybackManager | null {
  return _playbackManager;
}
