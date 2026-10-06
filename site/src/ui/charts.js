// Dependency-free SVG line chart following the dataviz spec: 2px lines, hairline recessive grid,
// area washes at ~10-18% opacity, >=8px end markers with a 2px surface ring, a crosshair that snaps
// to the nearest sample, one tooltip listing every series, and a table-view twin.

import { esc } from './dom.js';

function niceTicks(lo, hi, count = 5) {
  const span = hi - lo || 1;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

const pathOf = (pts, X, Y) => {
  let d = '', pen = false;
  for (const p of pts) {
    if (p[1] == null || !Number.isFinite(p[1])) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`;
    pen = true;
  }
  return d;
};

export class LineChart {
  /**
   * @param {HTMLElement} el container (the chart builds its own svg + tooltip inside)
   * @param {object} o {height, margin, xFormat, yFormat, yUnit, ariaLabel, xTick}
   */
  constructor(el, o = {}) {
    this.el = el;
    this.o = { height: 230, margin: { l: 44, r: 70, t: 12, b: 26 }, xFormat: (v) => String(Math.round(v)), yFormat: (v) => v.toFixed(1), xTick: 60, ...o };
    this.data = null;
    this.hover = null;
    this.tableMode = false;
    this.uid = `cp${Math.random().toString(36).slice(2, 8)}`;
    el.classList.add('chart-wrap');
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', o.ariaLabel || 'chart');
    this.tt = document.createElement('div');
    this.tt.className = 'tt';
    this.tt.setAttribute('aria-hidden', 'true');
    this.table = document.createElement('div');
    this.table.className = 'tbl-wrap';
    this.table.hidden = true;
    el.append(this.svg, this.tt, this.table);
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(el);
    this.svg.addEventListener('pointermove', (e) => this._move(e));
    this.svg.addEventListener('pointerleave', () => { this.hover = null; this.tt.style.opacity = 0; this.render(); });
    this.svg.setAttribute('tabindex', '0');
    this.svg.addEventListener('keydown', (e) => this._key(e));
    this.svg.addEventListener('focus', () => { if (this.hover == null && this.data) this.hover = this.data.nowX; this._showAt(this.hover); this.render(); });
    this.svg.addEventListener('blur', () => { this.hover = null; this.tt.style.opacity = 0; this.render(); });
  }

  setData(data) { this.data = data; this.render(); }
  setTable(on) { this.tableMode = on; this.svg.style.display = on ? 'none' : ''; this.table.hidden = !on; this.render(); }

  _dims() {
    const W = Math.max(280, this.el.clientWidth || 600);
    return { W, H: this.o.height };
  }
  _scales() {
    const { W, H } = this._dims();
    const m = this.o.margin, d = this.data;
    const [x0, x1] = d.xDomain, [y0, y1] = d.yDomain;
    const X = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
    return { W, H, m, X, Y, x0, x1, y0, y1 };
  }

  _nearest(x) {
    const d = this.data;
    const base = d.series.find((s) => s.primary) || d.series[0];
    if (!base) return x;
    let best = null, bd = Infinity;
    for (const p of base.points) { const dd = Math.abs(p[0] - x); if (dd < bd) { bd = dd; best = p[0]; } }
    return best ?? x;
  }

  _move(e) {
    if (!this.data) return;
    const { W, m, x0, x1 } = this._scales();
    const rect = this.svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const x = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    this.hover = this._nearest(Math.min(x1, Math.max(x0, x)));
    this.render();
    this._showAt(this.hover, e);
  }

  _key(e) {
    if (!this.data || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const base = this.data.series.find((s) => s.primary) || this.data.series[0];
    const xs = base.points.map((p) => p[0]);
    let i = xs.findIndex((v) => v === (this.hover ?? this.data.nowX));
    if (i < 0) i = xs.length - 1;
    i = Math.min(xs.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1) * 5));
    this.hover = xs[i];
    this.render();
    this._showAt(this.hover);
  }

  _valueAt(s, x) {
    let best = null, bd = Infinity;
    for (const p of s.points) { const dd = Math.abs(p[0] - x); if (dd < bd && p[1] != null) { bd = dd; best = p; } }
    return bd <= 1.5 ? best[1] : null;
  }

  _showAt(x) {
    if (x == null || !this.data) return;
    const { W, m, X } = this._scales();
    const rows = this.data.series
      .map((s) => ({ s, v: this._valueAt(s, x) }))
      .filter((r) => r.v != null && !r.s.noTip);
    const bandRow = (this.data.bands || []).find((b) => b.tip);
    let band = '';
    if (bandRow) {
      const p = bandRow.points.find((q) => Math.abs(q[0] - x) <= 0.5);
      if (p) band = `<div class="row"><span>${esc(bandRow.label)}: ${this.o.yFormat(p[1])} to ${this.o.yFormat(p[2])}${this.o.yUnit || ''}</span></div>`;
    }
    this.tt.innerHTML = `<div class="t0">${esc(this.o.xFormat(x))}${this.data.tipSuffix ? ' ' + esc(this.data.tipSuffix(x)) : ''}</div>` +
      rows.map((r) => `<div class="row" style="--c:${r.s.color}"><i></i><b>${this.o.yFormat(r.v)}${this.o.yUnit || ''}</b><span>${esc(r.s.label)}</span></div>`).join('') + band;
    const wrapW = this.el.clientWidth;
    const left = (X(x) / W) * wrapW;
    this.tt.style.left = `${Math.min(wrapW - 170, Math.max(4, left + 12))}px`;
    this.tt.style.top = `${m.t + 6}px`;
    this.tt.style.opacity = 1;
  }

  render() {
    const d = this.data;
    if (!d) return;
    if (this.tableMode) return this._renderTable();
    const { W, H, m, X, Y, y0, y1, x0, x1 } = this._scales();
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.setAttribute('height', H);
    const out = [];
    const plotR = W - m.r, plotB = H - m.b;

    // grid + y ticks
    for (const v of d.yTicks || niceTicks(y0, y1, 4)) {
      const y = Y(v).toFixed(1);
      out.push(`<line x1="${m.l}" x2="${plotR}" y1="${y}" y2="${y}" stroke="var(--grid)" stroke-width="1"/>`);
      out.push(`<text class="ax" x="${m.l - 8}" y="${+y + 4}" text-anchor="end">${this.o.yFormat(v)}</text>`);
    }
    // x ticks
    const step = d.xTick || this.o.xTick;
    for (let v = Math.ceil(x0 / step) * step; v <= x1 + 1e-9; v += step) {
      const x = X(v).toFixed(1);
      out.push(`<line x1="${x}" x2="${x}" y1="${plotB}" y2="${plotB + 4}" stroke="var(--axis)" stroke-width="1"/>`);
      out.push(`<text class="ax" x="${x}" y="${plotB + 17}" text-anchor="middle">${esc(this.o.xFormat(v))}</text>`);
    }
    out.push(`<line x1="${m.l}" x2="${plotR}" y1="${plotB}" y2="${plotB}" stroke="var(--axis)" stroke-width="1"/>`);

    // everything that scrolls with time is clipped to the plot area
    out.push(`<defs><clipPath id="${this.uid}"><rect x="${m.l}" y="${m.t - 4}" width="${plotR - m.l}" height="${plotB - m.t + 8}"/></clipPath></defs><g clip-path="url(#${this.uid})">`);

    // bands (washes)
    for (const b of d.bands || []) {
      if (!b.points.length) continue;
      const top = b.points.map((p) => `${X(p[0]).toFixed(1)} ${Y(p[2]).toFixed(1)}`);
      const bot = [...b.points].reverse().map((p) => `${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`);
      out.push(`<path d="M${top.join('L')}L${bot.join('L')}Z" fill="${b.color}" fill-opacity="${b.opacity ?? 0.12}"/>`);
    }
    out.push('</g>');
    // threshold lines (hairline, labelled at right)
    for (const hl of d.hlines || []) {
      if (hl.y < y0 || hl.y > y1) continue;
      const y = Y(hl.y).toFixed(1);
      out.push(`<line x1="${m.l}" x2="${plotR}" y1="${y}" y2="${y}" stroke="${hl.color || 'var(--axis)'}" stroke-width="1" stroke-opacity="0.9"/>`);
      if (hl.label) {
        out.push(`<circle cx="${plotR + 8}" cy="${y}" r="3.5" fill="${hl.color || 'var(--muted)'}"/>`);
        out.push(`<text class="lbl" x="${plotR + 15}" y="${+y + 4}">${esc(hl.label)}</text>`);
      }
    }
    // "now" marker
    if (d.nowX != null && d.nowX >= x0 && d.nowX <= x1) {
      const x = X(d.nowX).toFixed(1);
      out.push(`<line x1="${x}" x2="${x}" y1="${m.t}" y2="${plotB}" stroke="var(--ink-2)" stroke-width="1" stroke-opacity="0.55"/>`);
      out.push(`<text class="ax" x="${x}" y="${m.t - 2}" text-anchor="middle">now</text>`);
    }
    // vertical event markers on the axis
    for (const v of d.vlines || []) {
      if (v.x < x0 || v.x > x1) continue;
      const x = X(v.x).toFixed(1);
      out.push(`<line x1="${x}" x2="${x}" y1="${plotB - 12}" y2="${plotB}" stroke="${v.color}" stroke-width="3" stroke-linecap="round"><title>${esc(v.label || '')}</title></line>`);
    }
    out.push(`<g clip-path="url(#${this.uid})">`);
    // series
    for (const s of d.series) {
      if (s.dots) {
        for (const p of s.points) {
          if (p[1] == null) continue;
          out.push(`<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="${s.r || 1.8}" fill="${s.color}" fill-opacity="${s.opacity ?? 0.55}"/>`);
        }
        continue;
      }
      const dp = pathOf(s.points, X, Y);
      if (!dp) continue;
      out.push(`<path d="${dp}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}${s.opacity != null ? ` stroke-opacity="${s.opacity}"` : ''}/>`);
    }
    // end markers (>=8px with a 2px surface ring) + selective direct labels
    for (const s of d.series) {
      if (!s.endDot || s.dots) continue;
      const last = [...s.points].reverse().find((p) => p[1] != null);
      if (!last) continue;
      const cx = X(last[0]).toFixed(1), cy = Y(last[1]).toFixed(1);
      out.push(`<circle cx="${cx}" cy="${cy}" r="6" fill="var(--surface)"/><circle cx="${cx}" cy="${cy}" r="4.5" fill="${s.color}"/>`);
    }
    out.push('</g>');
    // crosshair
    if (this.hover != null) {
      const x = X(this.hover).toFixed(1);
      out.push(`<line x1="${x}" x2="${x}" y1="${m.t}" y2="${plotB}" stroke="var(--ink)" stroke-width="1" stroke-opacity="0.5"/>`);
      for (const s of d.series) {
        if (s.dots || s.noTip) continue;
        const v = this._valueAt(s, this.hover);
        if (v == null) continue;
        out.push(`<circle cx="${x}" cy="${Y(v).toFixed(1)}" r="6" fill="var(--surface)"/><circle cx="${x}" cy="${Y(v).toFixed(1)}" r="4" fill="${s.color}"/>`);
      }
    }
    this.svg.innerHTML = out.join('');
  }

  _renderTable() {
    const d = this.data;
    const step = d.tableStep || 5;
    const xs = [];
    const base = d.series.find((s) => s.primary) || d.series[0];
    for (const p of base.points) if (Math.round(p[0]) % step === 0) xs.push(p[0]);
    const cols = d.series.filter((s) => !s.noTip);
    let html = `<table class="data"><thead><tr><th>${esc(d.xLabel || 'Time')}</th>${cols.map((s) => `<th>${esc(s.label)}</th>`).join('')}</tr></thead><tbody>`;
    for (const x of xs) {
      html += `<tr><td>${esc(this.o.xFormat(x))}</td>${cols.map((s) => { const v = this._valueAt(s, x); return `<td>${v == null ? '-' : this.o.yFormat(v)}</td>`; }).join('')}</tr>`;
    }
    html += '</tbody></table>';
    this.table.innerHTML = html;
  }
}

/**
 * Tiny sparkline as an SVG string (no interaction; the card carries the value as text).
 * `null` values break the line (a gap means "no reading"); `ref` is an optional reference line.
 */
export function sparkline(values, { w = 78, h = 24, color = 'var(--s1)', lo = 36.8, hi = 39.2, ref = 38.5, refColor = 'var(--serious)' } = {}) {
  if (!values.length) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const n = values.length;
  const X = (i) => (n === 1 ? w - 3 : (i / (n - 1)) * (w - 6) + 1);
  const Y = (v) => h - 2 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - 4);
  let d = '', pen = false, lastI = -1;
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`;
    pen = true; lastI = i;
  });
  const refLine = ref != null ? `<line x1="0" x2="${w}" y1="${Y(ref).toFixed(1)}" y2="${Y(ref).toFixed(1)}" stroke="${refColor}" stroke-opacity="0.7" stroke-width="1"/>` : '';
  const dot = lastI >= 0 ? `<circle cx="${X(lastI).toFixed(1)}" cy="${Y(values[lastI]).toFixed(1)}" r="3" fill="${color}"/>` : '';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">${refLine}<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>${dot}</svg>`;
}
