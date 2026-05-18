import { t } from './i18n';

function getContainer(): Element {
  return document.querySelector('.videoPlayerContainer') ?? document.body;
}

// ── YouTube-style seek ripple ──────────────────────────────────────────────

export function showRipple(side: 'left' | 'right', label: string): void {
  document.querySelector('.jfs-enhancer-ripple')?.remove();

  const ripple = document.createElement('div');
  ripple.className = `jfs-enhancer-ripple jfs-enhancer-ripple-${side}`;

  const bg = document.createElement('div');
  bg.className = 'jfs-enhancer-ripple-bg';

  const arrows = document.createElement('div');
  arrows.className = 'jfs-enhancer-ripple-arrows';
  const ch = side === 'right' ? '›' : '‹';
  for (let i = 0; i < 3; i++) {
    const span = document.createElement('span');
    span.className = 'jfs-enhancer-ripple-arrow';
    span.textContent = ch;
    arrows.appendChild(span);
  }

  const labelEl = document.createElement('div');
  labelEl.className = 'jfs-enhancer-ripple-label';
  labelEl.textContent = label;

  bg.appendChild(arrows);
  bg.appendChild(labelEl);
  ripple.appendChild(bg);
  getContainer().appendChild(ripple);

  setTimeout(() => ripple.remove(), 1000);
}

// ── Brightness / Volume OSD ────────────────────────────────────────────────

let _osdTimer: ReturnType<typeof setTimeout> | null = null;
let _osdEl: HTMLDivElement | null = null;

export function showValueOsd(type: 'brightness' | 'volume', value: number): void {
  if (!_osdEl) {
    _osdEl = document.createElement('div');
    _osdEl.className = 'jfs-enhancer-osd';
    getContainer().appendChild(_osdEl);
  }

  const icon = type === 'brightness' ? '☀' : '🔊';
  const label = type === 'brightness' ? t('osd.brightness') : t('osd.volume');
  _osdEl.textContent = '';

  const iconEl = document.createElement('div');
  iconEl.style.fontSize = '22px';
  iconEl.textContent = icon;

  const pct = document.createElement('div');
  pct.textContent = `${label} ${Math.round(value)}%`;

  _osdEl.appendChild(iconEl);
  _osdEl.appendChild(pct);
  _osdEl.style.opacity = '1';

  if (_osdTimer) clearTimeout(_osdTimer);
  _osdTimer = setTimeout(() => {
    if (_osdEl) _osdEl.style.opacity = '0';
    _osdTimer = null;
  }, 1500);
}
