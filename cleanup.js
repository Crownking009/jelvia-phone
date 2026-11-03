// Delete products and tidy categories from the owner's phone: delete a duplicate or unwanted product, rename a category, merge a duplicate category into the right one, delete an empty one.
// Nothing is ever erased: a deleted row is only marked deleted (that is how the computer's own lists already hide things), so old sales, receipts and reports stay readable.
// A product can be deleted only if it has never been sold or returned and has no stock; otherwise it should be archived. Pure builders (no network) so Node can test them.
(function (root) {
  const uid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : require('crypto').randomUUID());
  const base = (c) => ({ created_at: c.now, updated_at: c.now, deleted_at: null, device_id: c.dev, synced_at: null });
  const rec = (tbl, data, c) => ({ tbl, id: data.id, data, device_id: c.dev, updated_at: data.updated_at });
  const log = (c, action, tbl, recordId, detail) => rec('activity_log', { id: uid(), ...base(c), user_id: c.adminId, action: 'phone.' + action, tbl, record_id: recordId, detail: detail ? JSON.stringify(detail) : null }, c);
  const ctx = (o) => { if (!o.adminId) throw new Error('Admin only'); return { dev: o.dev, adminId: o.adminId, now: o.now || Date.now() }; };
  const norm = (s) => String(s == null ? '' : s).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const bump = (row, c) => Math.max(c.now, (row.updated_at || 0) + 1);
  // A deleted category keeps its row but gives up its name, so the same name can be used again later (the computer allows one row per category name, deleted or not).
  const gone = (row, c) => ({ ...row, name: `${row.name} (deleted ${String(row.id).slice(0, 6)})`, deleted_at: c.now, updated_at: bump(row, c) });

  // o: { dev, adminId, product (its current row), usage: { sold, returned, stock } from the cloud }
  function deleteProduct(o) {
    const c = ctx(o), p = o.product, u = o.usage || {};
    if (!p || !p.id || p.deleted_at) throw new Error('Product not found');
    if (u.sold > 0 || u.returned > 0) throw new Error(`“${p.name}” has been sold, so it cannot be deleted. Archive it instead — the old sales stay readable.`);
    if (u.stock !== 0) throw new Error(`“${p.name}” still has stock (${u.stock}). Remove its stock first, then delete it.`);
    const row = { ...p, active: 0, deleted_at: c.now, updated_at: bump(p, c) };
    return { records: [rec('products', row, c), log(c, 'product.delete', 'products', p.id, { name: p.name })], summary: { name: p.name } };
  }
  // o: { category (its current row), name, categories (every category row) }
  function renameCategory(o) {
    const c = ctx(o), name = (o.name || '').trim(), cat = o.category;
    if (!cat || !cat.id || cat.deleted_at) throw new Error('Category not found');
    if (!name) throw new Error('Category name is required');
    const hit = (o.categories || []).find((x) => !x.deleted_at && x.id !== cat.id && norm(x.name) === norm(name)); if (hit) throw new Error(`A category named “${hit.name}” already exists`);
    const row = { ...cat, name, updated_at: bump(cat, c) };
    return { records: [rec('categories', row, c), log(c, 'category.rename', 'categories', cat.id, { from: cat.name, to: name })], summary: { from: cat.name, to: name } };
  }
  // Move every product from one category into another, then delete the emptied one. o: { from, into (category rows), products (the product rows now in `from`) }
  function mergeCategories(o) {
    const c = ctx(o), a = o.from, b = o.into;
    if (!a || !a.id || a.deleted_at || !b || !b.id || b.deleted_at) throw new Error('Category not found');
    if (a.id === b.id) throw new Error('Choose a different category to merge into');
    const out = (o.products || []).map((p) => rec('products', { ...p, category_id: b.id, updated_at: bump(p, c) }, c));
    const moved = out.length;
    out.push(rec('categories', gone(a, c), c), log(c, 'category.merge', 'categories', a.id, { from: a.name, into: b.name, products: moved }));
    return { records: out, summary: { from: a.name, into: b.name, moved } };
  }
  // o: { category, productCount }
  function deleteCategory(o) {
    const c = ctx(o), cat = o.category;
    if (!cat || !cat.id || cat.deleted_at) throw new Error('Category not found');
    if (o.productCount > 0) throw new Error(`“${cat.name}” still has ${o.productCount} product${o.productCount === 1 ? '' : 's'}. Merge it into another category instead.`);
    return { records: [rec('categories', gone(cat, c), c), log(c, 'category.delete', 'categories', cat.id, { name: cat.name })], summary: { name: cat.name } };
  }
  const api = { deleteProduct, renameCategory, mergeCategories, deleteCategory };
  for (const k of Object.keys(api)) if (root.POS_OPS && k in root.POS_OPS) throw new Error('POS_OPS name clash: ' + k + ' is already defined by another phone file');
  root.POS_OPS = Object.assign(root.POS_OPS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;

  // ---------- screens (browser only) ----------
  if (typeof document === 'undefined') return;
  const fail = (e) => (e.message === 'auth' ? 'Please sign in again' : e.message);
  const overlay = (html) => { const bg = document.createElement('div'); bg.className = 'sheetbg'; bg.innerHTML = '<div class="sheet">' + html + '</div>'; document.body.appendChild(bg); return bg; };
  const GREY = 'background:#e8efee;color:var(--ink)', RED = 'background:#fbe3e3;color:var(--bad)';
  const catRows = async () => (await rget('tbl=eq.categories&select=data&limit=500')).map((x) => x.data);
  const prodRow = async (id) => { const r = (await rget(`tbl=eq.products&id=eq.${encodeURIComponent(id)}&select=data`))[0]; if (!r) throw new Error('Product not found in the cloud'); return r.data; };

  root.cleanupSheet = function () {
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Delete products and categories</h2><p class="mute" style="margin:0 0 14px">Nothing is erased: deleted items are hidden, so old sales and reports stay correct.</p>
      <button class="primary" data-a="p">Delete a product</button><button class="primary" data-a="c" style="${GREY};margin-top:8px">Categories (rename, merge, delete)</button><button class="primary" data-a="x" style="${GREY};margin-top:8px">Close</button>`);
    bg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; bg.remove(); if (b.dataset.a === 'p') deleteProductSheet(); if (b.dataset.a === 'c') categoriesSheet(); };
  };
  async function deleteProductSheet() {
    let all; try { all = await rpc('product_names', {}); } catch (e) { return toast(fail(e)); }
    all.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Delete a product</h2><p class="mute" style="margin:0 0 10px">Search for the product. Archived ones are included.</p><input id="dp_q" placeholder="Search product name…" autocomplete="off"><div class="list" id="dp_l"></div><button class="primary" id="dp_x" style="${GREY};margin-top:12px">Back</button>`);
    const $$ = (s) => bg.querySelector(s), draw = () => { const q = POS_OPS.normName($$('#dp_q').value), rows = all.filter((p) => !q || POS_OPS.normName(p.name).includes(q)).slice(0, 40);
      $$('#dp_l').innerHTML = rows.map((p) => `<div class="li" data-id="${esc(p.id)}" style="cursor:pointer"><span>${esc(p.name)}</span>${p.active === 1 ? '' : '<span class="badge">Archived</span>'}</div>`).join('') || '<div class="li mute">No product found</div>';
      $$('#dp_l').querySelectorAll('[data-id]').forEach((el) => { el.onclick = () => { bg.remove(); confirmDelete(all.find((p) => p.id === el.dataset.id)); }; }); };
    $$('#dp_q').oninput = draw; draw(); $$('#dp_x').onclick = () => { bg.remove(); cleanupSheet(); };
  }
  async function confirmDelete(p) {
    let usage, row, adminId; try { adminId = await getAdmin(); [usage, row] = await Promise.all([rpc('product_usage', { p_product: p.id }), prodRow(p.id)]); } catch (e) { return toast(fail(e)); }
    let problem = null; try { POS_OPS.deleteProduct({ dev, adminId, product: row, usage }); } catch (e) { problem = e.message; }
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Delete “${esc(row.name)}”?</h2><p class="mute" style="margin:0 0 12px">Sold ${usage.sold} time(s) · returned ${usage.returned} time(s) · stock ${usage.stock}</p>
      ${problem ? `<div class="banner" style="margin:0 0 12px">${esc(problem)}</div>` : '<p style="margin:0 0 12px">It has never been sold and has no stock, so it can be deleted. This cannot be undone from the phone.</p>'}
      ${problem ? '' : `<button class="primary" id="dl_ok" style="background:var(--bad)">Delete this product</button>`}<button class="primary" id="dl_x" style="${GREY};margin-top:8px">${problem ? 'Back' : 'Cancel'}</button><p class="err" id="dl_e"></p>`);
    const $$ = (s) => bg.querySelector(s); $$('#dl_x').onclick = () => { bg.remove(); deleteProductSheet(); };
    if (!problem) $$('#dl_ok').onclick = async (ev) => { const ok = ev.target; ok.disabled = true;
      try { const fresh = await Promise.all([rpc('product_usage', { p_product: p.id }), prodRow(p.id)]), r = POS_OPS.deleteProduct({ dev, adminId, usage: fresh[0], product: fresh[1] });
        await pushRecs(r.records); bg.remove(); toast('Deleted ✓ — gone from the shop computer once it syncs'); load();
      } catch (e) { $$('#dl_e').textContent = fail(e); ok.disabled = false; } };
  }
  async function categoriesSheet() {
    let rows; try { rows = await rpc('category_list', {}); } catch (e) { return toast(fail(e)); }
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Categories</h2><p class="mute" style="margin:0 0 10px">Tap one to rename it, merge it into another, or delete it.</p>
      <div class="list">${rows.map((c) => `<div class="li" data-id="${esc(c.id)}" style="cursor:pointer"><span>${esc(c.name)}</span><span class="badge">${c.products} product${c.products === 1 ? '' : 's'}</span></div>`).join('') || '<div class="li mute">No categories yet</div>'}</div><button class="primary" id="cg_x" style="${GREY};margin-top:12px">Back</button>`);
    bg.querySelector('#cg_x').onclick = () => { bg.remove(); cleanupSheet(); };
    bg.querySelectorAll('[data-id]').forEach((el) => { el.onclick = () => { bg.remove(); categoryActions(rows.find((c) => c.id === el.dataset.id), rows); }; });
  }
  function categoryActions(c, rows) {
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">${esc(c.name)}</h2><p class="mute" style="margin:0 0 14px">${c.products} product${c.products === 1 ? '' : 's'}</p>
      <button class="primary" data-a="rn">Rename</button>${rows.length > 1 ? `<button class="primary" data-a="mg" style="${GREY};margin-top:8px">Merge into another category</button>` : ''}<button class="primary" data-a="dl" style="${RED};margin-top:8px">Delete category</button><button class="primary" data-a="x" style="${GREY};margin-top:8px">Back</button>`);
    bg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; bg.remove(); const a = b.dataset.a;
      if (a === 'x') return categoriesSheet();
      if (a === 'rn') return sheet('Rename — ' + c.name, [{ k: 'name', l: 'New name', v: c.name }], async (f, memo) => { const aid = await getAdmin(), all = await catRows(), cat = all.find((x) => x.id === c.id);
        await pushRecs(once(memo, f, () => POS_OPS.renameCategory({ dev, adminId: aid, category: cat, name: f.name, categories: all })).records); });
      if (a === 'mg') return sheet('Merge — ' + c.name, [{ k: 'into', l: `Move all ${c.products} product(s) into`, opts: rows.filter((x) => x.id !== c.id).map((x) => [x.id, x.name]) }], async (f, memo) => {
        const aid = await getAdmin(), all = await catRows(), prods = await rpc('category_products', { p_cat: c.id });
        await pushRecs(once(memo, f, () => POS_OPS.mergeCategories({ dev, adminId: aid, from: all.find((x) => x.id === c.id), into: all.find((x) => x.id === f.into), products: prods })).records); });
      if (a === 'dl') return (async () => { try { const aid = await getAdmin(), fresh = (await rpc('category_list', {})).find((x) => x.id === c.id), all = await catRows();
        if (!fresh) throw new Error('Category not found'); if (!confirm('Delete the category “' + c.name + '”?')) return;
        const r = POS_OPS.deleteCategory({ dev, adminId: aid, category: all.find((x) => x.id === c.id), productCount: fresh.products }); await pushRecs(r.records); toast('Deleted ✓'); load(); } catch (e) { toast(fail(e)); } })(); };
  }
})(typeof window !== 'undefined' ? window : globalThis);
