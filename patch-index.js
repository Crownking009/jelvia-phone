// Run once from the phone folder:  node patch-index.js
// Adds the refund screen to index.html and bumps the offline cache in sw.js. Changes nothing unless every spot is found exactly once.
const fs = require('fs');
const edits = [
  ['<script src="ops.js"></script>', '<script src="ops.js"></script>\n<script src="refund.js"></script>'],
  ["rpc('debtors',{})]);", "rpc('debtors',{}),rpc('refund_conflicts',{}).catch(()=>[])]);"],
  ['const [t,w,mo,s,v,dbt]=await', 'const [t,w,mo,s,v,dbt,rc]=await'],
  ['data={t,w,mo,s,v,dbt,at:Date.now()}', 'data={t,w,mo,s,v,dbt,rc,at:Date.now()}'],
  ["function banners(){if(!data)return'';let h='';", "function banners(){if(!data)return'';let h='';if((data.rc||[]).length)h+=`<div class=\"banner bad\">Refund check: ${data.rc.map(x=>esc(x.product)+' on '+esc(x.receipt)).join(', ')} was refunded more times than it was sold. Check the refunds on the phone and on the shop computer.</div>`;"],
  ['<button class="primary" id="lo" style="background:#e8efee;color:var(--ink)">Sign out</button>', '<button class="primary" id="rfd">Returns and refunds</button><button class="primary" id="lo" style="background:#e8efee;color:var(--ink);margin-top:8px">Sign out</button>'],
  ["$('lo').onclick=logout}", "$('lo').onclick=logout,$('rfd').onclick=returnsSheet}"],
];
let html = fs.readFileSync('index.html', 'utf8');
if (html.includes('refund.js')) { console.log('Already patched — nothing to do.'); process.exit(0); }
else {
  for (const [a] of edits) { const n = html.split(a).length - 1; if (n !== 1) { console.error(`STOPPED, nothing changed: expected 1 match, found ${n} for:\n  ${a}`); process.exit(1); } }
  fs.copyFileSync('index.html', 'index.html.bak');
  for (const [a, b] of edits) html = html.replace(a, () => b);
  fs.writeFileSync('index.html', html); console.log('index.html updated (backup: index.html.bak)');
}
if (fs.existsSync('sw.js')) {
  let sw = fs.readFileSync('sw.js', 'utf8'), changed = false;
  const m = sw.match(/pharm-v(\d+)/);
  if (m) { sw = sw.replace(/pharm-v\d+/g, 'pharm-v' + (Number(m[1]) + 1)); changed = true; console.log(`sw.js cache pharm-v${m[1]} -> pharm-v${Number(m[1]) + 1}`); }
  else console.log('sw.js: no "pharm-vN" cache name found — change the cache name by hand so the iPhone fetches the new files.');
  if (/(['"])(\.?\/?)ops\.js\1/.test(sw) && !sw.includes('refund.js')) { sw = sw.replace(/(['"])(\.?\/?)ops\.js\1/, (s, q, p) => `${s},${q}${p}refund.js${q}`); changed = true; console.log('sw.js: added refund.js next to ops.js'); }
  else if (!sw.includes('refund.js')) console.log('sw.js: no ops.js entry found — if it lists files to keep offline, add refund.js beside ops.js.');
  if (changed) { fs.copyFileSync('sw.js', 'sw.js.bak'); fs.writeFileSync('sw.js', sw); }
} else console.log('sw.js not found in this folder — bump its cache name by hand.');