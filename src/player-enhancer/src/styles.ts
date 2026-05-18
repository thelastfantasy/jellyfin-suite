const STYLE_ID = 'jfs-enhancer-styles';

const CSS = `
#jfs-enhancer-root {
  display: contents;
}

.jfs-enhancer-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: #fff;
  opacity: 0.75;
  transition: opacity 0.15s, background 0.15s;
  border-radius: 4px;
  flex-shrink: 0;
}

.jfs-enhancer-btn:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.12);
}

.jfs-enhancer-btn:active {
  background: rgba(255, 255, 255, 0.22);
}

.jfs-enhancer-btn svg {
  width: 20px;
  height: 20px;
  pointer-events: none;
}

.jfs-enhancer-screenshot-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.jfs-enhancer-switch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  cursor: pointer;
  user-select: none;
}

.jfs-enhancer-switch input {
  cursor: pointer;
}

.jfs-enhancer-osd {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  border-radius: 8px;
  padding: 12px 20px;
  font-size: 18px;
  font-weight: bold;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  z-index: 9999;
  transition: opacity 0.3s;
}

/* YouTube-style seek ripple — half-oval on screen edge + animated arrows */
.jfs-enhancer-ripple {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  z-index: 9998;
}

.jfs-enhancer-ripple-left  { left: 0; }
.jfs-enhancer-ripple-right { right: 0; }

.jfs-enhancer-ripple-bg {
  width: 120px;
  height: 180px;
  background: rgba(0, 0, 0, 0.42);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  animation: jfs-ripple-fade 0.95s ease-out forwards;
}

/* Half-oval cut on screen edge: right side gets left half of pill, left side gets right half */
.jfs-enhancer-ripple-right .jfs-enhancer-ripple-bg { border-radius: 90px 0 0 90px; padding-left: 12px; }
.jfs-enhancer-ripple-left  .jfs-enhancer-ripple-bg { border-radius: 0 90px 90px 0; padding-right: 12px; }

.jfs-enhancer-ripple-arrows {
  display: flex;
  flex-direction: row;
  gap: 1px;
  height: 28px;
  align-items: center;
}

.jfs-enhancer-ripple-arrow {
  font-size: 22px;
  line-height: 1;
  color: #fff;
  display: inline-block;
  opacity: 0;
}

/* Staggered wave: each arrow fades in then translates in seek direction */
.jfs-enhancer-ripple-right .jfs-enhancer-ripple-arrow {
  animation: jfs-arrow-right 0.65s ease-in-out infinite;
}
.jfs-enhancer-ripple-left .jfs-enhancer-ripple-arrow {
  animation: jfs-arrow-left 0.65s ease-in-out infinite;
}

.jfs-enhancer-ripple-arrow:nth-child(1) { animation-delay: 0s; }
.jfs-enhancer-ripple-arrow:nth-child(2) { animation-delay: 0.18s; }
.jfs-enhancer-ripple-arrow:nth-child(3) { animation-delay: 0.36s; }

.jfs-enhancer-ripple-label {
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}

@keyframes jfs-arrow-right {
  0%   { opacity: 0;   transform: translateX(-5px); }
  25%  { opacity: 1;   transform: translateX(0); }
  75%  { opacity: 1;   transform: translateX(5px); }
  100% { opacity: 0;   transform: translateX(10px); }
}

@keyframes jfs-arrow-left {
  0%   { opacity: 0;   transform: translateX(5px); }
  25%  { opacity: 1;   transform: translateX(0); }
  75%  { opacity: 1;   transform: translateX(-5px); }
  100% { opacity: 0;   transform: translateX(-10px); }
}

@keyframes jfs-ripple-fade {
  0%   { opacity: 1; }
  65%  { opacity: 1; }
  100% { opacity: 0; }
}
`;

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
