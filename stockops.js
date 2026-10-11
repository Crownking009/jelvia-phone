// Stock count, break pack, stock value, suppliers and the activity log on the owner's phone.
// Mirrors applyStocktake() and breakPack() in src/services/admin.js: same rules, same rows, same wording. Pure builders (no network) so Node can test them.
(function (root) {
  const uid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : require('crypto').randomUUID());
  const base = (c) => ({ created_at: c.now, updated_at: c.now, deleted_at: null, device_id: c.dev, synced_at: null });
  const rec = (tbl, data, c) => ({ tbl, id: data.id, data, device_id: c.dev, updated_at: data.updated_at });
  const log = (c, action, tbl, recordId, detail) => rec('activity_log', { id: uid(), ...base(c), user_id: c.adminId, action: 'phone.' + action, tbl, record_id: recordId, detail: JSON.stringify(detail) }, c);
  const ctx = (o) => { if (!o.adminId) throw new Error('Owner account not found'); return { dev: o.dev, adminId: o.adminId, now: o.now || Date.now() }; };
  const byExpiry = (a, b) => ((a.expiry == null) - (b.expiry == null)) || (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0);   // earliest expiry first, none last

  // What a count would change. o: { counts:[{productId, counted}], data:{ [productId]: { name, batches:[{batchId, remaining, cost, expiry}], lastCost } } }
  function countPlan(o) {
    if (!Array.isArray(o.counts) || !o.counts.length) throw new Error('Enter at least one count');
    const seen = new Set(), lines = []; let shortValue = 0, overValue = 0;
    for (const c of o.counts) {
      if (!Number.isInteger(c.counted) || c.counted < 0) throw new Error('Counts must be whole numbers (0 or more)');
      const d = o.data && o.data[c.productId]; if (!d) throw new Error('Product not found');
      if (seen.has(c.productId)) throw new Error('Each product can only be counted once'); seen.add(c.productId);
      const batches = [...d.batches].filter((b) => b.remaining > 0).sort(byExpiry), system = batches.reduce((s, b) => s + b.remaining, 0), diff = c.counted - system;
      const unitCost = batches.length ? batches[0].cost : d.lastCost || 0, moves = [];
      if (diff < 0) { let need = -diff; for (const b of batches) { if (!need) break; const t = Math.min(need, b.remaining); need -= t; shortValue += t * b.cost; moves.push({ batchId: b.batchId, qty: -t }); } }
      else if (diff > 0) { overValue += diff * unitCost; moves.push({ batchId: batches.length ? batches[batches.length - 1].batchId : null, qty: diff }); }   // null = a new COUNT batch
      lines.push({ productId: c.productId, name: d.name, system, counted: c.counted, diff, unitCost, moves });
    }
    return { lines, shortValue, overValue, changed: lines.filter((l) => l.diff !== 0).length };
  }
  function applyCount(o) {
    const c = ctx(o), p = countPlan(o), out = [], st = { id: uid(), ...base(c), note: (o.note || '').trim() || null, applied_by: c.adminId, lines_count: p.lines.length, short_value: p.shortValue, over_value: p.overValue };
    for (const l of p.lines) for (const m of l.moves) {
      let bid = m.batchId;
      if (!bid) { const nb = { id: uid(), ...base(c), product_id: l.productId, purchase_id: null, batch_no: 'COUNT', expiry_date: null, cost_price: l.unitCost }; out.push(rec('batches', nb, c)); bid = nb.id; }
      out.push(rec('stock_entries', { id: uid(), ...base(c), product_id: l.productId, batch_id: bid, qty_change: m.qty, reason: 'correction', ref_id: null, user_id: c.adminId }, c));
    }
    out.push(rec('stocktakes', st, c));
    for (const l of p.lines) out.push(rec('stocktake_lines', { id: uid(), ...base(c), stocktake_id: st.id, product_id: l.productId, system_qty: l.system, counted_qty: l.counted, unit_cost: l.unitCost }, c));
    out.push(log(c, 'stocktake.apply', 'stocktakes', st.id, { lines: p.lines.length, shortValue: p.shortValue, overValue: p.overValue }));
    return { records: out, summary: { id: st.id, lines: p.lines.length, changed: p.changed, shortValue: p.shortValue, overValue: p.overValue, rows: p.lines } };
  }
  // Open packs into single units. o: { dev, adminId, packProductId, singleProductId, packs, size, batches:[{ batchId, batchNo, remaining, expiry, cost }] } (the pack product's sellable batches)
  function breakPack(o) {
    const c = ctx(o);
    if (!o.packProductId || !o.singleProductId || o.packProductId === o.singleProductId) throw new Error('Choose the pack product and a different single-unit product');
    if (!Number.isInteger(o.packs) || o.packs <= 0) throw new Error('Number of packs must be a whole number above zero');
    if (!Number.isInteger(o.size) || o.size < 2) throw new Error('Units per pack must be 2 or more');
    const batches = [...o.batches].filter((b) => b.remaining > 0).sort(byExpiry);
    if (batches.reduce((s, b) => s + b.remaining, 0) < o.packs) throw new Error('Not enough packs in stock');
    const conv = uuid2(), out = []; let need = o.packs;
    for (const b of batches) {
      if (!need) break; const t = Math.min(need, b.remaining); need -= t;
      out.push(rec('stock_entries', { id: uid(), ...base(c), product_id: o.packProductId, batch_id: b.batchId, qty_change: -t, reason: 'correction', ref_id: null, user_id: c.adminId }, c));
      const nb = { id: uid(), ...base(c), product_id: o.singleProductId, purchase_id: null, batch_no: b.batchNo || null, expiry_date: b.expiry || null, cost_price: Math.round(b.cost / o.size) };
      out.push(rec('batches', nb, c));
      out.push(rec('stock_entries', { id: uid(), ...base(c), product_id: o.singleProductId, batch_id: nb.id, qty_change: t * o.size, reason: 'received', ref_id: conv, user_id: c.adminId }, c));
    }
    out.push(log(c, 'stock.break_pack', 'products', o.packProductId, { packs: o.packs, size: o.size, into: o.singleProductId }));
    return { records: out, summary: { packs: o.packs, size: o.size, singles: o.packs * o.size } };
  }
  function uuid2() { return uid(); }

  const api = { countPlan, applyCount, breakPack };
  for (const k of Object.keys(api)) if (root.POS_OPS && k in root.POS_OPS) throw new Error('POS_OPS name clash: ' + k + ' is already defined by another phone file');
  root.POS_OPS = Object.assign(root.POS_OPS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;

  // ---------- screens (browser only) ----------
  if (typeof document === 'undefined') return;
  const today = () => new Date().toLocaleDateString('en-CA');
  const fail = (e) => (e.message === 'auth' ? 'Please sign in again' : e.message);
  const overlay = (html) => { const bg = document.createElement('div'); bg.className = 'sheetbg'; bg.innerHTML = '<div class="sheet">' + html + '</div>'; document.body.appendChild(bg); return bg; };
  const GREY = 'background:#e8efee;color:var(--ink)';
  const when = (ms) => new Date(ms).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const ask = (title, label, value) => new Promise((res) => { const bg = overlay(`<h2 style="margin:0 0 12px;font-size:19px">${esc(title)}</h2><label class="lb">${esc(label)}</label><input id="aq" type="number" inputmode="numeric" value="${esc(value)}" autocomplete="off"><button class="primary" id="aq_ok">Save</button><button class="primary" id="aq_x" style="${GREY};margin-top:8px">Cancel</button>`);
    bg.querySelector('#aq_ok').onclick = () => { const v = bg.querySelector('#aq').value; bg.remove(); res(v); }; bg.querySelector('#aq_x').onclick = () => { bg.remove(); res(null); }; });

  // ----- stock count: counts are kept on the phone until applied or cleared -----
  const KEY = 'cnt_draft', draft = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }, keep = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* storage full or blocked */ } };
  root.stockCountSheet = function () {
    let list = draft(), res = [], tmr = null;
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Stock count</h2><p class="mute" style="margin:0 0 10px">Search a product and enter what you counted on the shelf (units that can be sold). Your counts stay on this phone until you apply or clear them.</p>
      <input id="sc_q" placeholder="Search product by name…" autocomplete="off"><div class="list" id="sc_res"></div>
      <h3>Counted so far (<span id="sc_n">0</span>)</h3><div class="list" id="sc_l"></div><p class="err" id="sc_e"></p>
      <button class="primary" id="sc_go">Review and apply</button><button class="primary" id="sc_h" style="${GREY};margin-top:8px">Past counts</button><button class="primary" id="sc_c" style="${GREY};margin-top:8px">Clear this count</button><button class="primary" id="sc_x" style="${GREY};margin-top:8px">Close</button>`);
    const $$ = (s) => bg.querySelector(s), err = (m) => { $$('#sc_e').textContent = m || ''; };
    const drawList = () => { $$('#sc_n').textContent = list.length; $$('#sc_go').disabled = !list.length;
      $$('#sc_l').innerHTML = list.map((x, i) => `<div class="li"><span>${esc(x.name)}<br><small class="mute">system showed ${x.system}</small></span><span><b>${x.counted}</b> <button class="mini" data-x="${i}">✕</button></span></div>`).join('') || '<div class="li mute">Nothing counted yet</div>';
      $$('#sc_l').querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => { list.splice(+b.dataset.x, 1); keep(list); drawList(); }; }); };
    const drawRes = () => { $$('#sc_res').innerHTML = res.map((p) => `<div class="li" data-id="${esc(p.id)}" style="cursor:pointer"><span>${esc(p.name)}</span><span class="badge">${p.sellable} in stock</span></div>`).join('') || '<div class="li mute">No product found</div>';
      $$('#sc_res').querySelectorAll('[data-id]').forEach((el) => { el.onclick = async () => { const p = res.find((x) => x.id === el.dataset.id), ex = list.find((x) => x.productId === p.id);
        const v = await ask('Count — ' + p.name, 'Units on the shelf (0 if none)', ex ? ex.counted : ''); if (v === null || v === '') return; const n = Number(v);
        if (!Number.isInteger(n) || n < 0) return err('Counts must be whole numbers (0 or more)'); err('');
        if (ex) { ex.counted = n; ex.system = p.sellable; } else list.push({ productId: p.id, name: p.name, counted: n, system: p.sellable }); keep(list); drawList(); }; }); };
    const search = async () => { try { res = await rpc('sell_catalog', { p_q: $$('#sc_q').value, p_today: today() }); drawRes(); } catch (e) { err(fail(e)); } };
    $$('#sc_q').oninput = () => { clearTimeout(tmr); tmr = setTimeout(search, 250); }; drawList(); search();
    $$('#sc_x').onclick = () => bg.remove(); $$('#sc_h').onclick = () => { bg.remove(); pastCounts(); };
    $$('#sc_c').onclick = () => { if (!list.length || !confirm('Clear all ' + list.length + ' counts you entered?')) return; list = []; keep(list); drawList(); };
    $$('#sc_go').onclick = async () => { err(''); try { const adminId = await getAdmin(), data = await rpc('count_data', { p_ids: list.map((x) => x.productId), p_today: today() });
        const counts = list.map((x) => ({ productId: x.productId, counted: x.counted })), plan = POS_OPS.countPlan({ counts, data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { ...v, batches: v.batches.map((b) => ({ batchId: b.batchId, remaining: Number(b.remaining), expiry: b.expiry, cost: Number(b.cost) })) }])) });
        bg.remove(); reviewSheet(adminId, counts, plan); } catch (e) { err(fail(e)); } };
  };
  function reviewSheet(adminId, counts, plan) {
    const ch = plan.lines.filter((l) => l.diff !== 0), memo = {};
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Review the count</h2><p class="mute" style="margin:0 0 10px">${plan.lines.length} counted · ${plan.changed} differ from the system · short ${N(plan.shortValue)} · extra ${N(plan.overValue)} (at cost)</p>
      <div class="list">${ch.map((l) => `<div class="li"><span>${esc(l.name)}<br><small class="mute">system ${l.system} → counted ${l.counted}</small></span><b style="color:${l.diff < 0 ? 'var(--bad)' : 'var(--brand2)'}">${l.diff < 0 ? 'short ' + -l.diff : 'extra ' + l.diff}</b></div>`).join('') || '<div class="li mute">Everything matches the system</div>'}</div>
      <label class="lb" style="margin-top:12px">Note (optional)</label><input id="rv_note" autocomplete="off"><p class="err" id="rv_e"></p>
      <button class="primary" id="rv_ok">Apply the count</button><button class="primary" id="rv_x" style="${GREY};margin-top:8px">Back</button>`);
    const $$ = (s) => bg.querySelector(s); $$('#rv_x').onclick = () => { bg.remove(); stockCountSheet(); };
    $$('#rv_ok').onclick = async (ev) => { const ok = ev.target; ok.disabled = true; $$('#rv_e').textContent = '';
      try { const data = await rpc('count_data', { p_ids: counts.map((c) => c.productId), p_today: today() }), note = $$('#rv_note').value, key = JSON.stringify({ counts, note });
        if (memo.k !== key) { memo.r = POS_OPS.applyCount({ dev, adminId, counts, note, data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { ...v, batches: v.batches.map((b) => ({ batchId: b.batchId, remaining: Number(b.remaining), expiry: b.expiry, cost: Number(b.cost) })) }])) }); memo.k = key; }
        if (!confirm('Apply this count? Stock changes for ' + memo.r.summary.changed + ' product(s) and the count is kept on record.')) { ok.disabled = false; return; }
        await pushRecs(memo.r.records); keep([]); bg.remove(); toast('Count applied ✓ — ' + memo.r.summary.changed + ' changed'); load();
      } catch (e) { $$('#rv_e').textContent = fail(e); ok.disabled = false; } };
  }
  async function pastCounts() {
    let rows; try { rows = await rpc('stocktake_list', {}); } catch (e) { return toast(fail(e)); }
    const bg = overlay(`<h2 style="margin:0 0 12px;font-size:19px">Past stock counts</h2><div class="list">${rows.map((r) => `<div class="li" data-id="${esc(r.id)}" style="cursor:pointer"><span>${when(r.ts)}${r.by ? ' · ' + esc(r.by) : ''}<br><small class="mute">${r.n} counted · ${r.changed} differed${r.note ? ' — ' + esc(r.note) : ''}</small></span><span style="text-align:right"><small class="mute">short ${N(r.shortValue)}<br>extra ${N(r.overValue)}</small></span></div>`).join('') || '<div class="li mute">No counts yet</div>'}</div><button class="primary" id="pc_x" style="${GREY};margin-top:12px">Back</button>`);
    bg.querySelector('#pc_x').onclick = () => { bg.remove(); stockCountSheet(); };
    bg.querySelectorAll('[data-id]').forEach((el) => { el.onclick = async () => { let d; try { d = await rpc('stocktake_detail', { p_id: el.dataset.id }); } catch (e) { return toast(fail(e)); }
      bg.remove(); const b2 = overlay(`<h2 style="margin:0 0 12px;font-size:19px">Count details</h2><div class="list">${d.map((l) => `<div class="li"><span>${esc(l.name)}<br><small class="mute">system ${l.systemQty} → counted ${l.countedQty}</small></span><b style="color:${l.countedQty < l.systemQty ? 'var(--bad)' : l.countedQty > l.systemQty ? 'var(--brand2)' : 'inherit'}">${l.countedQty === l.systemQty ? '✓' : (l.countedQty > l.systemQty ? '+' : '−') + Math.abs(l.countedQty - l.systemQty)}</b></div>`).join('')}</div><button class="primary" id="cd_x" style="${GREY};margin-top:12px">Back</button>`);
      b2.querySelector('#cd_x').onclick = () => { b2.remove(); pastCounts(); }; }; });
  }

  // ----- break pack -----
  root.breakPackSheet = function () {
    const ps = (data && data.s && data.s.products) || []; if (ps.length < 2) return toast('Add the pack and single products first');
    const opts = ps.map((p) => [p.id, p.name]);
    sheet('Break pack', [{ k: 'pack', l: 'Pack product (the pack that is opened)', opts }, { k: 'single', l: 'Single-unit product (what the units are sold as)', opts, sel: ps[1].id }, { k: 'packs', l: 'Number of packs to open', t: 'number' }, { k: 'size', l: 'Units in each pack', t: 'number' }],
      async (f, memo) => { const aid = await getAdmin(), bs = await rpc('product_batches', { p_product: f.pack, p_today: today() });
        await pushRecs(once(memo, f, () => POS_OPS.breakPack({ dev, adminId: aid, packProductId: f.pack, singleProductId: f.single, packs: Number(f.packs), size: Number(f.size),
          batches: bs.map((b) => ({ batchId: b.batchId, batchNo: b.batchNo, remaining: Number(b.remaining), expiry: b.expiry, cost: Number(b.cost) })) })).records); });
  };

  // ----- stock value, suppliers, activity log -----
  root.stockValueSheet = async function () {
    let v; try { v = await rpc('stock_value', { p_today: today() }); } catch (e) { return toast(fail(e)); }
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Stock value</h2><p class="mute" style="margin:0 0 12px">Stock that can be sold today (expired stock is left out).</p>
      <div class="cards"><div class="card"><small>At cost</small><b>${N(v.cost)}</b></div><div class="card"><small>At selling price</small><b>${N(v.retail)}</b></div></div>
      <p class="mute" style="margin:12px 2px">Expected profit if it all sells at the list price: <b style="color:var(--ink)">${N(v.retail - v.cost)}</b></p><button class="primary" id="sv_x" style="${GREY};margin-top:8px">Close</button>`);
    bg.querySelector('#sv_x').onclick = () => bg.remove();
  };
  root.suppliersSheet = async function () {
    let rows; try { rows = await rpc('supplier_list', {}); } catch (e) { return toast(fail(e)); }
    const bg = overlay(`<h2 style="margin:0 0 12px;font-size:19px">Suppliers</h2><button class="primary" id="su_new">＋ New supplier</button>
      <div class="list" style="margin-top:10px">${rows.map((s) => `<div class="li"><span>${esc(s.name)}<br><small class="mute">${s.phone ? `<a href="tel:${esc(s.phone)}" style="color:inherit">${esc(s.phone)}</a> · ` : ''}${s.deliveries} deliveries${s.notes ? ' · ' + esc(s.notes) : ''}</small></span><b>${N(s.spent)}</b></div>`).join('') || '<div class="li mute">No suppliers yet</div>'}</div>
      <button class="primary" id="su_x" style="${GREY};margin-top:12px">Close</button>`);
    bg.querySelector('#su_x').onclick = () => bg.remove();
    bg.querySelector('#su_new').onclick = () => { bg.remove(); sheet('New supplier', [{ k: 'name', l: 'Supplier name' }, { k: 'phone', l: 'Phone number (optional)', t: 'tel' }, { k: 'notes', l: 'Notes (optional)' }],
      async (f, memo) => { const aid = await getAdmin(); await pushRecs(once(memo, f, () => POS_OPS.addSupplier({ dev, adminId: aid, name: f.name, phone: f.phone, notes: f.notes }))); }); };
  };
  root.activitySheet = function () {
    let tmr = null;
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Activity log</h2><p class="mute" style="margin:0 0 10px">Who did what, newest first.</p><input id="ac_q" placeholder="Search by person or action" autocomplete="off"><div class="list" id="ac_l"></div><button class="primary" id="ac_x" style="${GREY};margin-top:12px">Close</button>`);
    const $$ = (s) => bg.querySelector(s), run = async () => { try { const rows = await rpc('activity_list', { p_q: $$('#ac_q').value.trim(), p_limit: 100 });
      $$('#ac_l').innerHTML = rows.map((r) => { let d = r.detail || ''; try { const o = JSON.parse(d); d = Object.entries(o).map(([k, v]) => k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(', '); } catch (e) { /* plain text */ }
        return `<div class="li" style="display:block"><b>${esc(r.action)}</b> <small class="mute">· ${esc(r.who || '—')} · ${when(r.ts)}</small>${d ? `<br><small class="mute">${esc(d.slice(0, 120))}</small>` : ''}</div>`; }).join('') || '<div class="li mute">Nothing found</div>'; } catch (e) { toast(fail(e)); } };
    $$('#ac_q').oninput = () => { clearTimeout(tmr); tmr = setTimeout(run, 300); }; $$('#ac_x').onclick = () => bg.remove(); run();
  };
})(typeof window !== 'undefined' ? window : globalThis);