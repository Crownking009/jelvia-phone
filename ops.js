// Builds the cloud records for changes made from the owner's phone. The shop computer applies them on its next sync.
// Pure functions (no network) so they can be tested in Node as well as used by the phone page.
(function (root) {
  const uid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : require('crypto').randomUUID());
  const base = (c) => ({ created_at: c.now, updated_at: c.now, deleted_at: null, device_id: c.dev, synced_at: null });
  const rec = (tbl, data, c) => ({ tbl, id: data.id, data, device_id: c.dev, updated_at: data.updated_at });
  const log = (c, action, tbl, recordId, detail) => rec('activity_log', { id: uid(), ...base(c), user_id: c.adminId, action: 'phone.' + action, tbl, record_id: recordId, detail: JSON.stringify(detail) }, c);
  const ctx = (o) => { if (!o.adminId) throw new Error('Owner account not found'); return { dev: o.dev, adminId: o.adminId, now: o.now || Date.now() }; };
  const whole = (n, what) => { if (!Number.isInteger(n) || n <= 0) throw new Error(what + ' must be a whole number above zero'); };

  function receive(o) {                     // purchase + batch + positive stock entry (+ audit row)
    const c = ctx(o); whole(o.qty, 'Quantity');
    if (!o.productId) throw new Error('Choose a product');
    if (!Number.isInteger(o.costKobo) || o.costKobo < 0) throw new Error('Enter the cost price');
    if (o.expiry && !/^\d{4}-\d{2}-\d{2}$/.test(o.expiry)) throw new Error('Expiry date is invalid');
    const pur = { id: uid(), ...base(c), supplier_id: o.supplierId || null, invoice_no: o.invoiceNo || null, received_by: c.adminId };
    const bat = { id: uid(), ...base(c), product_id: o.productId, purchase_id: pur.id, batch_no: o.batchNo || null, expiry_date: o.expiry || null, cost_price: o.costKobo };
    const ent = { id: uid(), ...base(c), product_id: o.productId, batch_id: bat.id, qty_change: o.qty, reason: 'received', ref_id: pur.id, user_id: c.adminId };
    return [rec('purchases', pur, c), rec('batches', bat, c), rec('stock_entries', ent, c), log(c, 'stock.receive', 'batches', bat.id, { productId: o.productId, qty: o.qty })];
  }
  function priceChange(o) {                 // o.product = the product's current row (data) from the cloud
    const c = ctx(o);
    if (!Number.isInteger(o.priceKobo) || o.priceKobo <= 0) throw new Error('Enter a price above zero');
    const p = { ...o.product, selling_price: o.priceKobo, updated_at: c.now };
    return [rec('products', p, c), log(c, 'product.price', 'products', p.id, { price: o.priceKobo })];
  }
  function removeStock(o) {                 // damaged / correction, earliest expiry first; o.batches = [{batchId, remaining}] sorted by expiry
    const c = ctx(o); whole(o.qty, 'Quantity'); let need = o.qty; const out = [];
    for (const b of o.batches) { if (!need) break; const t = Math.min(need, b.remaining); need -= t;
      out.push(rec('stock_entries', { id: uid(), ...base(c), product_id: o.productId, batch_id: b.batchId, qty_change: -t, reason: o.reason, ref_id: null, user_id: c.adminId }, c)); }
    if (need) throw new Error('Not enough stock to remove');
    return [...out, log(c, 'stock.remove', 'stock_entries', out[0].id, { productId: o.productId, qty: o.qty, reason: o.reason })];
  }
  function writeOff(o) {                    // clears a whole (expired) batch
    const c = ctx(o); if (!(o.remaining > 0)) throw new Error('Nothing left in that batch');
    const e = rec('stock_entries', { id: uid(), ...base(c), product_id: o.productId, batch_id: o.batchId, qty_change: -o.remaining, reason: 'expired', ref_id: null, user_id: c.adminId }, c);
    return [e, log(c, 'stock.writeoff', 'stock_entries', e.id, { batchId: o.batchId, qty: o.remaining })];
  }
  function reviewShift(o) {                 // the owner's decision on a cashier's shift difference
    const c = ctx(o);
    if (!['accepted', 'explained', 'repay', 'investigating'].includes(o.outcome)) throw new Error('Choose an outcome');
    if (!o.shiftId) throw new Error('Shift not found');
    const r = { id: uid(), ...base(c), shift_close_id: o.shiftId, reviewer_id: c.adminId, outcome: o.outcome, note: (o.note || '').trim() || null };
    return [rec('shift_reviews', r, c), log(c, 'shift.review', 'shift_closes', o.shiftId, { outcome: o.outcome })];
  }
  const clean = (s) => (s == null ? '' : String(s)).trim(), nul = (s) => clean(s) || null;
  // Product options the owner chooses: how it is sold, its size, who it is for. Same lists and rules as the shop computer (src/services/options.js).
  const SOLD_AS = ['Piece', 'Tablet', 'Capsule', 'Sachet', 'Strip', 'Pack', 'Box', 'Carton', 'Bottle', 'Tube', 'Roll', 'Sheet', 'Jar', 'Tin', 'Ampoule', 'Vial'], SIZES = ['Small', 'Medium', 'Big'], AUDIENCES = ['Adults', 'Kids', 'Infants', 'Men', 'Women'];
  const squash = (s) => String(s == null ? '' : s).normalize('NFKC').trim().replace(/\s+/g, ' ');
  function pickOpt(list, v, what) {
    const t = squash(v); if (!t) return null; if (t.length > 40) throw new Error(what + ' must be 40 characters or fewer');
    return list.find((x) => x.toLowerCase() === t.toLowerCase()) || t;
  }
  // What to store: undefined keeps what the product already has (cur), '' clears it.
  function optClean(o, cur) {
    cur = cur || {}; const f = (k, col, list, what) => (o[k] === undefined ? (cur[col] == null ? null : cur[col]) : pickOpt(list, o[k], what));
    return { sold_as: f('soldAs', 'sold_as', SOLD_AS, 'Sold as'), size: f('size', 'size', SIZES, 'Size'), audience: f('audience', 'audience', AUDIENCES, 'For') };
  }
  // "Paracetamol (Sachet · Kids)"; just the name when no option is set. o = an object with sold_as/size/audience (a product row) or soldAs.
  function optLabel(name, o) { o = o || {}; const bits = [o.sold_as != null ? o.sold_as : o.soldAs, o.size, o.audience].map(squash).filter(Boolean); return bits.length ? name + ' (' + bits.join(' · ') + ')' : name; }
  function catFor(o, c, out) {              // an existing category, a new one (matched ignoring capitals), or none
    const name = clean(o.newCategory);
    if (!name) return o.categoryId || null;
    const hit = (o.existingCategories || []).find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const cat = { id: uid(), ...base(c), name }; out.push(rec('categories', cat, c)); return cat.id;
  }
  function addProduct(o) {
    const c = ctx(o), name = clean(o.name);
    if (!name) throw new Error('Product name is required');
    if (!Number.isInteger(o.priceKobo) || o.priceKobo <= 0) throw new Error('Enter a price above zero');
    const out = [], catId = catFor(o, c, out);
    const p = { id: uid(), ...base(c), name, category_id: catId, barcode: nul(o.barcode), base_unit: 'piece', selling_price: o.priceKobo,
      reorder_level: Math.max(0, parseInt(o.reorder, 10) || 0), prescription_only: o.rx ? 1 : 0, active: 1, ...optClean(o) };
    return [...out, rec('products', p, c), log(c, 'product.create', 'products', p.id, { name })];
  }
  function editProduct(o) {                 // o.product = the product's current row from the cloud. Options and price are changed here too when given (priceKobo); left out = unchanged
    const c = ctx(o), name = clean(o.name);
    if (!o.product || !o.product.id) throw new Error('Product not found');
    if (!name) throw new Error('Product name is required');
    if (o.priceKobo !== undefined && (!Number.isInteger(o.priceKobo) || o.priceKobo <= 0)) throw new Error('Enter a price above zero');
    const out = [], catId = catFor(o, c, out), price = o.priceKobo === undefined ? o.product.selling_price : o.priceKobo;
    const p = { ...o.product, name, category_id: catId, barcode: nul(o.barcode), reorder_level: Math.max(0, parseInt(o.reorder, 10) || 0), prescription_only: o.rx ? 1 : 0, ...optClean(o, o.product), selling_price: price, updated_at: c.now };
    const recs = [...out, rec('products', p, c), log(c, 'product.edit', 'products', p.id, { name })];
    if (price !== o.product.selling_price) recs.push(log(c, 'product.price', 'products', p.id, { price, from: o.product.selling_price }));
    return recs;
  }
  function setActive(o, on) {               // archive hides a product from selling; history and stock records stay
    const c = ctx(o); if (!o.product || !o.product.id) throw new Error('Product not found');
    const p = { ...o.product, active: on ? 1 : 0, updated_at: c.now };
    return [rec('products', p, c), log(c, on ? 'product.restore' : 'product.archive', 'products', p.id, { name: p.name })];
  }
  const archiveProduct = (o) => setActive(o, false), restoreProduct = (o) => setActive(o, true);
  function addSupplier(o) {
    const c = ctx(o), name = clean(o.name);
    if (!name) throw new Error('Supplier name is required');
    const s = { id: uid(), ...base(c), name, phone: nul(o.phone), notes: nul(o.notes) };
    return [rec('suppliers', s, c), log(c, 'supplier.create', 'suppliers', s.id, { name })];
  }
  root.POS_OPS = { receive, priceChange, removeStock, writeOff, reviewShift, addProduct, editProduct, archiveProduct, restoreProduct, addSupplier, pickOpt, optClean, optLabel, OPT_LISTS: { soldAs: SOLD_AS, size: SIZES, audience: AUDIENCES } };
  if (typeof module !== 'undefined') module.exports = root.POS_OPS;
})(typeof window !== 'undefined' ? window : globalThis);
