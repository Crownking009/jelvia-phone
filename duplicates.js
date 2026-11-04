// Stops the owner adding a product or category that already exists (capitals and extra spaces do not make a new name). Same rule and same words as the shop computer.
// A product counts as the same only when its name AND its options (sold as, size, for) match: "Paracetamol (Strip · Adults)" and "Paracetamol (Sachet · Kids)" are different products.
// Pure checks (testable in Node) plus checkNames(), which the Add and Edit product forms call: it reads the current names from the cloud first,
// and if it cannot, it refuses rather than risk a duplicate. product_names comes from cloud/phone-options.sql (it also returns sold_as, size and audience).
(function (root) {
  const norm = (s) => String(s == null ? '' : s).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const keyOf = (name, v) => [name, v && v.sold_as, v && v.size, v && v.audience].map(norm).join('|');
  const lab = (p) => { const bits = [p.sold_as, p.size, p.audience].map((x) => String(x == null ? '' : x).trim()).filter(Boolean); return bits.length ? `${p.name} (${bits.join(' · ')})` : p.name; };
  // products: [{ id, name, active, sold_as, size, audience }] (every product that is not deleted); v = { sold_as, size, audience } of the one being saved. Returns the message to show, or null.
  function checkProductName(products, name, selfId, v) {
    const k = keyOf(name, v), rows = (products || []).filter((p) => p.id !== selfId && keyOf(p.name, p) === k), hit = rows.find((p) => p.active === 1) || rows[0];
    return hit ? (hit.active === 1 ? `A product named “${lab(hit)}” already exists` : `A product named “${lab(hit)}” already exists but is archived — restore it from Archived products instead`) : null;
  }
  // A category typed into the "new category" box that matches one she already has (the list is for choosing existing ones).
  function checkNewCategory(categories, name) { const n = norm(name); if (!n) return null; const hit = (categories || []).find((c) => norm(c.name) === n); return hit ? `The category “${hit.name}” already exists — choose it from the list` : null; }
  const api = { checkProductName, checkNewCategory, normName: norm };
  for (const k of Object.keys(api)) if (root.POS_OPS && k in root.POS_OPS) throw new Error('POS_OPS name clash: ' + k + ' is already defined by another phone file');
  root.POS_OPS = Object.assign(root.POS_OPS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof document === 'undefined') return;
  // f = the form's values (name, newcat, soldAs, size, audience); selfId = the product being edited, if any. Throws the message the form shows.
  root.checkNames = async function (f, selfId) {
    let products, categories;
    try { [products, categories] = await Promise.all([rpc('product_names', {}), rpc('category_names', {})]); }
    catch (e) { if (e.message === 'auth') throw e; throw new Error('Could not check whether this already exists. Check the internet connection and try again.'); }
    const v = root.POS_OPS.optClean({ soldAs: f.soldAs, size: f.size, audience: f.audience });
    const m = checkProductName(products, f.name, selfId, v) || checkNewCategory(categories, f.newcat); if (m) throw new Error(m);
  };
})(typeof window !== 'undefined' ? window : globalThis);
