export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Set text only when it changed (cheap per-frame HUD updates). */
export function setText(el, text) {
  if (el._t !== text) {
    el._t = text;
    el.textContent = text;
  }
}

export function setStyle(el, prop, value) {
  const key = `_s_${prop}`;
  if (el[key] !== value) {
    el[key] = value;
    el.style[prop] = value;
  }
}

export function setClass(el, cls, on) {
  const key = `_c_${cls}`;
  if (el[key] !== on) {
    el[key] = on;
    el.classList.toggle(cls, on);
  }
}
