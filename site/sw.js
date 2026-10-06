// Service worker: makes the dashboard work with no network (remote sites have none).
// Strategy: network-first with cache fallback for our own files (always fresh when online, still works offline);
// third-party weather requests are never cached here - the app falls back to its own bundled snapshot.

const CACHE = 'geos-v4';
const CORE = [
  './', 'index.html', 'styles.css', 'flow.css', 'manifest.webmanifest', 'icon.svg',
  'src/main.js', 'src/plants.js', 'src/ui/dom.js', 'src/ui/icons.js', 'src/ui/charts.js', 'src/ui/views.js', 'src/ui/simpanel.js', 'src/ui/notifications.js', 'src/ui/sensors.js', 'src/engine/cold.js',
  'src/engine/psychro.js', 'src/engine/solar.js', 'src/engine/wbgt.js', 'src/engine/limits.js', 'src/engine/qc.js',
  'src/engine/cusum.js', 'src/engine/estimator.js', 'src/engine/strain.js', 'src/engine/dose.js', 'src/engine/alerts.js', 'src/engine/pipeline.js',
  'src/sim/rng.js', 'src/sim/physiology.js', 'src/sim/scenarios.js', 'src/sim/cohort.js', 'src/live/openmeteo.js',
  'data/benchmark.json', 'data/snapshots.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // let weather APIs go to the network (or fail fast)
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((m) => m || caches.match('index.html')))
  );
});
