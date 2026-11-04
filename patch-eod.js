// Run once from the phone folder (after patch-customers.js):  node patch-eod.js
// Adds "End of day close" to the Account tab and bumps the offline cache in sw.js. Changes nothing unless every spot is found exactly once.
const fs = require('fs');
const edits = [
  ['<script src="customers.js"></script>', '<script src="customers.js"></script>\n<script src="eod.js"></script>'],
  ['<button class="primary" id="cus">Customers and credit</button>', '<button class="primary" id="eod">End of day close</button><button class="primary" id="cus" style="margin-top:8px">Customers and credit</button>'],
  ["$('cus').onclick=customersSheet}", "$('cus').onclick=customersSheet,$('eod').onclick=endOfDaySheet}"],
];
let html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('customers.js')) { console.error('Run patch-customers.js first (customers.js is not in index.html yet).'); process.exit(1); }
if (html.includes('eod.js')) { console.log('Already patched — nothing to do.'); process.exit(0); }
for (const [a] of edits) { const n = html.split(a).length - 1; if (n !== 1) { console.error(`STOPPED, nothing changed: expected 1 match, found ${n} for:\n  ${a}`); process.exit(1); } }
fs.copyFileSync('index.html', 'index.html.bak4');
for (const [a, b] of edits) html = html.replace(a, () => b);
fs.writeFileSync('index.html', html); console.log('index.html updated (backup: index.html.bak4)');
if (fs.existsSync('sw.js')) {
  let sw = fs.readFileSync('sw.js', 'utf8'), changed = false; const m = sw.match(/pharm-v(\d+)/);
  if (m) { sw = sw.replace(/pharm-v\d+/g, 'pharm-v' + (Number(m[1]) + 1)); changed = true; console.log(`sw.js cache pharm-v${m[1]} -> pharm-v${Number(m[1]) + 1}`); }
  else console.log('sw.js: no "pharm-vN" cache name found — change the cache name by hand so the iPhone fetches the new files.');
  if (/(['"])(\.?\/?)customers\.js\1/.test(sw) && !sw.includes('eod.js')) { sw = sw.replace(/(['"])(\.?\/?)customers\.js\1/, (s, q, p) => `${s},${q}${p}eod.js${q}`); changed = true; console.log('sw.js: added eod.js next to customers.js'); }
  else if (!sw.includes('eod.js')) console.log('sw.js: no customers.js entry found — if it lists files to keep offline, add eod.js beside customers.js.');
  if (changed) { fs.copyFileSync('sw.js', 'sw.js.bak4'); fs.writeFileSync('sw.js', sw); }
} else console.log('sw.js not found in this folder — bump its cache name by hand.');