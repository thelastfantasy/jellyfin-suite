import { t } from './i18n';

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
  document.body.appendChild(ripple);

  setTimeout(() => ripple.remove(), 1000);
}

// ── Brightness / Volume OSD (left and right, tall portrait rectangle) ─────

interface OsdState {
  el: HTMLDivElement | null;
  fill: HTMLDivElement | null;
  pct: HTMLDivElement | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const _brightness: OsdState = { el: null, fill: null, pct: null, timer: null };
const _volume: OsdState = { el: null, fill: null, pct: null, timer: null };

function getOrCreateOsd(state: OsdState, side: 'left' | 'right', icon: string, label: string): OsdState {
  if (!state.el) {
    const el = document.createElement('div');
    el.className = `jfs-enhancer-osd jfs-enhancer-osd--${side}`;

    const iconEl = document.createElement('div');
    iconEl.className = 'jfs-enhancer-osd__icon';
    iconEl.textContent = icon;

    const track = document.createElement('div');
    track.className = 'jfs-enhancer-osd__bar-track';
    const fill = document.createElement('div');
    fill.className = 'jfs-enhancer-osd__bar-fill';
    track.appendChild(fill);

    const pct = document.createElement('div');
    pct.className = 'jfs-enhancer-osd__pct';

    const labelEl = document.createElement('div');
    labelEl.className = 'jfs-enhancer-osd__label';
    labelEl.textContent = label;

    el.appendChild(iconEl);
    el.appendChild(track);
    el.appendChild(pct);
    el.appendChild(labelEl);

    document.body.appendChild(el);
    state.el = el;
    state.fill = fill;
    state.pct = pct;
  }
  return state;
}

export function showValueOsd(type: 'brightness' | 'volume', value: number): void {
  const isBrightness = type === 'brightness';
  const state = isBrightness ? _brightness : _volume;
  const side = isBrightness ? 'left' : 'right';
  const icon = isBrightness ? '☀' : '🔊';
  const label = isBrightness ? t('osd.brightness') : t('osd.volume');

  getOrCreateOsd(state, side, icon, label);

  const rounded = Math.round(value);
  state.pct!.textContent = `${rounded}%`;
  state.fill!.style.height = `${Math.min(100, Math.max(0, rounded))}%`;
  state.el!.style.opacity = '1';

  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    if (state.el) state.el.style.opacity = '0';
    state.timer = null;
  }, 1500);
}
