const k = "jfs-enhancer-styles", F = `
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
function I() {
  if (document.getElementById(k)) return;
  const e = document.createElement("style");
  e.id = k, e.textContent = F, document.head.appendChild(e);
}
const m = 'text-anchor="middle" font-family="system-ui,-apple-system,sans-serif"', M = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <text x="12" y="11" ${m} font-size="13" font-weight="800">F</text>
  <text x="12" y="21" ${m} font-size="10" font-weight="700">-10</text>
</svg>`, X = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <text x="12" y="11" ${m} font-size="13" font-weight="800">F</text>
  <text x="12" y="21" ${m} font-size="10" font-weight="700">-1</text>
</svg>`, $ = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <text x="12" y="11" ${m} font-size="13" font-weight="800">F</text>
  <text x="12" y="21" ${m} font-size="10" font-weight="700">+1</text>
</svg>`, _ = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <text x="12" y="11" ${m} font-size="13" font-weight="800">F</text>
  <text x="12" y="21" ${m} font-size="10" font-weight="700">+10</text>
</svg>`, V = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M9 3L7.17 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2h-3.17L15 3H9z"/>
  <circle cx="12" cy="13" r="3.5"/>
</svg>`, L = {
  en: {
    "framestepper.back10": "Back 10 frames",
    "framestepper.back1": "Back 1 frame",
    "framestepper.forward1": "Forward 1 frame",
    "framestepper.forward10": "Forward 10 frames",
    "screenshot.button": "Screenshot",
    "screenshot.subtitles": "Include subtitles",
    "osd.brightness": "Brightness",
    "osd.volume": "Volume",
    "screenshot.drm": "DRM-protected content cannot be captured",
    "screenshot.srt": "SRT/VTT subtitles cannot be included in screenshot",
    "screenshot.saved": "Screenshot saved"
  },
  zh: {
    "framestepper.back10": "后退 10 帧",
    "framestepper.back1": "后退 1 帧",
    "framestepper.forward1": "前进 1 帧",
    "framestepper.forward10": "前进 10 帧",
    "screenshot.button": "截图",
    "screenshot.subtitles": "包含字幕",
    "osd.brightness": "亮度",
    "osd.volume": "音量",
    "screenshot.drm": "受版权保护的内容无法截图",
    "screenshot.srt": "SRT/VTT 字幕无法包含在截图中",
    "screenshot.saved": "截图已保存"
  },
  ja: {
    "framestepper.back10": "10フレーム戻る",
    "framestepper.back1": "1フレーム戻る",
    "framestepper.forward1": "1フレーム進む",
    "framestepper.forward10": "10フレーム進む",
    "screenshot.button": "スクリーンショット",
    "screenshot.subtitles": "字幕を含める",
    "osd.brightness": "明るさ",
    "osd.volume": "音量",
    "screenshot.drm": "DRMで保護されたコンテンツはキャプチャできません",
    "screenshot.srt": "SRT/VTT字幕はスクリーンショットに含められません",
    "screenshot.saved": "スクリーンショットを保存しました"
  }
};
function Y() {
  const n = (document.documentElement.lang || navigator.language || "en").toLowerCase().split("-")[0];
  return n === "zh" ? "zh" : n === "ja" ? "ja" : "en";
}
const A = Y();
function h(e) {
  return L[A][e] ?? L.en[e] ?? e;
}
const S = /* @__PURE__ */ new Map();
async function D(e) {
  var t, r, c, o;
  const n = S.get(e);
  if (n !== void 0) return n;
  try {
    const a = await ((t = window.ApiClient) == null ? void 0 : t.getJSON(
      `/Items/${e}?Fields=MediaSources`
    )), s = (o = (c = (r = a == null ? void 0 : a.MediaSources) == null ? void 0 : r[0]) == null ? void 0 : c.MediaStreams) == null ? void 0 : o.find(
      (i) => i.Type === "Video"
    ), l = (s == null ? void 0 : s.RealFrameRate) ?? (s == null ? void 0 : s.AverageFrameRate) ?? 24;
    return S.set(e, l), l;
  } catch {
    return 24;
  }
}
function H(e, n, t) {
  return Math.max(n, Math.min(t, e));
}
function x(e, n) {
  const t = document.createElement("button");
  return t.className = "jfs-enhancer-btn", t.title = n, t.innerHTML = e, t;
}
function P() {
  const e = document.createElement("div");
  return e.className = "jfs-enhancer-framestep-wrap", e.style.cssText = "display:inline-flex;align-items:center;", e.appendChild(x(M, h("framestepper.back10"))), e.appendChild(x(X, h("framestepper.back1"))), e.appendChild(x($, h("framestepper.forward1"))), e.appendChild(x(_, h("framestepper.forward10"))), e;
}
async function w(e, n, t) {
  const r = await D(t);
  e.paused || e.pause(), e.currentTime = H(
    e.currentTime + n / r,
    0,
    e.duration || 0
  );
}
function W(e) {
  return e.replace(/[^\w一-鿿぀-ヿ가-힯\- ]/g, "_").trim() || "screenshot";
}
function q(e) {
  const n = document.createElement("div");
  n.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:rgba(0,0,0,0.8);color:#fff;padding:10px 18px;border-radius:6px;
    font-size:14px;z-index:99999;pointer-events:none;
  `, n.textContent = e, document.body.appendChild(n), setTimeout(() => n.remove(), 3e3);
}
function U(e, n) {
  const t = URL.createObjectURL(e), r = document.createElement("a");
  r.href = t, r.download = n, r.click(), URL.revokeObjectURL(t);
}
async function K(e, n, t) {
  const r = e.videoWidth, c = e.videoHeight;
  if (!r || !c) return;
  const o = new OffscreenCanvas(r, c), a = o.getContext("2d");
  if (!a) return;
  try {
    a.drawImage(e, 0, 0, r, c);
  } catch (i) {
    if (i instanceof DOMException && i.name === "SecurityError") {
      q(h("screenshot.drm"));
      return;
    }
    throw i;
  }
  if (n) {
    const i = document.querySelector(
      ".libassjs-canvas-parent canvas"
    );
    if (i)
      try {
        a.drawImage(i, 0, 0, r, c);
      } catch {
      }
  }
  const s = await o.convertToBlob({ type: "image/png" }), l = W(t ?? "screenshot");
  U(s, `jellyfin-screenshot-${l}-${Date.now()}.png`);
}
function R() {
  return document.querySelector(".videoPlayerContainer") ?? document.body;
}
function z(e, n) {
  var s;
  (s = document.querySelector(".jfs-enhancer-ripple")) == null || s.remove();
  const t = document.createElement("div");
  t.className = `jfs-enhancer-ripple jfs-enhancer-ripple-${e}`;
  const r = document.createElement("div");
  r.className = "jfs-enhancer-ripple-bg";
  const c = document.createElement("div");
  c.className = "jfs-enhancer-ripple-arrows";
  const o = e === "right" ? "›" : "‹";
  for (let l = 0; l < 3; l++) {
    const i = document.createElement("span");
    i.className = "jfs-enhancer-ripple-arrow", i.textContent = o, c.appendChild(i);
  }
  const a = document.createElement("div");
  a.className = "jfs-enhancer-ripple-label", a.textContent = n, r.appendChild(c), r.appendChild(a), t.appendChild(r), R().appendChild(t), setTimeout(() => t.remove(), 1e3);
}
let b = null, d = null;
function N(e, n) {
  d || (d = document.createElement("div"), d.className = "jfs-enhancer-osd", R().appendChild(d));
  const t = e === "brightness" ? "☀" : "🔊", r = h(e === "brightness" ? "osd.brightness" : "osd.volume");
  d.textContent = "";
  const c = document.createElement("div");
  c.style.fontSize = "22px", c.textContent = t;
  const o = document.createElement("div");
  o.textContent = `${r} ${Math.round(n)}%`, d.appendChild(c), d.appendChild(o), d.style.opacity = "1", b && clearTimeout(b), b = setTimeout(() => {
    d && (d.style.opacity = "0"), b = null;
  }, 1500);
}
function B(e, n, t) {
  return Math.max(n, Math.min(t, e));
}
function G(e, n) {
  if (navigator.maxTouchPoints <= 0) return;
  let t = { time: 0, zone: "center" };
  const r = { active: !1, startX: 0, startY: 0, side: "left", startValue: 1, directionLock: null }, c = e.closest(".videoPlayerContainer") ?? document.body;
  c.addEventListener("touchend", (o) => {
    const a = o.changedTouches[0];
    if (!a) return;
    const s = Date.now(), l = a.clientX, i = window.innerWidth, p = l < i / 3 ? "left" : l < i * 2 / 3 ? "center" : "right";
    s - t.time < 300 && p === t.zone ? (o.stopPropagation(), o.preventDefault(), p === "left" ? (e.currentTime = Math.max(0, e.currentTime - 10), z("left", "-10s")) : p === "right" ? (e.currentTime = Math.min(e.duration || 0, e.currentTime + 10), z("right", "+10s")) : e.paused ? e.play().catch(() => {
    }) : e.pause(), t = { time: 0, zone: "center" }) : t = { time: s, zone: p };
  }, { capture: !0, passive: !1 }), c.addEventListener("touchstart", (o) => {
    if (o.touches.length !== 1) return;
    const a = o.touches[0], s = a.clientX < window.innerWidth / 2 ? "left" : "right";
    r.active = !0, r.startX = a.clientX, r.startY = a.clientY, r.side = s, r.directionLock = null, r.startValue = s === "left" ? parseFloat(e.style.filter.replace("brightness(", "").replace(")", "") || "1") : e.volume;
  }, { passive: !0 }), c.addEventListener("touchmove", (o) => {
    if (!r.active || o.touches.length !== 1) return;
    const a = o.touches[0], s = Math.abs(a.clientX - r.startX), l = Math.abs(a.clientY - r.startY);
    if (r.directionLock === null && (s > 10 || l > 10) && (r.directionLock = l >= s ? "vertical" : "horizontal"), r.directionLock !== "vertical") return;
    const p = (r.startY - a.clientY) / (window.innerHeight * 0.5);
    if (r.side === "left") {
      const f = B(r.startValue + p, 0, 2);
      e.style.filter = `brightness(${f})`, N("brightness", f * 100);
    } else {
      const f = B(r.startValue + p, 0, 1);
      e.volume = f, N("volume", f * 100);
    }
    o.preventDefault();
  }, { passive: !1 }), c.addEventListener("touchend", () => {
    r.active = !1;
  }, { passive: !0 });
}
const v = "jfs-enhancer-root";
let E = null, u = null, j = null, C = !1;
function J(e, n) {
  I(), u = e, n.on(e, "playbackstart", () => {
    var t;
    j && (j.style.filter = ""), C = !1, (t = document.getElementById(v)) == null || t.remove(), y();
  }), E = new MutationObserver(() => y()), E.observe(document.body, { childList: !0, subtree: !0 }), y();
}
function y() {
  const e = document.querySelector(".videoPlayerContainer");
  if (!e) return;
  const n = e.querySelector("video.htmlvideoplayer");
  if (n) {
    if (j = n, !document.getElementById(v)) {
      const t = document.createElement("div");
      t.id = v, e.appendChild(t);
    }
    if (!C) {
      const t = e.querySelector(
        ".osdControls .buttons.focuscontainer-x"
      );
      t && (Q(t, n), u && G(n), C = !0);
    }
  }
}
function Q(e, n) {
  const t = P(), [r, c, o, a] = Array.from(
    t.querySelectorAll("button")
  ), s = () => {
    var g;
    return ((g = u == null ? void 0 : u.currentItem()) == null ? void 0 : g.Id) ?? "";
  };
  r.addEventListener("click", () => w(n, -10, s())), c.addEventListener("click", () => w(n, -1, s())), o.addEventListener("click", () => w(n, 1, s())), a.addEventListener("click", () => w(n, 10, s())), e.prepend(t);
  const l = document.createElement("div");
  l.className = "jfs-enhancer-screenshot-wrap";
  const i = document.createElement("button");
  i.className = "jfs-enhancer-btn", i.title = h("screenshot.button"), i.innerHTML = V;
  const p = document.createElement("label");
  p.className = "jfs-enhancer-switch";
  const f = document.createElement("input");
  f.type = "checkbox", f.checked = !1;
  const O = document.createTextNode(h("screenshot.subtitles"));
  p.appendChild(f), p.appendChild(O), i.addEventListener("click", () => {
    var T;
    const g = (T = u == null ? void 0 : u.currentItem()) == null ? void 0 : T.Name;
    K(n, f.checked, g);
  }), l.appendChild(i), l.appendChild(p), e.prepend(l);
}
class Z {
  constructor({ playbackManager: n, events: t }) {
    I(), J(n, t);
  }
}
export {
  Z as default
};
