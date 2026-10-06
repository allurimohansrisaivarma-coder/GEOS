// Refresh the offline fallback used by Live mode:  npm run snapshots
// Run this once with internet access before presenting; the app then works with no Wi-Fi at all.

import { writeFileSync, mkdirSync } from 'node:fs';
import { LIVE_LOCATIONS, fetchDay } from '../site/src/live/openmeteo.js';

const out = {};
for (const loc of LIVE_LOCATIONS) {
  try {
    const day = await fetchDay(loc);
    out[loc.key] = day;
    const tmax = Math.max(...day.temp).toFixed(1);
    console.log(`ok   ${loc.name.padEnd(42)} ${day.dateStr}  Tmax ${tmax} C`);
  } catch (e) {
    console.log(`FAIL ${loc.name}: ${e.message}`);
  }
}
mkdirSync(new URL('../site/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../site/data/snapshots.json', import.meta.url), JSON.stringify(out));
console.log(`wrote site/data/snapshots.json (${Object.keys(out).length} locations)`);
