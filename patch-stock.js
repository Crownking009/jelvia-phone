// Run once from the phone folder (after patch-eod.js):  node patch-stock.js
// Adds Stock count, Break pack, Stock value, Suppliers and Activity log to the Account tab and bumps the offline cache in sw.js.
// Changes nothing unless every spot is found exactly once.
const fs = require('fs');
const B = (id, label) => `<button class="primary" id="${id}" style="margin-top:8px">${label}</button>`;
const edits = [
  ['<script src="eod.js"></script>', '<script src="eod.js"></script>\n<script src="stockops.js"></script>'],
  [B('vds', 'Void a sale'), B('vds', 'Void a sale') + B('sct', 'Stock count') + B('bpk', 'Break pack') + B('svl', 'Stock value') + B('sup', 'Suppliers') + B('act', 'Activity log')],
  ["$('eod').onclick=endOfDaySheet}", "$('eod').onclick=endOfDaySheet,$('sct').onclick=stockCountSheet,$('bpk').onclick=breakPackSheet,$('svl').onclick=stockValueSheet,$('sup').onclick=suppliersSheet,$('act').onclick=activitySheet}"],
];
let html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('eod.js')) { console.error('Run patch-eod.js first (eod.js is not in index.html yet).'); process.exit(1); }
if (html.includes('stockops.js')) { console.log('Already patched — nothing to do.'); process.exit(0); }
for (const [a] of edits) { const n = html.split(a).length - 1; if (n !== 1) { console.error(`STOPPED, nothing changed: expected 1 match, found ${n} for:\n  ${a}`); process.exit(1); } }
fs.copyFileSync('index.html', 'index.html.bak5');
for (const [a, b] of edits) html = html.replace(a, () => b);
fs.writeFileSync('index.html', html); console.log('index.html updated (backup: index.html.bak5)');
if (fs.existsSync('sw.js')) {
  let sw = fs.readFileSync('sw.js', 'utf8'), changed = false; const m = sw.match(/pharm-v(\d+)/);
  if (m) { sw = sw.replace(/pharm-v\d+/g, 'pharm-v' + (Number(m[1]) + 1)); changed = true; console.log(`sw.js cache pharm-v${m[1]} -> pharm-v${Number(m[1]) + 1}`); }
  else console.log('sw.js: no "pharm-vN" cache name found — change the cache name by hand so the iPhone fetches the new files.');
  if (/(['"])(\.?\/?)eod\.js\1/.test(sw) && !sw.includes('stockops.js')) { sw = sw.replace(/(['"])(\.?\/?)eod\.js\1/, (s, q, p) => `${s},${q}${p}stockops.js${q}`); changed = true; console.log('sw.js: added stockops.js next to eod.js'); }
  else if (!sw.includes('stockops.js')) console.log('sw.js: no eod.js entry found — if it lists files to keep offline, add stockops.js beside eod.js.');
  if (changed) { fs.copyFileSync('sw.js', 'sw.js.bak5'); fs.writeFileSync('sw.js', sw); }
} else console.log('sw.js not found in this folder — bump its cache name by hand.');