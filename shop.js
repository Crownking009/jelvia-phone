// Shop details on the owner's phone: name, address, phone number, RC number and the receipt footer. Mirrors saveShop() in src/services/settings.js.
// Pure builder (no network) so Node can test it. The shop computer applies the rows on its next sync. Paper size and auto-print belong to the computer's printer and stay there.
(function (root) {
  const uid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : require('crypto').randomUUID());
  const base = (c) => ({ created_at: c.now, updated_at: c.now, deleted_at: null, device_id: c.dev, synced_at: null });
  const rec = (tbl, data, c) => ({ tbl, id: data.id, data, device_id: c.dev, updated_at: data.updated_at });
  const DEFAULTS = { shop_name: 'Jelvia Health and Beauty Limited', shop_address: '', shop_phone: '', shop_rc: '', receipt_footer: 'Thank you for your patronage!' };
  // The shop's details as they stand now, from the settings rows in the cloud (same fallbacks as the computer).
  function shopValues(rows) { const g = (k) => { const r = (rows || []).find((x) => x.key === k && !x.deleted_at); return r ? r.value : DEFAULTS[k]; };
    return { name: g('shop_name'), address: g('shop_address'), phone: g('shop_phone'), rc: g('shop_rc'), footer: g('receipt_footer') }; }
  // o: { dev, adminId, rows: [the current settings rows], name, address, phone, rc, footer }
  function saveShop(o) {
    if (!o.adminId) throw new Error('Owner account not found');
    if (!(o.name || '').trim()) throw new Error('Shop name is required');
    const c = { dev: o.dev, adminId: o.adminId, now: o.now || Date.now() }, out = [];
    for (const [k, v] of [['shop_name', o.name], ['shop_address', o.address], ['shop_phone', o.phone], ['shop_rc', o.rc], ['receipt_footer', o.footer === undefined ? DEFAULTS.receipt_footer : o.footer]]) {
      const val = (v || '').trim(), row = (o.rows || []).find((x) => x.key === k);
      // a key the shop already has is updated in place (same row), never added twice: the computer allows one row per key
      if (row) out.push(rec('settings', { ...row, value: val, deleted_at: null, updated_at: Math.max(c.now, (row.updated_at || 0) + 1) }, c));
      else out.push(rec('settings', { id: uid(), ...base(c), key: k, value: val }, c));
    }
    out.push(rec('activity_log', { id: uid(), ...base(c), user_id: c.adminId, action: 'phone.shop.update', tbl: 'settings', record_id: null, detail: null }, c));
    return { records: out, summary: shopValues(out.filter((r) => r.tbl === 'settings').map((r) => r.data)) };
  }
  const api = { saveShop, shopValues };
  for (const k of Object.keys(api)) if (root.POS_OPS && k in root.POS_OPS) throw new Error('POS_OPS name clash: ' + k + ' is already defined by another phone file');
  root.POS_OPS = Object.assign(root.POS_OPS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;

  // ---------- screen (browser only) ----------
  if (typeof document === 'undefined') return;
  const fail = (e) => (e.message === 'auth' ? 'Please sign in again' : e.message);
  root.shopSheet = async function () {
    let rows; try { rows = (await rget('tbl=eq.settings&select=data&limit=100')).map((x) => x.data); } catch (e) { return toast(fail(e)); }
    const v = shopValues(rows);
    sheet('Shop details', [{ k: 'name', l: 'Shop name (shown on every receipt)', v: v.name }, { k: 'address', l: 'Address', v: v.address }, { k: 'phone', l: 'Phone number', t: 'tel', v: v.phone },
      { k: 'rc', l: 'RC number (optional)', v: v.rc }, { k: 'footer', l: 'Message at the bottom of receipts', v: v.footer }],
      async (f, memo) => { const aid = await getAdmin(), fresh = (await rget('tbl=eq.settings&select=data&limit=100')).map((x) => x.data);   // read again so a change made at the shop is updated, not duplicated
        await pushRecs(once(memo, f, () => POS_OPS.saveShop({ dev, adminId: aid, rows: fresh, name: f.name, address: f.address, phone: f.phone, rc: f.rc, footer: f.footer })).records); });
  };
})(typeof window !== 'undefined' ? window : globalThis);
