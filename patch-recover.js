// Run once from the phone folder (after patch-staff.js):  node patch-recover.js
// Adds "Forgot password?" to the sign-in screen and bumps the offline cache in sw.js. Changes nothing unless every spot is found exactly once.
const fs = require('fs');
const edits = [
  ['<script src="staff.js"></script>', '<script src="staff.js"></script>\n<script src="recover.js"></script>'],
  ['<button class="primary" id="lgo">Sign in</button>', '<button class="primary" id="lgo">Sign in</button><p style="text-align:center;margin:16px 0 0;font-size:14px"><a href="#" id="lfg" style="color:var(--brand2)">Forgot password?</a></p>'],
];
let html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('staff.js')) { console.error('Run patch-staff.js first (staff.js is not in index.html yet).'); process.exit(1); }
if (html.includes('recover.js')) { console.log('Already patched — nothing to do.'); process.exit(0); }
for (const [a] of edits) { const n = html.split(a).length - 1; if (n !== 1) { console.error(`STOPPED, nothing changed: expected 1 match, found ${n} for:\n  ${a}`); process.exit(1); } }
fs.copyFileSync('index.html', 'index.html.bak10');
for (const [a, b] of edits) html = html.replace(a, () => b);
fs.writeFileSync('index.html', html); console.log('index.html updated (backup: index.html.bak10)');
if (fs.existsSync('sw.js')) {
  let sw = fs.readFileSync('sw.js', 'utf8'), changed = false; const m = sw.match(/pharm-v(\d+)/);
  if (m) { sw = sw.replace(/pharm-v\d+/g, 'pharm-v' + (Number(m[1]) + 1)); changed = true; console.log(`sw.js cache pharm-v${m[1]} -> pharm-v${Number(m[1]) + 1}`); }
  else console.log('sw.js: no "pharm-vN" cache name found — change the cache name by hand so the iPhone fetches the new files.');
  if (/(['"])(\.?\/?)staff\.js\1/.test(sw) && !sw.includes('recover.js')) { sw = sw.replace(/(['"])(\.?\/?)staff\.js\1/, (s, q, p) => `${s},${q}${p}recover.js${q}`); changed = true; console.log('sw.js: added recover.js next to staff.js'); }
  else if (!sw.includes('recover.js')) console.log('sw.js: no staff.js entry found — if it lists files to keep offline, add recover.js beside staff.js.');
  if (changed) { fs.copyFileSync('sw.js', 'sw.js.bak10'); fs.writeFileSync('sw.js', sw); }
} else console.log('sw.js not found in this folder — bump its cache name by hand.');
