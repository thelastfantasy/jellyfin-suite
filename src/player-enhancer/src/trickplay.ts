interface SeekPreviewMeta {
  base: string;
  token: string;
}

const _cache = new Map<string, SeekPreviewMeta>();
let _thumbWrap: HTMLDivElement | null = null;
let _thumbImg: HTMLImageElement | null = null;
let _pendingKey: string | null = null;

// Frames confirmed loaded into the browser cache (`${itemId}:${alignedMs}`)
const _loadedKeys = new Set<string>();

// Deduplicate prefetch: track recently-sent aligned keys to avoid flooding the server.
const _prefetchSent = new Map<string, number>();
const PREFETCH_DEDUP_MS = 200;

function getRawToken(): string {
  const ac = (window as any).ApiClient;
  if (!ac) return '';
  return (typeof ac.accessToken === 'function' ? ac.accessToken() : ac._accessToken) ?? '';
}

function getServerAddress(): string {
  const ac = (window as any).ApiClient;
  if (!ac) return '';
  return (typeof ac.serverAddress === 'function' ? ac.serverAddress() : ac._serverAddress) ?? '';
}

export async function initTrickplay(itemId: string, _videoEl: HTMLVideoElement): Promise<void> {
  ensureMeta(itemId);
}

function ensureMeta(itemId: string): SeekPreviewMeta | undefined {
  if (!itemId) return undefined;
  if (!_cache.has(itemId)) {
    const base = getServerAddress();
    const token = getRawToken();
    if (base) _cache.set(itemId, { base, token });
  }
  return _cache.get(itemId);
}

function ensureThumbEl(): { wrap: HTMLDivElement; img: HTMLImageElement } {
  if (!_thumbWrap || !_thumbImg) {
    _thumbWrap = document.createElement('div');
    _thumbWrap.className = 'jfs-speed-osd__thumb-wrap';

    _thumbImg = document.createElement('img');
    _thumbImg.className = 'jfs-speed-osd__thumb-img';

    _thumbWrap.appendChild(_thumbImg);
    document.body.appendChild(_thumbWrap);
  }
  return { wrap: _thumbWrap, img: _thumbImg };
}

function makeUrl(meta: SeekPreviewMeta, itemId: string, alignedMs: number): string {
  return `${meta.base}/JellyfinSuite/SeekPreview/${itemId}?positionMs=${alignedMs}&api_key=${meta.token}`;
}

export function showTrickplayThumb(
  posMs: number,
  itemId: string,
  videoEl: HTMLVideoElement,
): void {
  const meta = ensureMeta(itemId);
  if (!meta) return;

  const { wrap, img: thumbImg } = ensureThumbEl();

  // Size is controlled by CSS (max-width: 33dvw; max-height: 22dvh)
  const rect = videoEl.getBoundingClientRect();
  const osd = document.querySelector<HTMLElement>('.jfs-seek-osd');
  if (osd) {
    const osdRect = osd.getBoundingClientRect();
    wrap.style.top = `${Math.round(osdRect.bottom + 8)}px`;
    wrap.style.transform = 'translate(-50%, 0)';
  } else {
    wrap.style.top = `${Math.round(rect.top + rect.height * 0.65)}px`;
    wrap.style.transform = 'translate(-50%, -50%)';
  }

  const aligned = Math.floor(posMs / 500) * 500;
  const exactKey = `${itemId}:${aligned}`;

  // Already targeting this frame — just ensure visible
  if (_pendingKey === exactKey) {
    wrap.style.display = 'block';
    return;
  }
  _pendingKey = exactKey;

  const exactUrl = makeUrl(meta, itemId, aligned);

  // Exact frame already in browser cache — show immediately without flash
  if (_loadedKeys.has(exactKey)) {
    thumbImg.src = exactUrl;
    wrap.style.display = 'block';
    return;
  }

  // Fuzzy match: show nearest already-loaded frame as placeholder while exact loads.
  // Searching outward in 500ms steps up to ±6s, nearest first.
  const FUZZY_RANGE = 6000;
  for (let d = 500; d <= FUZZY_RANGE; d += 500) {
    if (_loadedKeys.has(`${itemId}:${aligned - d}`)) {
      thumbImg.src = makeUrl(meta, itemId, aligned - d);
      wrap.style.display = 'block';
      break;
    }
    if (_loadedKeys.has(`${itemId}:${aligned + d}`)) {
      thumbImg.src = makeUrl(meta, itemId, aligned + d);
      wrap.style.display = 'block';
      break;
    }
  }

  // Preload exact frame; swap atomically when ready, suppressing broken-image icon.
  const preload = new Image();
  preload.onload = () => {
    _loadedKeys.add(exactKey);
    if (_thumbImg && _pendingKey === exactKey) {
      _thumbImg.src = exactUrl;
      _thumbWrap!.style.display = 'block';
    }
  };
  preload.src = exactUrl;
}

export function prefetchFrame(posMs: number, itemId: string): void {
  const meta = ensureMeta(itemId);
  if (!meta || posMs < 0) return;
  const aligned = Math.floor(posMs / 500) * 500;
  const key = `${itemId}:${aligned}`;
  if (_loadedKeys.has(key)) return;
  const now = Date.now();
  const last = _prefetchSent.get(key) ?? 0;
  if (now - last < PREFETCH_DEDUP_MS) return;
  _prefetchSent.set(key, now);
  const url = `${meta.base}/JellyfinSuite/SeekPreview/${itemId}?positionMs=${aligned}&prefetch=true&api_key=${meta.token}`;
  void fetch(url);
}

export function hideTrickplayThumb(): void {
  if (_thumbWrap) {
    _thumbWrap.style.display = 'none';
  }
  // Clear pending key so any in-flight preload won't re-show the element
  _pendingKey = null;
}

// Proactively prefetch frames at every 30s interval across the full duration.
// Requests are staggered at INTERVAL_STEP_MS apart to avoid flooding.
const INTERVAL_STEP_MS = 400;
export function startIntervalPrefetch(itemId: string, durationMs: number): void {
  if (!itemId || durationMs <= 0) return;
  const BUCKET = 30_000; // every 30s
  const count = Math.floor(durationMs / BUCKET);
  for (let i = 0; i <= count; i++) {
    const posMs = i * BUCKET;
    setTimeout(() => prefetchFrame(posMs, itemId), i * INTERVAL_STEP_MS);
  }
}
