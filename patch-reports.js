// Run once from the phone folder (after patch-stock.js):  node patch-reports.js
// Adds "Reports and receipts" to the Account tab and bumps the offline cache in sw.js. Changes nothing unless every spot is found exactly once.
const fs = require('fs');
const edits = [
  ['<script src="stockops.js"></script>', '<script src="stockops.js"></script>\n<script src="reports.js"></script>'],
  ['<button class="primary" id="eod">End of day close</button>', '<button class="primary" id="rpt">Reports and receipts</button><button class="primary" id="eod" style="margin-top:8px">End of day close</button>'],
  ["$('eod').onclick=endOfDaySheet,", "$('rpt').onclick=()=>reportsSheet(),$('eod').onclick=endOfDaySheet,"],
];
let html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('stockops.js')) { console.error('Run patch-stock.js first (stockops.js is not in index.html yet).'); process.exit(1); }
if (html.includes('reports.js')) { console.log('Already patched — nothing to do.'); process.exit(0); }
for (const [a] of edits) { const n = html.split(a).length - 1; if (n !== 1) { console.error(`STOPPED, nothing changed: expected 1 match, found ${n} for:\n  ${a}`); process.exit(1); } }
fs.copyFileSync('index.html', 'index.html.bak6');
for (const [a, b] of edits) html = html.replace(a, () => b);
fs.writeFileSync('index.html', html); console.log('index.html updated (backup: index.html.bak6)');
if (fs.existsSync('sw.js')) {
  let sw = fs.readFileSync('sw.js', 'utf8'), changed = false; const m = sw.match(/pharm-v(\d+)/);
  if (m) { sw = sw.replace(/pharm-v\d+/g, 'pharm-v' + (Number(m[1]) + 1)); changed = true; console.log(`sw.js cache pharm-v${m[1]} -> pharm-v${Number(m[1]) + 1}`); }
  else console.log('sw.js: no "pharm-vN" cache name found — change the cache name by hand so the iPhone fetches the new files.');
  if (/(['"])(\.?\/?)stockops\.js\1/.test(sw) && !sw.includes('reports.js')) { sw = sw.replace(/(['"])(\.?\/?)stockops\.js\1/, (s, q, p) => `${s},${q}${p}reports.js${q}`); changed = true; console.log('sw.js: added reports.js next to stockops.js'); }
  else if (!sw.includes('reports.js')) console.log('sw.js: no stockops.js entry found — if it lists files to keep offline, add reports.js beside stockops.js.');
  if (changed) { fs.copyFileSync('sw.js', 'sw.js.bak6'); fs.writeFileSync('sw.js', sw); }
} else console.log('sw.js not found in this folder — bump its cache name by hand.');