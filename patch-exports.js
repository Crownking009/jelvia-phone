// Run once from the phone folder (after patch-reports.js):  node patch-exports.js
// Adds "Prescription register and exports" to the Account tab and bumps the offline cache in sw.js. Changes nothing unless every spot is found exactly once.
const fs = require('fs');
const edits = [
  ['<script src="reports.js"></script>', '<script src="reports.js"></script>\n<script src="exports.js"></script>'],
  ['<button class="primary" id="rpt">Reports and receipts</button>', '<button class="primary" id="rpt">Reports and receipts</button><button class="primary" id="exp" style="margin-top:8px">Prescription register and exports</button>'],
  ["$('rpt').onclick=()=>reportsSheet(),", "$('rpt').onclick=()=>reportsSheet(),$('exp').onclick=()=>exportsSheet(),"],
];
let html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('reports.js')) { console.error('Run patch-reports.js first (reports.js is not in index.html yet).'); process.exit(1); }
if (html.includes('exports.js')) { console.log('Already patched — nothing to do.'); process.exit(0); }
for (const [a] of edits) { const n = html.split(a).length - 1; if (n !== 1) { console.error(`STOPPED, nothing changed: expected 1 match, found ${n} for:\n  ${a}`); process.exit(1); } }
fs.copyFileSync('index.html', 'index.html.bak7');
for (const [a, b] of edits) html = html.replace(a, () => b);
fs.writeFileSync('index.html', html); console.log('index.html updated (backup: index.html.bak7)');
if (fs.existsSync('sw.js')) {
  let sw = fs.readFileSync('sw.js', 'utf8'), changed = false; const m = sw.match(/pharm-v(\d+)/);
  if (m) { sw = sw.replace(/pharm-v\d+/g, 'pharm-v' + (Number(m[1]) + 1)); changed = true; console.log(`sw.js cache pharm-v${m[1]} -> pharm-v${Number(m[1]) + 1}`); }
  else console.log('sw.js: no "pharm-vN" cache name found — change the cache name by hand so the iPhone fetches the new files.');
  if (/(['"])(\.?\/?)reports\.js\1/.test(sw) && !sw.includes('exports.js')) { sw = sw.replace(/(['"])(\.?\/?)reports\.js\1/, (s, q, p) => `${s},${q}${p}exports.js${q}`); changed = true; console.log('sw.js: added exports.js next to reports.js'); }
  else if (!sw.includes('exports.js')) console.log('sw.js: no reports.js entry found — if it lists files to keep offline, add exports.js beside reports.js.');
  if (changed) { fs.copyFileSync('sw.js', 'sw.js.bak7'); fs.writeFileSync('sw.js', sw); }
} else console.log('sw.js not found in this folder — bump its cache name by hand.');