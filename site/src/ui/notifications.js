// Notification centre: every warning raised for a worker (and every serious site detection) lands here instead of
// popping up over the dashboard. The bell shows how many are unread. The feed is derived from the run log up to the
// current moment, so scrubbing back in time removes what has not happened yet and the unread count follows.

import { $, esc, clock } from './dom.js';
import { ICON, LEVEL_ICON } from './icons.js';

const nameOf = (S, id) => S.scn.workers.find((w) => w.profile.id === id)?.profile.name || id;

/** "Dust front detected: PM10 85 to 812 ug/m3 (CUSUM change-point)" -> title + detail, with nicer units. */
function splitSite(text) {
  const t = String(text)
    .replace(/,? ?CUSUM change-point/, '').replace(/\(\s*\)/, '').replace(/ug\/m3/g, 'µg/m³').replace(/(\d) C\b/g, '$1 °C').trim();
  let m = t.match(/^([^:(]+):\s*(.+)$/);
  if (m) return { title: m[1].trim(), why: m[2].trim() };
  m = t.match(/^([^(]+)\(([^)]+)\)\s*$/);
  if (m) return { title: m[1].trim(), why: m[2].trim() };
  return { title: t, why: '' };
}

export function collectNotifications(S) {
  const out = [];
  for (const l of S.runs[S.mode].log) {
    if (l.t > S.idx) break;
    if (l.kind === 'alert') {
      if (l.to > l.from && l.to >= 2) {
        out.push({ key: `${S.mode}|${l.t}|${l.id}|${l.to}`, kind: 'worker', t: l.t, level: l.to, id: l.id, title: l.title, why: l.reasons?.[0] || '', act: l.actions?.[0] || '' });
      }
    } else if (l.kind === 'site' && (l.severity ?? 0) >= 1) {
      const s = splitSite(l.text);
      out.push({ key: `${S.mode}|${l.t}|site|${l.text.slice(0, 20)}`, kind: 'site', t: l.t, level: l.severity >= 2 ? 2 : 1, id: null, title: s.title, why: s.why, act: '' });
    }
  }
  for (const n of S.sys) if (n.t <= S.idx) out.push({ key: n.key, kind: 'sys', t: n.t, level: 0, id: null, title: n.title, why: n.why, act: n.ticket ? 'Open ticket' : '', ticket: n.ticket || '', silent: true });
  out.sort((a, b) => b.t - a.t || b.level - a.level);
  return out;
}

const isUnread = (S, n) => !n.silent && !S.read.has(n.key);

let lastUnread = 0;
let lastSig = '';
let known = new Set();

const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

export function resetNotifications() { lastUnread = 0; lastSig = ''; known = new Set(); }

export function renderNotifications(S, list) {
  const unread = list.filter((n) => isUnread(S, n)).length;

  // bell badge
  const badge = $('#bell-count'), bell = $('#btn-bell');
  badge.hidden = unread === 0;
  badge.textContent = unread > 99 ? '99+' : String(unread);
  if (unread > lastUnread) { replay(badge, 'bump'); replay(bell, 'ring'); }
  lastUnread = unread;
  bell.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');

  // drawer header
  const chip = $('#notif-chip');
  chip.textContent = unread ? `${unread} new` : 'All read';
  chip.classList.toggle('zero', unread === 0);
  $('#notif-readall').disabled = unread === 0;
  const banner = $('#link-banner');
  banner.hidden = !S.blackout;
  if (S.blackout) banner.textContent = `Link down. Alerts stay on each device${S.relay.queued ? `; ${S.relay.queued} queued for relay` : ''}.`;

  // list (re-rendered only when something changed, so hover and scroll position survive playback)
  const shown = S.nFilter === 'unread' ? list.filter((n) => isUnread(S, n)) : list;
  const sig = `${S.plantId}|${S.src}|${S.nFilter}|${shown.map((n) => n.key + (isUnread(S, n) ? 'u' : 'r')).join(',')}`;
  if (sig === lastSig) return;
  lastSig = sig;
  const fresh = shown.filter((n) => !known.has(n.key));
  const flash = S.playing && fresh.length <= 3 ? new Set(fresh.map((n) => n.key)) : new Set();
  list.forEach((n) => known.add(n.key));

  $('#nlist').innerHTML = shown.length
    ? shown.map((n) => item(S, n, isUnread(S, n), flash.has(n.key))).join('')
    : `<li class="n-empty">${ICON.bell}<br>${S.nFilter === 'unread' && list.length ? 'You are all caught up.' : S.idx === 0 ? 'Nothing yet. Press play to start the shift.' : 'No alerts so far. Everyone is within range.'}</li>`;
}

function item(S, n, unread, fresh) {
  const icon = n.kind === 'sys' ? ICON.info : ICON[LEVEL_ICON[n.level]];
  const who = n.kind === 'worker' ? nameOf(S, n.id) : n.kind === 'site' ? 'Site' : 'System';
  return `<li><button type="button" class="nitem lv${n.level}${unread ? ' unread' : ''}${fresh ? ' fresh' : ''}${n.kind === 'sys' ? ' sys' : ''}" data-key="${esc(n.key)}" data-t="${n.t}" data-id="${esc(n.id || '')}" data-ticket="${esc(n.ticket || '')}">
    <span class="n-ico">${icon}</span>
    <span class="n-main">
      <span class="n-top"><span class="n-who">${esc(who)}</span><time class="n-time">${clock(S.scn.startLocalH, n.t)}</time></span>
      <span class="n-title">${esc(n.title)}</span>
      ${n.why ? `<span class="n-why">${esc(n.why)}</span>` : ''}
      ${n.act ? `<span class="n-act">${ICON.arrow}<span>${esc(n.act)}</span></span>` : ''}
    </span>
    <i class="n-dot" aria-hidden="true"></i></button></li>`;
}

/** Wires the bell, the drawer and its controls. `api.list()` must return the current notifications. */
export function initNotifications({ S, list, onJump, onToggle, onTicket, redraw }) {
  const drawer = $('#notif'), bell = $('#btn-bell');
  const isOpen = () => document.body.dataset.drawer === 'open';

  function open() {
    document.body.dataset.drawer = 'open';
    drawer.inert = false;
    bell.setAttribute('aria-expanded', 'true');
    onToggle?.(true);
    $('#notif-close').focus({ preventScroll: true });
  }
  function close(restoreFocus = true) {
    delete document.body.dataset.drawer;
    drawer.inert = true;
    bell.setAttribute('aria-expanded', 'false');
    onToggle?.(false);
    if (restoreFocus) bell.focus({ preventScroll: true });
  }
  drawer.inert = true;

  $('#notif-readall').innerHTML = `${ICON.checks}<span>Mark all read</span>`;
  $('#notif-close').innerHTML = ICON.close;
  bell.onclick = () => (isOpen() ? close() : open());
  $('#notif-close').onclick = () => close();
  $('#scrim').onclick = () => close(false);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen() && !document.querySelector('dialog[open]')) close(); });
  $('#notif-readall').onclick = () => { for (const n of list()) S.read.add(n.key); redraw(); };
  document.querySelectorAll('#notif-filter button').forEach((b) => {
    b.onclick = () => {
      S.nFilter = b.dataset.f;
      document.querySelectorAll('#notif-filter button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      redraw();
    };
  });
  $('#nlist').onclick = (e) => {
    const b = e.target.closest('.nitem');
    if (!b) return;
    S.read.add(b.dataset.key);
    if (b.dataset.ticket) { close(false); onTicket?.(b.dataset.ticket); redraw(); }
    else if (!b.classList.contains('sys')) onJump(Number(b.dataset.t), b.dataset.id || null);
    else redraw();
  };
  return { open, close, isOpen, toggle: () => (isOpen() ? close() : open()) };
}
