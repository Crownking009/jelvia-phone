// Run once from the phone folder (after patch-shop.js):  node patch-staff.js
// Adds "Staff and passwords" to the Account tab and bumps the offline cache in sw.js. Changes nothing unless every spot is found exactly once.
const fs = require('fs');
const edits = [
  ['<script src="shop.js"></script>', '<script src="shop.js"></script>\n<script src="staff.js"></script>'],
  ['<button class="primary" id="shp" style="margin-top:8px">Shop details and receipt</button>', '<button class="primary" id="shp" style="margin-top:8px">Shop details and receipt</button><button class="primary" id="stf" style="margin-top:8px">Staff and passwords</button>'],
  ["$('shp').onclick=()=>shopSheet(),", "$('shp').onclick=()=>shopSheet(),$('stf').onclick=()=>staffSheet(),"],
];
let html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('shop.js')) { console.error('Run patch-shop.js first (shop.js is not in index.html yet).'); process.exit(1); }
if (html.includes('staff.js')) { console.log('Already patched — nothing to do.'); process.exit(0); }
for (const [a] of edits) { const n = html.split(a).length - 1; if (n !== 1) { console.error(`STOPPED, nothing changed: expected 1 match, found ${n} for:\n  ${a}`); process.exit(1); } }
fs.copyFileSync('index.html', 'index.html.bak9');
for (const [a, b] of edits) html = html.replace(a, () => b);
fs.writeFileSync('index.html', html); console.log('index.html updated (backup: index.html.bak9)');
if (fs.existsSync('sw.js')) {
  let sw = fs.readFileSync('sw.js', 'utf8'), changed = false; const m = sw.match(/pharm-v(\d+)/);
  if (m) { sw = sw.replace(/pharm-v\d+/g, 'pharm-v' + (Number(m[1]) + 1)); changed = true; console.log(`sw.js cache pharm-v${m[1]} -> pharm-v${Number(m[1]) + 1}`); }
  else console.log('sw.js: no "pharm-vN" cache name found — change the cache name by hand so the iPhone fetches the new files.');
  if (/(['"])(\.?\/?)shop\.js\1/.test(sw) && !sw.includes('staff.js')) { sw = sw.replace(/(['"])(\.?\/?)shop\.js\1/, (s, q, p) => `${s},${q}${p}staff.js${q}`); changed = true; console.log('sw.js: added staff.js next to shop.js'); }
  else if (!sw.includes('staff.js')) console.log('sw.js: no shop.js entry found — if it lists files to keep offline, add staff.js beside shop.js.');
  if (changed) { fs.copyFileSync('sw.js', 'sw.js.bak9'); fs.writeFileSync('sw.js', sw); }
} else console.log('sw.js not found in this folder — bump its cache name by hand.');
