// Regenerates every image in docs/img (used by the README and the deck). Needs Microsoft Edge or Chrome and `npm start` running.
//   node scripts/screenshots.mjs                 all images
//   node scripts/screenshots.mjs sensors tickets only the named ones
// If the server is not on port 5173, set SHOT_PORT first (PowerShell: $env:SHOT_PORT = "3000").
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const browser = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(existsSync);
if (!browser) { console.error('Neither Microsoft Edge nor Chrome was found.'); process.exit(1); }
const base = `http://localhost:${process.env.SHOT_PORT || 5173}/?nosw=1&paused=1&anim=0`;
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'img');
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Click-through scripts for the shots that need a dialog open.
const raiseTickets = `(async () => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById('st1').click(); await w(300);
  document.querySelector('.srow.flag .s-head').click(); await w(200);
  document.querySelector('.srow.flag [data-ticket]').click(); await w(200);
  document.getElementById('tk-priority').value = 'High';
  document.getElementById('tk-note').value = 'Strap battery critical, swap before next shift';
  document.getElementById('tk-form').requestSubmit(); await w(300);
  document.getElementById('tk-sensor').value = 'pm'; document.getElementById('tk-sensor').dispatchEvent(new Event('change'));
  document.getElementById('tk-issue').value = 'Needs calibration'; document.getElementById('tk-priority').value = 'Low';
  document.getElementById('tk-form').requestSubmit(); await w(300);
  document.querySelector('#tk-list [data-adv]:not([data-done])').click(); await w(300);
})()`;
const openStrap = `(async () => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById('st1').click(); await w(300);
  document.querySelector('.srow.flag .s-head').click(); await w(300);
  document.querySelector('#dlg-sensors').scrollTop = 99999;
})()`;

// [name, query, width, height, scale, pre-script]. Dark theme unless the query says otherwise.
const SHOTS = [
  // full-page views (the floating simulation panel is part of the picture)
  ['dashboard-warning', 'plant=jaisalmer&t=16&worker=arjun', 1600, 1000],
  ['dashboard-full', 'plant=jaisalmer&t=95&worker=arjun&truth=1&sim=min', 1600, 1500],
  ['offshore-full', 'plant=platformb&t=146&worker=deepak', 1600, 1000],
  ['mine', 'plant=witbank&t=240&worker=thabo', 1600, 1000],
  ['arctic', 'plant=norilsk&t=200&worker=maxim', 1600, 1000],
  ['hr-lost', 'plant=jaisalmer&t=171&worker=ravi', 1600, 1000],
  ['live', 'plant=norilsk&mode=live&t=200&worker=irina', 1600, 1000],
  ['notifications', 'plant=platformb&t=146&worker=deepak&notif=1', 1600, 1000],
  ['sim-panel', 'plant=jaisalmer&t=95&worker=arjun&sim=open', 1600, 1000, 1, "document.getElementById('plant-btn').click()"],
  ['mobile', 'plant=jaisalmer&t=60&worker=arjun&sim=min', 430, 1500, 2],
  ['benchmark', 'bench=1', 1280, 1100],
  ['how-it-works', 'how=1&theme=light', 1280, 1100],
  // dialogs
  ['sensors', 'plant=jaisalmer&t=300&worker=arjun&sensors=1', 1280, 900],
  ['sensor-detail', 'plant=jaisalmer&t=300&worker=arjun', 1280, 900, 1, openStrap],
  ['tickets', 'plant=jaisalmer&t=300&worker=arjun', 1280, 900, 1, raiseTickets],
  // focused panels, narrow and at 2x so text stays legible on a slide
  ['pipeline', 't=95&focus=pipeline', 1000, 215, 2],
  ['crew', 't=95&focus=crew', 372, 560, 2],
  ['temps', 't=95&worker=arjun&truth=1&focus=temps', 420, 470, 2],
  ['forecast', 'plant=jaisalmer&t=95&focus=forecast', 420, 560, 2],
  ['forecast-arctic', 'plant=norilsk&t=95&focus=forecast', 420, 560, 2],
  ['crew-vs-site', 't=95&focus=crewsite', 720, 560, 2],
  ['chart-ignored', 't=170&worker=arjun&truth=1&focus=chart', 920, 430, 2],
  ['chart-followed', 't=170&worker=arjun&truth=1&focus=chart&follow=1', 920, 430, 2],
  ['race', 't=95&worker=kiran&truth=1&focus=race', 920, 330, 2],
  ['gas-hero', 'plant=platformb&t=146&worker=deepak&focus=hero', 920, 300, 2],
  ['gas-site', 'plant=platformb&t=146&worker=deepak&focus=site', 400, 760, 2],
];

async function shot([name, query, W, H, scale = 1, pre = '']) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(browser, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'geos-'))}`, 'about:blank'], { stdio: 'ignore' });
  let targets = [];
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* starting */ } await sleep(250); }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: scale, mobile: false });
  await send('Emulation.setScrollbarsHidden', { hidden: true });
  await send('Page.navigate', { url: `${base}&${/theme=/.test(query) ? '' : 'theme=dark&'}${query}` });
  await sleep(3500);
  if (pre) { await send('Runtime.evaluate', { expression: pre, awaitPromise: true }); await sleep(900); }
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, `${name}.png`), Buffer.from(s.result.data, 'base64'));
  console.log('ok  ', name);
  ws.close(); spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => proc.kill());
  await sleep(500);
}

const wanted = process.argv.slice(2);
for (const s of SHOTS) if (!wanted.length || wanted.includes(s[0])) await shot(s);
process.exit(0);
