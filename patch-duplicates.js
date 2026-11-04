// Run once from the phone folder (after patch-recover.js):  node patch-duplicates.js
// Makes the Add product and Edit product forms refuse a name or category that already exists, and bumps the offline cache in sw.js.
// Changes nothing unless every spot is found exactly once.
const fs = require('fs');
const edits = [
  ['<script src="recover.js"></script>', '<script src="recover.js"></script>\n<script src="duplicates.js"></script>'],
  ['if(f.barcode&&!memo.k)await checkBarcode(f.barcode);', 'if(!memo.k)await checkNames(f,null);if(f.barcode&&!memo.k)await checkBarcode(f.barcode);'],
  ['if(f.barcode&&!memo.k)await checkBarcode(f.barcode,d.id);', 'if(!memo.k)await checkNames(f,d.id);if(f.barcode&&!memo.k)await checkBarcode(f.barcode,d.id);'],
];
let html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('recover.js')) { console.error('Run patch-recover.js first (recover.js is not in index.html yet).'); process.exit(1); }
if (html.includes('duplicates.js')) { console.log('Already patched — nothing to do.'); process.exit(0); }
for (const [a] of edits) { const n = html.split(a).length - 1; if (n !== 1) { console.error(`STOPPED, nothing changed: expected 1 match, found ${n} for:\n  ${a}`); process.exit(1); } }
fs.copyFileSync('index.html', 'index.html.bak12');
for (const [a, b] of edits) html = html.replace(a, () => b);
fs.writeFileSync('index.html', html); console.log('index.html updated (backup: index.html.bak12)');
if (fs.existsSync('sw.js')) {
  let sw = fs.readFileSync('sw.js', 'utf8'), changed = false; const m = sw.match(/pharm-v(\d+)/);
  if (m) { sw = sw.replace(/pharm-v\d+/g, 'pharm-v' + (Number(m[1]) + 1)); changed = true; console.log(`sw.js cache pharm-v${m[1]} -> pharm-v${Number(m[1]) + 1}`); }
  else console.log('sw.js: no "pharm-vN" cache name found — change the cache name by hand so the iPhone fetches the new files.');
  if (/(['"])(\.?\/?)recover\.js\1/.test(sw) && !sw.includes('duplicates.js')) { sw = sw.replace(/(['"])(\.?\/?)recover\.js\1/, (s, q, p) => `${s},${q}${p}duplicates.js${q}`); changed = true; console.log('sw.js: added duplicates.js next to recover.js'); }
  else if (!sw.includes('duplicates.js')) console.log('sw.js: no recover.js entry found — if it lists files to keep offline, add duplicates.js beside recover.js.');
  if (changed) { fs.copyFileSync('sw.js', 'sw.js.bak12'); fs.writeFileSync('sw.js', sw); }
} else console.log('sw.js not found in this folder — bump its cache name by hand.');
