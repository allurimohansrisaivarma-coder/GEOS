// Floating simulation panel: drag it anywhere, minimise it to a circular button (which keeps showing progress),
// and remember where it was left. Also the plant picker that lives inside it.

import { $, esc, safeStorage } from './dom.js';
import { ICON } from './icons.js';

const store = safeStorage();
const isNarrow = () => matchMedia('(max-width: 900px)').matches;

export function initSimPanel({ onOpenChange } = {}) {
  const root = $('#sim');
  const card = $('#sim-card');
  const fab = $('#sim-fab');
  let open = true;
  let shiftPx = 0;
  let suppressClick = false;
  let pos = { x: 20, y: 20 };
  try {
    const p = JSON.parse(store.get('geos.sim.pos', 'null'));
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) pos = p;
  } catch { /* keep default */ }

  $('#sim-grip').innerHTML = ICON.grip;
  $('#sim-min').innerHTML = ICON.minus;
  $('#fab-open').innerHTML = ICON.expand;

  const size = () => { const el = open ? card : fab; return { w: el.offsetWidth, h: el.offsetHeight }; };
  function clamp() {
    const { w, h } = size();
    pos.x = Math.min(Math.max(8, pos.x), Math.max(8, innerWidth - w - 8));
    pos.y = Math.min(Math.max(8, pos.y), Math.max(8, innerHeight - h - 8));
  }
  function apply() {
    root.style.setProperty('--sx', `${Math.round(pos.x)}px`);
    root.style.setProperty('--sy', `${Math.round(pos.y)}px`);
  }
  const save = () => store.set('geos.sim.pos', JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }));

  function setOpen(v, { focus = false, persist = true } = {}) {
    open = !!v;
    root.dataset.open = String(open);
    card.inert = !open;
    fab.inert = open;
    $('#sim-min').setAttribute('aria-expanded', String(open));
    $('#fab-open').setAttribute('aria-expanded', String(open));
    if (persist) store.set('geos.sim.open', open ? '1' : '0');
    clamp(); apply();
    if (focus) (open ? $('#play') : $('#fab-play')).focus({ preventScroll: true });
    onOpenChange?.(open);
  }

  /** Slide the panel left so it never hides behind the notifications drawer. */
  function avoid(drawerWidth) {
    if (!drawerWidth || isNarrow()) { shiftPx = 0; root.style.setProperty('--shift', '0px'); return; }
    const { w } = size();
    const left = innerWidth - pos.x - w;
    const overlap = Math.max(0, innerWidth - pos.x - (innerWidth - drawerWidth - 12));
    shiftPx = Math.min(overlap, Math.max(0, left - 8));
    root.style.setProperty('--shift', `${-shiftPx}px`);
  }

  // dragging: start from the header (expanded) or anywhere on the circle (minimised), 5px threshold so clicks still work
  function draggable(handle, ignore) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || isNarrow() || (ignore && e.target.closest(ignore))) return;
      const sx = e.clientX, sy = e.clientY;
      let moved = false, ox = 0, oy = 0;
      const move = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved) {
          if (Math.hypot(dx, dy) < 5) return;
          moved = true;
          root.classList.add('dragging');
          if (shiftPx) { pos.x += shiftPx; shiftPx = 0; root.style.setProperty('--shift', '0px'); } // bake the drawer shift into the position
          ox = pos.x; oy = pos.y;
        }
        // offsets are measured from the right/bottom edges, so moving the pointer right/down shrinks them
        pos.x = ox - dx; pos.y = oy - dy;
        clamp(); apply();
        ev.preventDefault();
      };
      const up = () => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        if (moved) {
          root.classList.remove('dragging'); save();
          suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
          onOpenChange?.(open);
        }
      };
      addEventListener('pointermove', move, { passive: false });
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    });
  }
  draggable($('#sim-handle'), 'button');
  draggable(fab);
  root.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);

  $('#sim-min').onclick = () => setOpen(false, { focus: true });
  $('#fab-open').onclick = () => setOpen(true, { focus: true });
  addEventListener('resize', () => { clamp(); apply(); onOpenChange?.(open); });
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '') && !document.querySelector('dialog[open]')) {
      setOpen(!open, { focus: true });
    }
  });

  // ?sim=min|open overrides; otherwise the remembered state; otherwise open on desktop and minimised on phones
  const forced = new URLSearchParams(location.search).get('sim');
  const stored = store.get('geos.sim.open', null);
  setOpen(forced ? forced !== 'min' : stored != null ? stored !== '0' : !isNarrow(), { persist: false });

  return { setOpen, isOpen: () => open, avoid };
}

// ------------------------------------------------------------------ plant picker (custom listbox: name + kind/place, keyboard friendly)
export function initPlantPicker({ plants, onPick }) {
  const btn = $('#plant-btn');
  const list = $('#plant-list');
  let value = null;
  let active = 0;

  list.innerHTML = plants.map((p) => `<li class="dd-item" role="option" id="po-${p.id}" data-id="${p.id}" aria-selected="false">
      <span class="dd-ico">${ICON[p.icon]}</span>
      <span class="dd-txt"><b>${esc(p.name)}</b><small>${esc(p.kind)} · ${esc(p.place)}</small></span>${p.scenario ? '' : '<span class="tag">Live</span>'}</li>`).join('');

  const items = () => [...list.children];
  const isOpen = () => !list.hidden;
  function paint() {
    items().forEach((li, i) => { li.dataset.active = String(i === active); li.setAttribute('aria-selected', String(li.dataset.id === value)); });
    list.setAttribute('aria-activedescendant', items()[active]?.id || '');
  }
  function open() {
    active = Math.max(0, plants.findIndex((p) => p.id === value));
    list.hidden = false; btn.setAttribute('aria-expanded', 'true'); paint(); list.focus({ preventScroll: true });
  }
  function close(refocus = true) {
    list.hidden = true; btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus({ preventScroll: true });
  }
  function pick(id) { close(); if (id !== value) onPick(id); }

  btn.onclick = () => (isOpen() ? close() : open());
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } });
  list.addEventListener('keydown', (e) => {
    const n = plants.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % n; paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + n) % n; paint(); }
    else if (e.key === 'Home') { e.preventDefault(); active = 0; paint(); }
    else if (e.key === 'End') { e.preventDefault(); active = n - 1; paint(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(plants[active].id); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
  });
  list.addEventListener('click', (e) => { const li = e.target.closest('.dd-item'); if (li) pick(li.dataset.id); });
  list.addEventListener('pointermove', (e) => { const li = e.target.closest('.dd-item'); if (li) { active = items().indexOf(li); paint(); } });
  document.addEventListener('pointerdown', (e) => { if (isOpen() && !e.target.closest('#dd-plant')) close(false); });

  return {
    set(plant) {
      value = plant.id;
      btn.innerHTML = `<span class="dd-ico">${ICON[plant.icon]}</span><span class="dd-txt"><b>${esc(plant.name)}</b><small>${esc(plant.kind)} · ${esc(plant.place)}</small></span><span class="dd-chev">${ICON.chevron}</span>`;
      paint();
    },
    open,
    focus: () => btn.focus({ preventScroll: true }),
  };
}
