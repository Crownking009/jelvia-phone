// Run once from the phone folder (after patch-index.js):  node patch-sell.js
// Adds the Sell tab and "Void a sale" to index.html and bumps the offline cache in sw.js. Changes nothing unless every spot is found exactly once.
const fs = require('fs');
const edits = [
  ['<script src="refund.js"></script>', '<script src="refund.js"></script>\n<script src="sell.js"></script>'],
  ['Today</button><button data-t="stock">', 'Today</button><button data-t="sell"><span>🛒</span>Sell</button><button data-t="stock">'],
  ["if(tab==='me')v.innerHTML=", "if(tab==='sell')sellView(v);if(tab==='me')v.innerHTML="],
  ['<button class="primary" id="rfd">Returns and refunds</button>', '<button class="primary" id="rfd">Returns and refunds</button><button class="primary" id="vds" style="margin-top:8px">Void a sale</button>'],
  ["$('rfd').onclick=returnsSheet}", "$('rfd').onclick=returnsSheet,$('vds').onclick=voidSheet}"],
  ['<i style="width:${Math.round(a/tot*100)}%"></i>', '<i style="width:${Math.max(0,Math.round(a/tot*100))}%"></i>'],
  ['${t.voided?`', '${t.refunds&&t.refunds.count?`<div class="banner" style="margin:10px 0 0">Refunds today: ${N(t.refunds.total)} (${t.refunds.count})</div>`:\'\'}${t.voided?`'],
];
let html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('refund.js')) { console.error('Run patch-index.js first (refund.js is not in index.html yet).'); process.exit(1); }
if (html.includes('sell.js')) { console.log('Already patched — nothing to do.'); process.exit(0); }
for (const [a] of edits) { const n = html.split(a).length - 1; if (n !== 1) { console.error(`STOPPED, nothing changed: expected 1 match, found ${n} for:\n  ${a}`); process.exit(1); } }
fs.copyFileSync('index.html', 'index.html.bak2');
for (const [a, b] of edits) html = html.replace(a, () => b);
fs.writeFileSync('index.html', html); console.log('index.html updated (backup: index.html.bak2)');
if (fs.existsSync('sw.js')) {
  let sw = fs.readFileSync('sw.js', 'utf8'), changed = false; const m = sw.match(/pharm-v(\d+)/);
  if (m) { sw = sw.replace(/pharm-v\d+/g, 'pharm-v' + (Number(m[1]) + 1)); changed = true; console.log(`sw.js cache pharm-v${m[1]} -> pharm-v${Number(m[1]) + 1}`); }
  else console.log('sw.js: no "pharm-vN" cache name found — change the cache name by hand so the iPhone fetches the new files.');
  if (/(['"])(\.?\/?)refund\.js\1/.test(sw) && !sw.includes('sell.js')) { sw = sw.replace(/(['"])(\.?\/?)refund\.js\1/, (s, q, p) => `${s},${q}${p}sell.js${q}`); changed = true; console.log('sw.js: added sell.js next to refund.js'); }
  else if (!sw.includes('sell.js')) console.log('sw.js: no refund.js entry found — if it lists files to keep offline, add sell.js beside refund.js.');
  if (changed) { fs.copyFileSync('sw.js', 'sw.js.bak2'); fs.writeFileSync('sw.js', sw); }
} else console.log('sw.js not found in this folder — bump its cache name by hand.');