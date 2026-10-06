// Screenshots that need clicks (sensors dialog, tickets). Needs Microsoft Edge and `npm start` running.
//   node scripts/screenshots-interactive.mjs            (set SHOT_PORT if the server is not on 5173)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const base = `http://localhost:${process.env.SHOT_PORT || 5173}/?nosw=1&paused=1&anim=0&theme=dark`;
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'img');
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name, query, W, H, pre = '', scale = 1) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(edge, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'geos-'))}`, 'about:blank'], { stdio: 'ignore' });
  let targets = [];
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* starting */ } await sleep(250); }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: scale, mobile: false });
  await send('Page.navigate', { url: `${base}&${query}` });
  await sleep(3500);
  if (pre) { await send('Runtime.evaluate', { expression: pre, awaitPromise: true }); await sleep(900); }
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, `${name}.png`), Buffer.from(s.result.data, 'base64'));
  console.log('ok  ', name);
  ws.close(); spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); await sleep(500);
}

const $ = (s) => `document.querySelector('${s}')`;
const raise = `(async()=>{const w=(ms)=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('st1').click(); await w(300);
  let b=document.querySelector('.srow:has(.lowb) [data-ticket]'); b.click(); await w(200);
  document.getElementById('tk-priority').value='High';
  document.getElementById('tk-note').value='Strap battery critical, swap before next shift';
  document.getElementById('tk-form').requestSubmit(); await w(300);
  b=document.querySelector('#tab-sensors'); b.click(); await w(200);
  b=document.querySelectorAll('.srow:has(.lowb) [data-ticket]'); if(b.length){b[0].click(); await w(200);
    document.getElementById('tk-issue').value='Poor skin contact'; document.getElementById('tk-form').requestSubmit(); await w(300);}
  document.querySelector('#tk-list [data-adv]:not([data-done])')?.click(); await w(300);
})()`;

await shot('sensors', 'plant=jaisalmer&t=300&worker=arjun&sensors=1', 1280, 900);
await shot('tickets', 'plant=jaisalmer&t=300&worker=arjun', 1280, 900, raise);
await shot('mine', 'plant=witbank&t=240&worker=thabo', 1600, 1000);
await shot('arctic', 'plant=norilsk&t=200&worker=maxim', 1600, 1000);
await shot('hr-lost', 'plant=jaisalmer&t=171&worker=ravi', 1600, 1000);
await shot('sim-panel', 'plant=jaisalmer&t=95&worker=arjun&sim=open', 1600, 1000, `document.getElementById('plant-btn').click()`);

