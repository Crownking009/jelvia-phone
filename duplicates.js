// Stops the owner adding a product or category that already exists (capitals and extra spaces do not make a new name). Same rule and same words as the shop computer.
// Pure checks (testable in Node) plus checkNames(), which the Add and Edit product forms call: it reads the current names from the cloud first,
// and if it cannot, it refuses rather than risk a duplicate.
(function (root) {
  const norm = (s) => String(s == null ? '' : s).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  // products: [{ id, name, active }] (every product that is not deleted). Returns the message to show, or null.
  function checkProductName(products, name, selfId) {
    const n = norm(name), rows = (products || []).filter((p) => p.id !== selfId && norm(p.name) === n), hit = rows.find((p) => p.active === 1) || rows[0];
    return hit ? (hit.active === 1 ? `A product named “${hit.name}” already exists` : `A product named “${hit.name}” already exists but is archived — restore it from the owner’s phone (Stock, then Archived products)`) : null;
  }
  // A category typed into the "new category" box that matches one she already has (the list is for choosing existing ones).
  function checkNewCategory(categories, name) { const n = norm(name); if (!n) return null; const hit = (categories || []).find((c) => norm(c.name) === n); return hit ? `The category “${hit.name}” already exists — choose it from the list` : null; }
  const api = { checkProductName, checkNewCategory, normName: norm };
  for (const k of Object.keys(api)) if (root.POS_OPS && k in root.POS_OPS) throw new Error('POS_OPS name clash: ' + k + ' is already defined by another phone file');
  root.POS_OPS = Object.assign(root.POS_OPS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof document === 'undefined') return;
  // f = the form's values (name, newcat); selfId = the product being edited, if any. Throws the message the form shows.
  root.checkNames = async function (f, selfId) {
    let products, categories;
    try { [products, categories] = await Promise.all([rpc('product_names', {}), rpc('category_names', {})]); }
    catch (e) { if (e.message === 'auth') throw e; throw new Error('Could not check whether this already exists. Check the internet connection and try again.'); }
    const m = checkProductName(products, f.name, selfId) || checkNewCategory(categories, f.newcat); if (m) throw new Error(m);
  };
})(typeof window !== 'undefined' ? window : globalThis);
