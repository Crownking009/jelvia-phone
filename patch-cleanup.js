// Run once from the phone folder (after patch-duplicates.js):  node patch-cleanup.js
// Adds "Delete products and categories" to the Account tab and bumps the offline cache in sw.js. Changes nothing unless every spot is found exactly once.
const fs = require('fs');
const edits = [
  ['<script src="duplicates.js"></script>', '<script src="duplicates.js"></script>\n<script src="cleanup.js"></script>'],
  ['<button class="primary" id="stf" style="margin-top:8px">Staff and passwords</button>', '<button class="primary" id="stf" style="margin-top:8px">Staff and passwords</button><button class="primary" id="cln" style="margin-top:8px">Delete products and categories</button>'],
  ["$('stf').onclick=()=>staffSheet(),", "$('stf').onclick=()=>staffSheet(),$('cln').onclick=()=>cleanupSheet(),"],
];
let html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('duplicates.js')) { console.error('Run patch-duplicates.js first (duplicates.js is not in index.html yet).'); process.exit(1); }
if (html.includes('cleanup.js')) { console.log('Already patched — nothing to do.'); process.exit(0); }
for (const [a] of edits) { const n = html.split(a).length - 1; if (n !== 1) { console.error(`STOPPED, nothing changed: expected 1 match, found ${n} for:\n  ${a}`); process.exit(1); } }
fs.copyFileSync('index.html', 'index.html.bak13');
for (const [a, b] of edits) html = html.replace(a, () => b);
fs.writeFileSync('index.html', html); console.log('index.html updated (backup: index.html.bak13)');
if (fs.existsSync('sw.js')) {
  let sw = fs.readFileSync('sw.js', 'utf8'), changed = false; const m = sw.match(/pharm-v(\d+)/);
  if (m) { sw = sw.replace(/pharm-v\d+/g, 'pharm-v' + (Number(m[1]) + 1)); changed = true; console.log(`sw.js cache pharm-v${m[1]} -> pharm-v${Number(m[1]) + 1}`); }
  else console.log('sw.js: no "pharm-vN" cache name found — change the cache name by hand so the iPhone fetches the new files.');
  if (/(['"])(\.?\/?)duplicates\.js\1/.test(sw) && !sw.includes('cleanup.js')) { sw = sw.replace(/(['"])(\.?\/?)duplicates\.js\1/, (s, q, p) => `${s},${q}${p}cleanup.js${q}`); changed = true; console.log('sw.js: added cleanup.js next to duplicates.js'); }
  else if (!sw.includes('cleanup.js')) console.log('sw.js: no duplicates.js entry found — if it lists files to keep offline, add cleanup.js beside duplicates.js.');
  if (changed) { fs.copyFileSync('sw.js', 'sw.js.bak13'); fs.writeFileSync('sw.js', sw); }
} else console.log('sw.js not found in this folder — bump its cache name by hand.');
