// Tiny DOM helpers. All dynamic text goes through esc() or textContent - labels are treated as untrusted.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

export const f1 = (x, d = 1) => (x == null || !Number.isFinite(x) ? '--' : x.toFixed(d));

/** minutes since scenario start -> "HH:MM" local clock */
export function clock(startLocalH, minute) {
  const m = Math.round(startLocalH * 60 + minute);
  const hh = ((Math.floor(m / 60) % 24) + 24) % 24;
  return `${String(hh).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
}

export function safeStorage() {
  return {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage may be blocked */ } },
  };
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
