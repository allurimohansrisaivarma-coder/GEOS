// Renders site/icon.svg to the PNG sizes a phone needs to install the app (needs Microsoft Edge).
//   node scripts/make-icons.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!edge) { console.error('Microsoft Edge not found'); process.exit(1); }
const site = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const svg = readFileSync(join(site, 'icon.svg'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [file, size, maskable]: a maskable icon has no rounded corners and keeps the artwork inside the safe zone
const OUT = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]];

const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(edge, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'geos-'))}`, 'about:blank'], { stdio: 'ignore' });
let targets = [];
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* starting */ } await sleep(250); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');

for (const [name, size, maskable] of OUT) {
  const art = maskable ? svg.replace('<rect width="48" height="48" rx="12" fill="#14181f"/>', '<rect width="48" height="48" fill="#14181f"/>') : svg;
  const inner = maskable ? `<div style="width:${size}px;height:${size}px;background:#14181f;display:grid;place-items:center"><div style="width:${Math.round(size * 0.8)}px;height:${Math.round(size * 0.8)}px">${art.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div>` : art.replace('<svg ', `<svg width="${size}" height="${size}" `);
  const html = `<!doctype html><style>html,body{margin:0;overflow:hidden;background:transparent}svg{display:block}</style><body>${inner}</body>`;
  await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` });
  await sleep(700);
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(join(site, name), Buffer.from(shot.result.data, 'base64'));
  console.log('wrote', name);
}
ws.close(); spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
await sleep(400);
process.exit(0);
