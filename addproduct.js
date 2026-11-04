// "New product" and "Edit details" on the owner's phone — one form each, the same as on the shop computer.
//  • Product options the owner chooses: Sold as (sachet, strip, pack…), Size (small, medium, big), For (kids, adults…) — or her own word.
//  • New product also takes the stock she has now (quantity, cost, expiry, batch, supplier, invoice), sent together with the product.
//  • Edit details is the one place for name, category, options, barcode, warning level, PRICE and receiving MORE STOCK (the separate Change price and Receive stock buttons are gone from the product menu).
// Pure builders (no network) so Node can test them; they reuse ops.js's own addProduct(), editProduct() and receive(), so the rules and the wording are the ones already in use.
(function (root) {
  // o: everything addProduct() takes (dev, adminId, name, categoryId, newCategory, existingCategories, priceKobo, barcode, reorder, rx, soldAs, size, audience)
  //    plus the stock: qty (0 or empty = no stock yet), costKobo, expiry, batchNo, supplierId, invoiceNo
  function addProductWithStock(o) {
    const P = root.POS_OPS; if (!P || !P.addProduct || !P.receive) throw new Error('ops.js must be loaded first');
    if (!o.qty && (o.costKobo >= 0 || o.expiry || o.batchNo || o.invoiceNo || o.supplierId)) throw new Error('Enter the quantity you have, or clear the other stock fields');
    const now = o.now || Date.now(), recs = P.addProduct({ ...o, now });
    if (!o.qty) return recs;                                           // no quantity: just the product
    const product = recs.find((r) => r.tbl === 'products').data;
    return [...recs, ...P.receive({ dev: o.dev, adminId: o.adminId, now, productId: product.id, supplierId: o.supplierId || null, invoiceNo: o.invoiceNo || null, batchNo: o.batchNo || null, expiry: o.expiry || null, qty: o.qty, costKobo: o.costKobo })];
  }
  // o: everything editProduct() takes (product = its current row from the cloud, name, categoryId, newCategory, existingCategories, barcode, reorder, rx, soldAs, size, audience, priceKobo)
  //    plus an optional new delivery: qty, costKobo, expiry, batchNo, supplierId, invoiceNo. Details, price and stock are saved together or not at all.
  function editProductFull(o) {
    const P = root.POS_OPS; if (!P || !P.editProduct || !P.receive) throw new Error('ops.js must be loaded first');
    if (!o.qty && (o.costKobo >= 0 || o.expiry || o.batchNo || o.invoiceNo || o.supplierId)) throw new Error('Enter the quantity received, or clear the other stock fields');
    const now = o.now || Date.now(), recs = P.editProduct({ ...o, now });
    if (!o.qty) return recs;
    return [...recs, ...P.receive({ dev: o.dev, adminId: o.adminId, now, productId: o.product.id, supplierId: o.supplierId || null, invoiceNo: o.invoiceNo || null, batchNo: o.batchNo || null, expiry: o.expiry || null, qty: o.qty, costKobo: o.costKobo })];
  }
  // The options of every product (from cloud/phone-options.sql) so lists can show "Paracetamol (Sachet · Kids)". Rows keep their original name in rawName.
  let OPTMAP = {};
  const setOptions = (map) => { OPTMAP = map && typeof map === 'object' ? map : {}; };
  const labelRows = (rows, key) => (rows || []).map((r) => { const o = OPTMAP[r[key || 'id']]; if (!o) return r; const raw = r.rawName != null ? r.rawName : r.name; return { ...r, rawName: raw, name: root.POS_OPS.optLabel(raw, o) }; });
  const api = { addProductWithStock, editProductFull, setOptions, labelRows };
  for (const k of Object.keys(api)) if (root.POS_OPS && k in root.POS_OPS) throw new Error('POS_OPS name clash: ' + k + ' is already defined by another phone file');
  root.POS_OPS = Object.assign(root.POS_OPS || {}, api);
  root.setOptions = setOptions; root.labelRows = labelRows;
  if (typeof module !== 'undefined') module.exports = api;

  // ---------- screens (browser only) ----------
  if (typeof document === 'undefined') return;
  const OTHER = '__other', GREY = 'background:#e8efee;color:var(--ink)';
  const optField = (id, label, list, cur) => {                       // a list to choose from, plus "Other" to type her own word
    const custom = cur && !list.some((x) => x.toLowerCase() === String(cur).toLowerCase());
    return `<label class="lb">${label}</label><select id="${id}"><option value="">— not set —</option>${list.map((x) => `<option value="${esc(x)}"${!custom && cur === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}<option value="${OTHER}"${custom ? ' selected' : ''}>Other (type it)…</option></select>
      <input id="${id}_o" placeholder="Type it here" style="${custom ? '' : 'display:none'}" value="${custom ? esc(cur) : ''}" autocomplete="off">`;
  };
  const optValue = (bg, id) => { const v = bg.querySelector('#' + id).value; return v === OTHER ? bg.querySelector('#' + id + '_o').value.trim() : v; };

  // product = a row from the Stock list to edit it; nothing = a new product
  root.productSheet = async function (product) {
    const edit = !!product; let cats, d = null, sups = [];
    try { cats = await catList(); if (edit) d = await productRow(product.id); } catch (e) { return toast(e.message === 'auth' ? 'Please sign in again' : e.message); }
    try { sups = (await rget('tbl=eq.suppliers&select=data&limit=200')).map((x) => x.data).filter((s) => !s.deleted_at); } catch (e) { /* the supplier is optional */ }
    const cur = d || {}, L = POS_OPS.OPT_LISTS;
    const bg = document.createElement('div'); bg.className = 'sheetbg';
    bg.innerHTML = `<div class="sheet"><h2 style="margin:0 0 14px;font-size:19px">${edit ? 'Edit details — ' + esc(POS_OPS.optLabel(d.name, d)) : 'New product'}</h2>
      <label class="lb">Product name</label><input id="pf_name" value="${esc(cur.name || '')}" autocomplete="off">
      <label class="lb">Category</label><select id="pf_cat">${catOpts(cats).map((o) => `<option value="${esc(o[0])}"${cur.category_id === o[0] ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>
      <label class="lb">Or type a new category (optional)</label><input id="pf_newcat" autocomplete="off">
      ${optField('pf_sold', 'Sold as', L.soldAs, cur.sold_as)}${optField('pf_size', 'Size', L.size, cur.size)}${optField('pf_aud', 'For', L.audience, cur.audience)}
      <label class="lb">Selling price (₦)</label><input id="pf_price" type="number" inputmode="decimal" value="${edit ? cur.selling_price / 100 : ''}">
      <label class="lb">Barcode (optional)</label><input id="pf_barcode" value="${esc(cur.barcode || '')}" autocomplete="off">
      <label class="lb">Low-stock warning at</label><input id="pf_reorder" type="number" inputmode="numeric" value="${edit ? cur.reorder_level : 5}">
      <label class="lb">Prescription-only drug?</label><select id="pf_rx"><option value="0">No</option><option value="1"${cur.prescription_only ? ' selected' : ''}>Yes</option></select>
      <h3 style="margin:14px 0 4px;font-size:16px">${edit ? 'Receive more stock' : 'Stock you have now'}</h3><p class="mute" style="margin:0 0 8px;font-size:13px">${edit ? `Now in stock: ${product.sellable}. Leave the quantity empty if nothing new arrived.` : 'Leave the quantity empty to add stock later.'}</p>
      <label class="lb">${edit ? 'Quantity received' : 'Quantity in stock'}</label><input id="pf_qty" type="number" inputmode="numeric">
      <label class="lb">Cost price per unit (₦)</label><input id="pf_cost" type="number" inputmode="decimal">
      <label class="lb">Expiry date (optional)</label><input id="pf_exp" type="date">
      <label class="lb">Batch number (optional)</label><input id="pf_bno" autocomplete="off">
      <label class="lb">Supplier (optional)</label><select id="pf_sup"><option value="">— none —</option>${sups.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
      <label class="lb">Supplier invoice no. (optional)</label><input id="pf_inv" autocomplete="off">
      <p class="err" id="pf_err"></p><button class="primary" id="pf_ok">Save</button><button class="primary" id="pf_x" style="${GREY};margin-top:8px">Cancel</button></div>`;
    document.body.appendChild(bg);
    bg.querySelectorAll('select[id^="pf_"]').forEach((sel) => { const o = bg.querySelector('#' + sel.id + '_o'); if (o) sel.onchange = () => { o.style.display = sel.value === OTHER ? '' : 'none'; if (sel.value === OTHER) o.focus(); }; });
    const memo = {}, $$ = (id) => bg.querySelector('#pf_' + id);
    $$('x').onclick = () => bg.remove();
    $$('ok').onclick = async (ev) => {
      const btn = ev.target, err = $$('err'); err.textContent = ''; btn.disabled = true;
      try {
        const f = { name: $$('name').value.trim(), cat: $$('cat').value, newcat: $$('newcat').value.trim(), soldAs: optValue(bg, 'pf_sold'), size: optValue(bg, 'pf_size'), audience: optValue(bg, 'pf_aud'), price: $$('price').value.trim(), barcode: $$('barcode').value.trim(),
          reorder: $$('reorder').value.trim(), rx: $$('rx').value, qty: $$('qty').value.trim(), cost: $$('cost').value.trim(), exp: $$('exp').value, bno: $$('bno').value.trim(), sup: $$('sup').value, inv: $$('inv').value.trim() };
        const priceKobo = Math.round(parseFloat(f.price) * 100); if (!(priceKobo > 0)) throw new Error('Enter a price above zero');
        const qty = f.qty ? Number(f.qty) : 0, costKobo = f.cost ? Math.round(parseFloat(f.cost) * 100) : undefined;
        if (qty && costKobo === undefined) throw new Error('Enter the cost price');
        const aid = await getAdmin(), key = JSON.stringify(f);
        if (memo.k !== key) { await checkNames(f, edit ? d.id : null); if (f.barcode) await checkBarcode(f.barcode, edit ? d.id : null); }   // a retry of the same form is not checked again
        const common = { dev, adminId: aid, name: f.name, categoryId: f.cat || null, newCategory: f.newcat, existingCategories: cats, barcode: f.barcode, reorder: f.reorder, rx: f.rx === '1', soldAs: f.soldAs, size: f.size, audience: f.audience, priceKobo,
          qty, costKobo, expiry: f.exp || null, batchNo: f.bno || null, supplierId: f.sup || null, invoiceNo: f.inv || null };
        await pushRecs(once(memo, f, () => (edit ? POS_OPS.editProductFull({ ...common, product: d }) : POS_OPS.addProductWithStock(common))));
        bg.remove(); toast('Saved ✓ — reaches the shop computer when it next goes online'); load();
      } catch (e) { err.textContent = e.message === 'auth' ? 'Please sign in again' : e.message; btn.disabled = false; }
    };
  };
  root.addProductSheet = () => root.productSheet();
})(typeof window !== 'undefined' ? window : globalThis);
