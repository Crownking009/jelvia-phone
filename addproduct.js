// "New product" with its stock in one go: the product's details plus how many are in stock now, their cost, expiry, batch number, supplier and invoice.
// It sends the product and its first delivery together, so there is never a product without the stock she just counted. "Receive stock" is unchanged and still adds more later.
// Pure builder (no network) so Node can test it. It reuses the phone's own addProduct() and receive(), so the rules and the wording are the ones already in use.
(function (root) {
  // o: everything addProduct() takes (dev, adminId, name, categoryId, newCategory, existingCategories, priceKobo, barcode, reorder, rx)
  //    plus the stock: qty (0 or empty = no stock yet), costKobo, expiry, batchNo, supplierId, invoiceNo
  function addProductWithStock(o) {
    const P = root.POS_OPS; if (!P || !P.addProduct || !P.receive) throw new Error('ops.js must be loaded first');
    const now = o.now || Date.now(), recs = P.addProduct({ ...o, now });
    if (!o.qty) return recs;                                           // no quantity: just the product
    const product = recs.find((r) => r.tbl === 'products').data;
    return [...recs, ...P.receive({ dev: o.dev, adminId: o.adminId, now, productId: product.id, supplierId: o.supplierId || null, invoiceNo: o.invoiceNo || null, batchNo: o.batchNo || null, expiry: o.expiry || null, qty: o.qty, costKobo: o.costKobo })];
  }
  const api = { addProductWithStock };
  for (const k of Object.keys(api)) if (root.POS_OPS && k in root.POS_OPS) throw new Error('POS_OPS name clash: ' + k + ' is already defined by another phone file');
  root.POS_OPS = Object.assign(root.POS_OPS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;

  // ---------- screen (browser only) ----------
  if (typeof document === 'undefined') return;
  root.addProductSheet = async function () {
    const cats = await catList(); let sups = []; try { sups = (await rget('tbl=eq.suppliers&select=data&limit=200')).map((x) => x.data).filter((s) => !s.deleted_at); } catch (e) { /* the supplier is optional */ }
    sheet('New product', [{ k: 'name', l: 'Product name' }, { k: 'cat', l: 'Category', opts: catOpts(cats) }, { k: 'newcat', l: 'Or type a new category (optional)' }, { k: 'price', l: 'Selling price (₦)', t: 'number' }, { k: 'barcode', l: 'Barcode (optional)' },
      { k: 'reorder', l: 'Low-stock warning at', t: 'number', v: 5 }, { k: 'rx', l: 'Prescription-only drug?', opts: [['0', 'No'], ['1', 'Yes']] },
      { k: 'qty', l: 'STOCK — quantity you have now (leave empty to add stock later)', t: 'number' }, { k: 'cost', l: 'Cost price per unit (₦)', t: 'number' }, { k: 'exp', l: 'Expiry date (optional)', t: 'date' }, { k: 'bno', l: 'Batch number (optional)' },
      { k: 'sup', l: 'Supplier (optional)', opts: [['', '— none —'], ...sups.map((s) => [s.id, s.name])] }, { k: 'inv', l: 'Supplier invoice no. (optional)' }],
      async (f, memo) => { const aid = await getAdmin(); if (!memo.k) await checkNames(f, null); if (f.barcode && !memo.k) await checkBarcode(f.barcode);
        if (!f.qty && (f.cost || f.exp || f.bno || f.inv || f.sup)) throw new Error('Enter the quantity you have, or clear the other stock fields');
        await pushRecs(once(memo, f, () => POS_OPS.addProductWithStock({ dev, adminId: aid, name: f.name, categoryId: f.cat || null, newCategory: f.newcat, existingCategories: cats, priceKobo: Math.round(parseFloat(f.price) * 100), barcode: f.barcode, reorder: f.reorder, rx: f.rx === '1',
          qty: f.qty ? Number(f.qty) : 0, costKobo: Math.round(parseFloat(f.cost) * 100), expiry: f.exp || null, batchNo: f.bno || null, supplierId: f.sup || null, invoiceNo: f.inv || null }))); });
  };
})(typeof window !== 'undefined' ? window : globalThis);
