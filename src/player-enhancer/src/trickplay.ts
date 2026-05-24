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

// SSE connection for ready-frame notifications (one per active video)
let _readyStreamEs: EventSource | null = null;
let _readyStreamItemId: string | null = null;

// Limit concurrent FETCH requests to 1 to avoid overwhelming the daemon on large files
let _fetchInFlight = false;

// Retry timer for SSE open attempts
let _initRetryTimer: ReturnType<typeof setTimeout> | null = null;

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

export function initTrickplay(getItemId: () => string, videoEl: HTMLVideoElement): void {
  // Cancel any pending retry for a previous video.
  if (_initRetryTimer) { clearTimeout(_initRetryTimer); _initRetryTimer = null; }

  const RETRY_DELAYS = [0, 1000, 2000, 3000];
  let attempt = 0;

  const tryOpen = (): void => {
    if (attempt >= RETRY_DELAYS.length) return;
    const delay = RETRY_DELAYS[attempt++];
    if (delay === 0) {
      doOpen();
    } else {
      _initRetryTimer = setTimeout(() => { _initRetryTimer = null; doOpen(); }, delay);
    }
  };

  const doOpen = (): void => {
    const id = getItemId();
    const meta = ensureMeta(id);
    if (meta && id) {
      openReadyStream(id, meta, videoEl);
    } else {
      tryOpen();
    }
  };

  tryOpen();
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

function openReadyStream(itemId: string, meta: SeekPreviewMeta, videoEl: HTMLVideoElement): void {
  // Close previous stream when switching videos
  if (_readyStreamEs) {
    _readyStreamEs.close();
    _readyStreamEs = null;
    _readyStreamItemId = null;
  }

  const posMs = Math.floor((videoEl.currentTime || 0) * 1000);
  const url = `${meta.base}/JellyfinSuite/SeekPreview/${itemId}/ready-stream?positionMs=${posMs}&api_key=${meta.token}`;
  const es = new EventSource(url);
  _readyStreamEs = es;
  _readyStreamItemId = itemId;

  es.onmessage = (e) => {
    const posMs = Number(e.data);
    if (!isFinite(posMs)) return;
    const key = `${itemId}:${posMs}`;
    if (_loadedKeys.has(key)) return;
    // Proactively load into browser HTTP cache so drag-seek is instant.
    const img = new Image();
    img.onload = () => _loadedKeys.add(key);
    img.src = makeUrl(meta, itemId, posMs);
  };

  es.onerror = () => {
    es.close();
    if (_readyStreamEs === es) { _readyStreamEs = null; _readyStreamItemId = null; }
  };
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

  // Last-resort fallback: if initTrickplay's retries all failed, open SSE now.
  if (!_readyStreamEs || _readyStreamItemId !== itemId) openReadyStream(itemId, meta, videoEl);

  const { wrap, img: thumbImg } = ensureThumbEl();

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

  _pendingKey = exactKey;

  const exactUrl = makeUrl(meta, itemId, aligned);

  if (_loadedKeys.has(exactKey)) {
    thumbImg.src = exactUrl;
    wrap.style.display = 'block';
    return;
  }

  // Fuzzy match: show nearest already-loaded frame as placeholder while exact loads.
  // Range must cover half the 30s-aligned interval (15000ms) so no gap is left uncovered.
  const FUZZY_RANGE = 15000;
  let fuzzyFound = false;
  for (let d = 500; d <= FUZZY_RANGE; d += 500) {
    if (_loadedKeys.has(`${itemId}:${aligned - d}`)) {
      thumbImg.src = makeUrl(meta, itemId, aligned - d);
      wrap.style.display = 'block';
      fuzzyFound = true;
      break;
    }
    if (_loadedKeys.has(`${itemId}:${aligned + d}`)) {
      thumbImg.src = makeUrl(meta, itemId, aligned + d);
      wrap.style.display = 'block';
      fuzzyFound = true;
      break;
    }
  }
  // No nearby frame available — hide stale content rather than show a wrong thumbnail
  if (!fuzzyFound) wrap.style.display = 'none';

  if (_fetchInFlight) return;
  _fetchInFlight = true;
  const preload = new Image();
  preload.onload = () => {
    _fetchInFlight = false;
    _loadedKeys.add(exactKey);
    if (_thumbImg && _pendingKey === exactKey) {
      _thumbImg.src = exactUrl;
      _thumbWrap!.style.display = 'block';
    }
  };
  preload.onerror = () => { _fetchInFlight = false; };
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
  _pendingKey = null;
}
