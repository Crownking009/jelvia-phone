// The prescription register and spreadsheet (CSV) exports on the owner's phone. Mirrors src/services/exporter.js and csv.js:
// the same columns, the same wording and the same formatting, so the accountant gets the same file from either device. Read-only.
(function (root) {
  const n2 = (k) => (k / 100).toFixed(2), p2 = (n) => String(n).padStart(2, '0');
  const csvEsc = (v) => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };   // CSV quoting only; the screen uses the page's own HTML-safe esc()
  const csvStringify = (rows) => '\ufeff' + rows.map((r) => r.map(csvEsc).join(',')).join('\r\n') + '\r\n';   // BOM so Excel shows ₦ and accents correctly
  const localDateTime = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
  function exportBounds(from, to) {                   // the start and end (milliseconds) of from..to inclusive; same checks and words as the computer
    for (const d of [from, to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) throw new Error('Choose valid dates');
    const [y1, m1, d1] = from.split('-').map(Number), [y2, m2, d2] = to.split('-').map(Number), a = new Date(y1, m1 - 1, d1).getTime(), b = new Date(y2, m2 - 1, d2 + 1).getTime();
    if (b <= a) throw new Error('The end date must not be before the start date'); return { from: a, to: b };
  }
  // rows = what the cloud functions export_sales, export_stock, export_customers and rx_register return
  function buildCsv(kind, rows) {
    if (kind === 'sales') return csvStringify([['Date', 'Receipt', 'Cashier', 'Product', 'Qty', 'List price', 'Price charged', 'Line total', 'Status', 'Paid by'],
      ...rows.map((r) => [localDateTime(r.ts), r.receipt, r.cashier, r.name, r.qty, n2(r.list), n2(r.price), n2(r.qty * r.price), r.status, r.methods || 'credit'])]);
    if (kind === 'stock') return csvStringify([['Product', 'Category', 'Barcode', 'Selling price', 'Last cost', 'Sellable', 'Total incl. expired', 'Value at cost', 'Value at selling price', 'Next expiry'],
      ...rows.map((p) => [p.name, p.category, p.barcode, n2(p.price), p.lastCost == null ? '' : n2(p.lastCost), p.sellable, p.total, n2(p.costValue), n2(p.sellable * p.price), p.nextExpiry || ''])]);
    if (kind === 'customers') return csvStringify([['Customer', 'Phone', 'Credit limit', 'Owes now'], ...rows.map((c) => [c.name, c.phone, n2(c.limit), n2(c.balance)])]);
    if (kind === 'rx') return csvStringify([['Date', 'Receipt', 'Product', 'Qty', 'Prescription / patient', 'Cashier'], ...rows.map((r) => [localDateTime(r.ts), r.receiptNo, r.name, r.qty, r.rx, r.cashier])]);
    throw new Error('Unknown export');
  }
  const api = { buildCsv, exportBounds, localDateTime, csvStringify };
  for (const k of Object.keys(api)) if (root.POS_OPS && k in root.POS_OPS) throw new Error('POS_OPS name clash: ' + k + ' is already defined by another phone file');
  root.POS_OPS = Object.assign(root.POS_OPS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;

  // ---------- screen (browser only) ----------
  if (typeof document === 'undefined') return;
  const fail = (e) => (e.message === 'auth' ? 'Please sign in again' : e.message);
  const today = () => new Date().toLocaleDateString('en-CA');
  const overlay = (html) => { const bg = document.createElement('div'); bg.className = 'sheetbg'; bg.innerHTML = '<div class="sheet">' + html + '</div>'; document.body.appendChild(bg); return bg; };
  const GREY = 'background:#e8efee;color:var(--ink)';
  // Hand the file to the phone's share sheet (Save to Files, WhatsApp, email…); where that is not available, download it.
  async function deliver(name, text) {
    const file = typeof File === 'function' ? new File([text], name, { type: 'text/csv' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'closed'; } }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' })), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); return 'downloaded';
  }
  root.exportsSheet = function () {
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Prescription register and exports</h2><p class="mute" style="margin:0 0 10px">Spreadsheets open in Excel. The period applies to sales and the prescription register.</p>
      <div class="row"><div class="grow"><label class="lb">From</label><input id="ex_a" type="date" value="${today()}"></div><div class="grow"><label class="lb">To</label><input id="ex_b" type="date" value="${today()}"></div></div>
      <button class="primary" id="ex_rx">Show prescription register</button><div id="ex_list"></div><p class="err" id="ex_e"></p>
      <h3>Spreadsheets (CSV)</h3><button class="primary" data-k="rx" style="${GREY}">Prescription register</button><button class="primary" data-k="sales" style="${GREY};margin-top:8px">Sales for the period</button><button class="primary" data-k="stock" style="${GREY};margin-top:8px">Stock and value now</button><button class="primary" data-k="customers" style="${GREY};margin-top:8px">Customers and what they owe</button>
      <button class="primary" id="ex_x" style="${GREY};margin-top:14px">Close</button>`);
    const $$ = (s) => bg.querySelector(s), err = (m) => { $$('#ex_e').textContent = m || ''; }, win = () => exportBounds($$('#ex_a').value, $$('#ex_b').value);
    const FETCH = { rx: () => { const w = win(); return rpc('rx_register', { p_from: w.from, p_to: w.to }); }, sales: () => { const w = win(); return rpc('export_sales', { p_from: w.from, p_to: w.to }); }, stock: () => rpc('export_stock', { p_today: today() }), customers: () => rpc('export_customers', {}) };
    const span = () => $$('#ex_a').value === $$('#ex_b').value ? $$('#ex_a').value : $$('#ex_a').value + '_to_' + $$('#ex_b').value;
    const NAME = { rx: () => 'jelvia-prescription-register-' + span() + '.csv', sales: () => 'jelvia-sales-' + span() + '.csv', stock: () => 'jelvia-stock-' + today() + '.csv', customers: () => 'jelvia-customers-' + today() + '.csv' };
    $$('#ex_rx').onclick = async () => { err('');
      try { const rows = await FETCH.rx(), when = (ms) => new Date(ms).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        $$('#ex_list').innerHTML = `<h3>${rows.length} prescription sale(s)</h3><div class="list">${rows.map((r) => `<div class="li" style="display:block"><b>${esc(r.name)}</b> × ${r.qty}<br><small class="mute">${esc(r.rx || '— no prescription noted —')}<br>${when(r.ts)} · ${esc(r.receiptNo)} · ${esc(r.cashier || '—')}</small></div>`).join('') || '<div class="li mute">No prescription sales in this period</div>'}</div>`;
      } catch (e) { err(fail(e)); } };
    bg.querySelectorAll('[data-k]').forEach((b) => { b.onclick = async () => { err(''); b.disabled = true;
      try { const k = b.dataset.k, rows = await FETCH[k](), r = await deliver(NAME[k](), buildCsv(k, rows)); if (r === 'downloaded') toast('Spreadsheet downloaded'); }
      catch (e) { err(fail(e)); } b.disabled = false; }; });
    $$('#ex_x').onclick = () => bg.remove();
  };
})(typeof window !== 'undefined' ? window : globalThis);