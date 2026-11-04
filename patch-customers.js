// Run once from the phone folder (after patch-index.js and patch-sell.js):  node patch-customers.js
// Adds "Customers and credit" to the Account tab, makes the "Customers who owe" rows on Today tappable, and bumps the offline cache in sw.js.
// Changes nothing unless every spot is found exactly once.
const fs = require('fs');
const edits = [
  ['<script src="sell.js"></script>', '<script src="sell.js"></script>\n<script src="customers.js"></script>'],
  ['<button class="primary" id="rfd">Returns and refunds</button>', '<button class="primary" id="cus">Customers and credit</button><button class="primary" id="rfd" style="margin-top:8px">Returns and refunds</button>'],
  ["$('rfd').onclick=returnsSheet,$('vds').onclick=voidSheet}", "$('rfd').onclick=returnsSheet,$('vds').onclick=voidSheet,$('cus').onclick=customersSheet}"],
  ['<div class="li"><span>${esc(x.name)}<br><small class="mute">${x.phone?', '<div class="li" data-cu="${esc(x.id)}" style="cursor:pointer"><span>${esc(x.name)}<br><small class="mute">${x.phone?'],
  ["reviewSheet((data.v||[]).find(x=>x.id===b.dataset.sv)))}", "reviewSheet((data.v||[]).find(x=>x.id===b.dataset.sv)));v.querySelectorAll('[data-cu]').forEach(b=>b.onclick=()=>customerDetail(b.dataset.cu))}"],
];
let html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('sell.js')) { console.error('Run patch-index.js and patch-sell.js first (sell.js is not in index.html yet).'); process.exit(1); }
if (html.includes('customers.js')) { console.log('Already patched — nothing to do.'); process.exit(0); }
for (const [a] of edits) { const n = html.split(a).length - 1; if (n !== 1) { console.error(`STOPPED, nothing changed: expected 1 match, found ${n} for:\n  ${a}`); process.exit(1); } }
fs.copyFileSync('index.html', 'index.html.bak3');
for (const [a, b] of edits) html = html.replace(a, () => b);
fs.writeFileSync('index.html', html); console.log('index.html updated (backup: index.html.bak3)');
if (fs.existsSync('sw.js')) {
  let sw = fs.readFileSync('sw.js', 'utf8'), changed = false; const m = sw.match(/pharm-v(\d+)/);
  if (m) { sw = sw.replace(/pharm-v\d+/g, 'pharm-v' + (Number(m[1]) + 1)); changed = true; console.log(`sw.js cache pharm-v${m[1]} -> pharm-v${Number(m[1]) + 1}`); }
  else console.log('sw.js: no "pharm-vN" cache name found — change the cache name by hand so the iPhone fetches the new files.');
  if (/(['"])(\.?\/?)sell\.js\1/.test(sw) && !sw.includes('customers.js')) { sw = sw.replace(/(['"])(\.?\/?)sell\.js\1/, (s, q, p) => `${s},${q}${p}customers.js${q}`); changed = true; console.log('sw.js: added customers.js next to sell.js'); }
  else if (!sw.includes('customers.js')) console.log('sw.js: no sell.js entry found — if it lists files to keep offline, add customers.js beside sell.js.');
  if (changed) { fs.copyFileSync('sw.js', 'sw.js.bak3'); fs.writeFileSync('sw.js', sw); }
} else console.log('sw.js not found in this folder — bump its cache name by hand.');